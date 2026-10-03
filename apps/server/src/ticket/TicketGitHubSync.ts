import {
  ProjectId,
  TicketError,
  TicketGitHubSource,
  type TicketGitHubSourceRef,
  type TicketGitHubSourceRemoveInput,
  type TicketGitHubSourceSet,
  type TicketGitHubSourceUpsertInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import type { IssueProviderError, ProviderIssueListCursor } from "../issue/IssueProvider.ts";
import { IssueProviderRegistry } from "../issue/IssueProviderRegistry.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as TicketGitHub from "./TicketGitHub.ts";
import * as TicketService from "./TicketService.ts";

const SYNC_INTERVAL = Duration.minutes(10);
const PAGE_SIZE = 50;
const MAX_PAGES = 200;
export const MAX_UNLISTED_REFRESHES = 50;

/**
 * The environment's GitHub sources and their sync. A sync imports every open issue as a
 * ticket, refreshes tracked ones, and asks GitHub about tracked open tickets that left the open
 * list to learn how they closed. A failure is kept on the source as `lastError`.
 */
export class TicketGitHubSync extends Context.Service<
  TicketGitHubSync,
  {
    readonly subscribeSources: () => Stream.Stream<TicketGitHubSourceSet, TicketError>;
    /** Adds a source or switches its background sync. Does not sync; call `syncNow` for that. */
    readonly upsertSource: (
      input: TicketGitHubSourceUpsertInput,
    ) => Effect.Effect<TicketGitHubSourceSet, TicketError>;
    /**
     * Removes a source. When no other project still syncs the repository, its tickets are
     * hidden, or deleted with `deleteCache`.
     */
    readonly removeSource: (
      input: TicketGitHubSourceRemoveInput,
    ) => Effect.Effect<TicketGitHubSourceSet, TicketError>;
    /** Syncs one source, enabled or not, and returns it with the outcome recorded. */
    readonly syncNow: (
      input: TicketGitHubSourceRef,
    ) => Effect.Effect<TicketGitHubSource, TicketError>;
    /**
     * Syncs, in turn, every enabled source whose last attempt is older than the sync interval.
     * Failures land on the sources, never here.
     */
    readonly syncDue: Effect.Effect<void>;
  }
>()("t3/ticket/TicketGitHubSync") {}

interface SourceRow {
  readonly project_id: string;
  readonly host: string;
  readonly repository: string;
  readonly enabled: number;
  readonly last_synced_at: string | null;
  readonly last_error: string | null;
  readonly issue_count: number;
}

const decodeSource = Schema.decodeUnknownEffect(TicketGitHubSource);

const ticketError = (message: string) => (cause: unknown) => new TicketError({ message, cause });

/** A deleted or transferred issue reads as not found; any other failure is a real one. */
const isMissingIssue = (error: IssueProviderError | TicketError) =>
  error._tag === "IssueProviderError" &&
  Predicate.isTagged(error.cause, "GitHubPullRequestNotFoundError");

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tickets = yield* TicketService.TicketService;
  const github = yield* TicketGitHub.TicketGitHub;
  const registry = yield* IssueProviderRegistry;
  const projects = yield* ProjectService.ProjectService;

  const changes = yield* PubSub.sliding<void>(1);
  const lock = yield* Semaphore.make(1);
  const unlistedCursors = new Map<string, number>();

  const now = Effect.map(DateTime.now, DateTime.formatIso);

  const toSource = (row: SourceRow) =>
    decodeSource({
      projectId: row.project_id,
      host: row.host,
      repository: row.repository,
      enabled: row.enabled === 1,
      lastSyncedAt: row.last_synced_at,
      lastError: row.last_error,
      issueCount: row.issue_count,
    });

  const selectSources = sql<SourceRow>`
    SELECT project_id, host, repository, enabled, last_synced_at, last_error, issue_count
    FROM ticket_github_sources ORDER BY created_at, host, repository
  `;

  const readSources = selectSources.pipe(
    Effect.flatMap((rows) => Effect.forEach(rows, toSource)),
    Effect.map((sources): TicketGitHubSourceSet => ({ sources })),
    Effect.mapError(ticketError("Could not read the GitHub sources.")),
  );

  const readSource = (ref: TicketGitHubSourceRef) =>
    Effect.gen(function* () {
      const [row] = yield* sql<SourceRow>`
        SELECT project_id, host, repository, enabled, last_synced_at, last_error, issue_count
        FROM ticket_github_sources
        WHERE project_id = ${ref.projectId} AND host = ${ref.host}
          AND repository = ${ref.repository}
      `;
      if (row === undefined) {
        return yield* new TicketError({ message: `${ref.repository} is not a GitHub source.` });
      }
      return yield* toSource(row);
    }).pipe(
      Effect.catchTags({
        SqlError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not read the GitHub source.", cause })),
        SchemaError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not read the GitHub source.", cause })),
      }),
    );

  const publish = PubSub.publish(changes, undefined);

  const importIssues = (source: TicketGitHubSource) =>
    Effect.gen(function* () {
      const { host, repository, projectId } = source;
      const listed = new Map<number, string>();
      let cursor: ProviderIssueListCursor | undefined;
      let complete = false;
      for (let page = 0; page < MAX_PAGES && !complete; page += 1) {
        const batch = yield* github.run(source, (api, cwd) =>
          api.listIssues({
            cwd,
            host,
            repository,
            state: "open",
            limit: PAGE_SIZE,
            includeBody: true,
            ...(cursor === undefined ? {} : { cursor }),
          }),
        );
        const fresh = batch.issues.filter((issue) => !listed.has(issue.number));
        for (const issue of fresh) {
          listed.set(issue.number, issue.updatedAt);
          yield* tickets.upsertGitHubIssue({ projectId, host, repository, issue });
        }
        complete = !batch.truncated || fresh.length === 0;
        const oldest = fresh.reduce<string | null>(
          (min, issue) =>
            min === null || Date.parse(issue.updatedAt) < Date.parse(min) ? issue.updatedAt : min,
          null,
        );
        if (oldest !== null) {
          cursor = {
            updatedBefore: oldest,
            seenAt: [...listed].filter(([, at]) => at === oldest).map(([number]) => number),
          };
        }
      }
      if (!complete) return listed.size;
      const unlisted = (yield* tickets.openGitHubIssueNumbers(source)).filter(
        (number) => !listed.has(number),
      );
      const key = `${host.toLowerCase()}/${repository.toLowerCase()}`;
      const after = unlistedCursors.get(key) ?? 0;
      const batch = [
        ...unlisted.filter((number) => number > after),
        ...unlisted.filter((number) => number <= after),
      ].slice(0, MAX_UNLISTED_REFRESHES);
      for (const number of batch) {
        const issue = yield* github
          .run(source, (api, cwd) => api.getIssue({ cwd, host, repository, number }))
          .pipe(Effect.catchIf(isMissingIssue, () => Effect.succeed(null)));
        if (issue !== null)
          yield* tickets.upsertGitHubIssue({
            projectId,
            host,
            repository,
            issue,
            readKind: "direct",
          });
        unlistedCursors.set(key, number);
      }
      return listed.size;
    });

  /** Re-reads the source inside the lock, so a source removed while this waited is skipped. */
  const syncSource = (ref: TicketGitHubSourceRef) =>
    Effect.gen(function* () {
      const source = yield* readSource(ref).pipe(Effect.option);
      if (Option.isNone(source)) return;
      const outcome = yield* importIssues(source.value).pipe(
        Effect.match({
          onFailure: (error) => ({ error: TicketGitHub.describeGitHubFailure(error), count: 0 }),
          onSuccess: (count) => ({ error: null, count }),
        }),
      );
      const at = yield* now;
      const where = sql`project_id = ${ref.projectId} AND host = ${ref.host}
        AND repository = ${ref.repository}`;
      if (outcome.error === null) {
        yield* sql`
          UPDATE ticket_github_sources
          SET last_synced_at = ${at}, last_attempt_at = ${at}, last_error = NULL,
            issue_count = ${outcome.count}
          WHERE ${where}
        `;
      } else {
        yield* Effect.logWarning("GitHub ticket sync failed", {
          repository: ref.repository,
          error: outcome.error,
        });
        yield* sql`
          UPDATE ticket_github_sources SET last_attempt_at = ${at}, last_error = ${outcome.error}
          WHERE ${where}
        `;
      }
      yield* publish;
    }).pipe(Effect.mapError(ticketError("Could not record the sync result.")), lock.withPermits(1));

  const subscribeSources: TicketGitHubSync["Service"]["subscribeSources"] = () =>
    Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(changes);
        return Stream.concat(
          Stream.fromEffect(readSources),
          Stream.fromSubscription(subscription).pipe(Stream.mapEffect(() => readSources)),
        );
      }),
    );

  const upsertSource: TicketGitHubSync["Service"]["upsertSource"] = (input) =>
    Effect.gen(function* () {
      const host = input.host.toLowerCase();
      if (registry.get("github")?.repositoryLinks({ host, repository: input.repository }) == null) {
        return yield* new TicketError({
          message: `${host}/${input.repository} is not a GitHub repository address.`,
        });
      }
      const project = yield* projects
        .getShell(input.projectId)
        .pipe(Effect.mapError(ticketError("Could not read the project.")));
      if (Option.isNone(project)) {
        return yield* new TicketError({ message: "That project no longer exists." });
      }
      yield* sql`
        INSERT INTO ticket_github_sources (project_id, host, repository, enabled, created_at)
        VALUES (
          ${input.projectId}, ${host}, ${input.repository}, ${input.enabled ? 1 : 0}, ${yield* now}
        )
        ON CONFLICT (project_id, host, repository) DO UPDATE SET enabled = excluded.enabled
      `.pipe(Effect.mapError(ticketError("Could not save the GitHub source.")));
      yield* tickets.restoreGitHubRepository({ host, repository: input.repository });
      yield* publish;
      return yield* readSources;
    }).pipe(lock.withPermits(1));

  const removeSource: TicketGitHubSync["Service"]["removeSource"] = (input) =>
    Effect.gen(function* () {
      const removed = yield* sql<{ readonly host: string; readonly repository: string }>`
        DELETE FROM ticket_github_sources
        WHERE project_id = ${input.projectId} AND host = ${input.host}
          AND repository = ${input.repository}
        RETURNING host, repository
      `;
      const [source] = removed;
      if (source !== undefined) {
        const [remaining] = yield* sql<{ readonly count: number }>`
          SELECT COUNT(*) AS count FROM ticket_github_sources
          WHERE host = ${source.host} AND repository = ${source.repository}
        `;
        if (remaining?.count === 0) {
          yield* tickets.releaseGitHubRepository({ ...source, deleteCache: input.deleteCache });
        }
      }
      yield* publish;
      return yield* readSources;
    }).pipe(
      Effect.catchTag("SqlError", (cause) =>
        Effect.fail(new TicketError({ message: "Could not remove the GitHub source.", cause })),
      ),
      lock.withPermits(1),
    );

  const syncNow: TicketGitHubSync["Service"]["syncNow"] = (input) =>
    Effect.gen(function* () {
      yield* readSource(input);
      yield* syncSource(input);
      return yield* readSource(input);
    });

  const syncDue: TicketGitHubSync["Service"]["syncDue"] = Effect.gen(function* () {
    const dueBefore = DateTime.formatIso(
      DateTime.subtractDuration(yield* DateTime.now, SYNC_INTERVAL),
    );
    const due = yield* sql<{
      readonly project_id: string;
      readonly host: string;
      readonly repository: string;
    }>`
      SELECT project_id, host, repository FROM ticket_github_sources
      WHERE enabled = 1 AND (last_attempt_at IS NULL OR last_attempt_at <= ${dueBefore})
      ORDER BY created_at, host, repository
    `;
    yield* Effect.forEach(
      due,
      (row) =>
        syncSource({
          projectId: ProjectId.make(row.project_id),
          host: row.host,
          repository: row.repository,
        }),
      { discard: true },
    );
  }).pipe(Effect.catchCause((cause) => Effect.logWarning("GitHub ticket sync stopped", { cause })));

  return TicketGitHubSync.of({
    subscribeSources,
    upsertSource,
    removeSource,
    syncNow,
    syncDue,
  });
});

export const layer = Layer.effect(TicketGitHubSync, make);

export const workerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const sync = yield* TicketGitHubSync;
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("ticket-github-sync", sync.syncDue);
  }),
);
