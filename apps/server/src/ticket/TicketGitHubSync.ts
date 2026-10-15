import {
  SourceControlProviderKind,
  ProjectId,
  TicketError,
  TicketGitHubSource,
  type TicketGitHubSourceRef,
  type TicketGitHubSourceRemoveInput,
  type TicketGitHubSourceSet,
  type TicketGitHubSourceUpsertInput,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { IssueProviderError, type ProviderIssueListCursor } from "../issue/IssueProvider.ts";
import { GitHubApiResponseError } from "@t3tools/source-control-github/server/GitHubApi";
import { GitHubIssueReadError } from "../issue/GitHubIssueCli.ts";
import { IssueProviderRegistry } from "../issue/IssueProviderRegistry.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as TicketGitHub from "./TicketGitHub.ts";
import { Interactive } from "@t3tools/source-control-core/server/SourceControlRateLimit";
import * as TicketService from "./TicketService.ts";

const SYNC_INTERVAL = Duration.minutes(10);
const PAGE_SIZE = 50;
const MAX_PAGES = 200;
export const MAX_UNLISTED_REFRESHES = 50;

/**
 * The environment's GitHub sources and their shared, incremental repository sync.
 * A failure is kept on the sources as `lastError`.
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
  readonly sync_watermark_at: string | null;
}

const repositoryKey = (ref: Pick<TicketGitHubSourceRef, "host" | "repository">) =>
  `${ref.host.toLowerCase()}\0${ref.repository.toLowerCase()}`;

const decodeSource = Schema.decodeUnknownEffect(TicketGitHubSource);

const ticketError = (message: string) => (cause: unknown) => new TicketError({ message, cause });

const isIssueReadError = Schema.is(GitHubIssueReadError);
const isApiResponseError = Schema.is(GitHubApiResponseError);
const isIssueProviderError = Schema.is(IssueProviderError);

const isUnreadableIssue = (error: IssueProviderError) => {
  if (error.reason !== "failed") return false;
  if (isIssueReadError(error.cause)) return true;
  return (
    isApiResponseError(error.cause) &&
    error.cause.status >= 200 &&
    error.cause.status < 300 &&
    (error.cause.githubErrors?.length ?? 0) === 0
  );
};

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tickets = yield* TicketService.TicketService;
  const github = yield* TicketGitHub.TicketGitHub;
  const registry = yield* IssueProviderRegistry;
  const projects = yield* ProjectService.ProjectService;

  const changes = yield* PubSub.sliding<void>(1);
  const repositoryLocks = yield* KeyedLock.make<string>();
  const flights = new Map<
    string,
    {
      readonly done: Deferred.Deferred<void, TicketError>;
      readonly manualProjects: Set<ProjectId>;
      readonly coveredProjects: Set<ProjectId>;
    }
  >();

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
    SELECT project_id, host, repository, enabled, last_synced_at, last_error, issue_count,
      sync_watermark_at
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
        SELECT project_id, host, repository, enabled, last_synced_at, last_error, issue_count,
          sync_watermark_at
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

  const importIssues = Effect.fn("TicketGitHubSync.importIssues")(function* (input: {
    readonly source: TicketGitHubSource;
    readonly sources: ReadonlyArray<TicketGitHubSource>;
    readonly watermark: string | null;
  }) {
    const { source, sources, watermark } = input;
    const { host, repository } = source;
    const updatedSince =
      watermark === null
        ? undefined
        : DateTime.makeUnsafe(watermark).pipe(
            DateTime.subtractDuration(SYNC_INTERVAL),
            DateTime.startOf("second"),
            DateTime.formatIso,
          );
    const states: ReadonlyArray<"open" | "closed"> =
      watermark === null ? ["open"] : ["open", "closed"];
    const warnings: Array<string> = [];
    let complete = true;
    let count: number | null = null;
    let malformed = 0;
    const failedIssues = new Map<number, string>();

    for (const state of states) {
      const listed = new Map<number, string>();
      let cursor: ProviderIssueListCursor | undefined;
      let scanned = false;
      let stateMalformed = 0;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const batch = yield* github.run(source, (api, cwd) =>
          api.listIssues({
            cwd,
            host,
            repository,
            state,
            limit: PAGE_SIZE,
            includeBody: true,
            ...(state === "open" && page === 0 ? { includeOpenCount: true } : {}),
            ...(updatedSince === undefined ? {} : { updatedSince }),
            ...(cursor === undefined ? {} : { cursor }),
          }),
        );
        if (state === "open" && page === 0) count = batch.totalOpenCount ?? null;
        stateMalformed += batch.skippedCount ?? 0;
        const fresh = batch.issues.filter((issue) => !listed.has(issue.number));
        const applied: Array<number> = [];
        for (const issue of fresh) {
          listed.set(issue.number, issue.updatedAt);
          for (const target of sources) {
            const written = yield* tickets
              .upsertGitHubIssue({ projectId: target.projectId, host, repository, issue })
              .pipe(Effect.result);
            if (Result.isFailure(written)) {
              const cause = written.failure.cause;
              if (!isIssueProviderError(cause) || !isUnreadableIssue(cause))
                return yield* written.failure;
              failedIssues.set(
                issue.number,
                `${repository}#${issue.number}: ${TicketGitHub.describeGitHubFailure(cause)}`,
              );
            }
          }
          if (!failedIssues.has(issue.number)) applied.push(issue.number);
        }
        if (applied.length > 0)
          yield* sql`
            DELETE FROM ticket_github_sync_pending
            WHERE host = ${host} AND repository = ${repository} AND number IN ${sql.in(applied)}
          `;
        if (!batch.truncated) {
          scanned = true;
          break;
        }
        if (fresh.length === 0) {
          warnings.push(`The ${state} issue search stopped making progress. Sync will retry.`);
          break;
        }
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
        if (page === MAX_PAGES - 1)
          warnings.push(`The ${state} issue search reached the sync page limit. Sync will retry.`);
      }
      malformed += stateMalformed;
      complete &&= scanned && stateMalformed === 0;
      if (state === "open" && scanned && stateMalformed === 0 && watermark === null) {
        count ??= listed.size;
        const unlisted = (yield* tickets.openGitHubIssueNumbers(source)).filter(
          (number) => !listed.has(number),
        );
        yield* sql.withTransaction(
          Effect.forEach(
            unlisted,
            (number) => sql`
              INSERT INTO ticket_github_sync_pending (host, repository, number)
              VALUES (${host}, ${repository}, ${number})
              ON CONFLICT (host, repository, number) DO NOTHING
            `,
            { discard: true },
          ),
        );
      }
    }
    if (malformed > 0)
      warnings.push(`${malformed} issue search results could not be read. Sync will retry.`);
    complete &&= failedIssues.size === 0;

    const pending = yield* sql<{ readonly number: number }>`
      SELECT number FROM ticket_github_sync_pending
      WHERE host = ${host} AND repository = ${repository}
      ORDER BY last_attempt_at, number LIMIT ${MAX_UNLISTED_REFRESHES}
    `;
    const [latest] = yield* sql<{ readonly last_attempt_at: string | null }>`
      SELECT MAX(last_attempt_at) AS last_attempt_at FROM ticket_github_sync_pending
      WHERE host = ${host} AND repository = ${repository}
    `;
    let monotonicRetryAt = Math.max(
      Date.parse(yield* now),
      latest?.last_attempt_at == null ? 0 : Date.parse(latest.last_attempt_at) + 1,
    );
    let skipped = 0;
    let firstError: string | null = null;
    for (const { number } of pending) {
      const refreshed = yield* tickets
        .refreshGitHubIssueMetadata({
          ...source,
          number,
          projectIds: sources.map((target) => target.projectId),
        })
        .pipe(
          Effect.catchTags({
            IssueProviderError: (error) => {
              if (!isUnreadableIssue(error)) return Effect.fail(error);
              skipped += 1;
              firstError ??= `${repository}#${number}: ${TicketGitHub.describeGitHubFailure(error)}`;
              return Effect.succeed(null);
            },
          }),
        );
      if (refreshed !== "resolved") {
        yield* sql`
          UPDATE ticket_github_sync_pending SET last_attempt_at = ${DateTime.formatIso(DateTime.makeUnsafe(monotonicRetryAt))}
          WHERE host = ${host} AND repository = ${repository} AND number = ${number}
        `;
        monotonicRetryAt += 1;
      } else {
        yield* sql`
          DELETE FROM ticket_github_sync_pending
          WHERE host = ${host} AND repository = ${repository} AND number = ${number}
        `;
      }
    }
    if (firstError !== null)
      warnings.push(
        skipped > 1 ? `${firstError} (${skipped - 1} more issue reads failed.)` : firstError,
      );
    const firstFailedIssue = failedIssues.values().next().value;
    if (firstFailedIssue !== undefined)
      warnings.push(
        failedIssues.size > 1
          ? `${firstFailedIssue} (${failedIssues.size - 1} more issue reads failed.)`
          : firstFailedIssue,
      );
    return { count, complete, lastError: warnings.length === 0 ? null : warnings.join(" ") };
  });

  const syncRepository = Effect.fn("TicketGitHubSync.syncRepository")(
    function* (ref: TicketGitHubSourceRef, flight: NonNullable<ReturnType<typeof flights.get>>) {
      const rows = yield* sql<SourceRow>`
      SELECT project_id, host, repository, enabled, last_synced_at, last_error, issue_count,
        sync_watermark_at
      FROM ticket_github_sources WHERE host = ${ref.host} AND repository = ${ref.repository}
      ORDER BY created_at, project_id
    `;
      const participants = rows.filter(
        (row) => row.enabled === 1 || flight.manualProjects.has(ProjectId.make(row.project_id)),
      );
      const sources = yield* Effect.forEach(participants, toSource);
      const source =
        sources.find((candidate) => candidate.projectId === ref.projectId) ?? sources[0];
      if (source === undefined) return;
      for (const target of sources) flight.coveredProjects.add(target.projectId);
      const watermark = participants.reduce<string | null>(
        (oldest, row) =>
          oldest === null || row.sync_watermark_at === null
            ? null
            : Date.parse(row.sync_watermark_at) < Date.parse(oldest)
              ? row.sync_watermark_at
              : oldest,
        participants[0]?.sync_watermark_at ?? null,
      );
      const startedAt = yield* now;
      const outcome = yield* importIssues({ source, sources, watermark }).pipe(
        Effect.catchTags({
          SqlError: (cause) =>
            Effect.fail(
              new TicketError({ message: "Could not save pending GitHub issue reads.", cause }),
            ),
        }),
        Effect.result,
      );
      const at = yield* now;
      if (Result.isFailure(outcome))
        yield* Effect.logWarning("GitHub ticket sync failed", {
          repository: ref.repository,
          error: TicketGitHub.describeGitHubFailure(outcome.failure),
        });
      yield* sql.withTransaction(
        Effect.forEach(
          sources,
          (target) => {
            const where = sql`project_id = ${target.projectId} AND host = ${target.host}
            AND repository = ${target.repository}`;
            if (Result.isSuccess(outcome))
              return sql`
              UPDATE ticket_github_sources
              SET last_synced_at = ${at}, last_attempt_at = ${at},
                last_error = ${outcome.success.lastError},
                issue_count = COALESCE(${outcome.success.count}, issue_count),
                sync_watermark_at = CASE WHEN ${outcome.success.complete ? 1 : 0} = 1
                  THEN ${startedAt} ELSE sync_watermark_at END
              WHERE ${where}
            `;
            return sql`
            UPDATE ticket_github_sources
            SET last_attempt_at = ${at}, last_error = ${TicketGitHub.describeGitHubFailure(outcome.failure)}
            WHERE ${where}
          `;
          },
          { discard: true },
        ),
      );
      yield* publish;
    },
    Effect.provideService(Interactive, false),
    (effect, ref) => repositoryLocks.withLock(repositoryKey(ref), effect),
    Effect.mapError(ticketError("Could not record the sync result.")),
  );

  const requestRepository = Effect.fn("TicketGitHubSync.requestRepository")(function* (
    ref: TicketGitHubSourceRef,
    manual: boolean,
  ) {
    const key = repositoryKey(ref);
    yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        while (true) {
          const existing = flights.get(key);
          if (existing !== undefined) {
            if (manual) existing.manualProjects.add(ref.projectId);
            yield* restore(Deferred.await(existing.done));
            if (!manual || existing.coveredProjects.has(ref.projectId)) return;
            continue;
          }
          const flight = {
            done: Deferred.makeUnsafe<void, TicketError>(),
            manualProjects: new Set(manual ? [ref.projectId] : []),
            coveredProjects: new Set<ProjectId>(),
          };
          flights.set(key, flight);
          yield* restore(syncRepository(ref, flight)).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => flights.delete(key)).pipe(
                Effect.andThen(Deferred.done(flight.done, exit)),
              ),
            ),
          );
          return;
        }
      }),
    );
  });

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
      if (
        registry
          .get(SourceControlProviderKind.make("github"))
          ?.repositoryLinks({ host, repository: input.repository }) == null
      ) {
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
    }).pipe((effect) => repositoryLocks.withLock(repositoryKey(input), effect));

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
          yield* sql`
            DELETE FROM ticket_github_sync_pending
            WHERE host = ${source.host} AND repository = ${source.repository}
          `;
        }
      }
      yield* publish;
      return yield* readSources;
    }).pipe(
      Effect.catchTags({
        SqlError: (cause) =>
          Effect.fail(new TicketError({ message: "Could not remove the GitHub source.", cause })),
      }),
      (effect) => repositoryLocks.withLock(repositoryKey(input), effect),
    );

  const syncNow: TicketGitHubSync["Service"]["syncNow"] = (input) =>
    Effect.gen(function* () {
      yield* readSource(input);
      yield* requestRepository(input, true);
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
    const repositories = new Map<string, TicketGitHubSourceRef>();
    for (const row of due) {
      const ref = {
        projectId: ProjectId.make(row.project_id),
        host: row.host,
        repository: row.repository,
      };
      repositories.set(repositoryKey(ref), ref);
    }
    for (const ref of repositories.values())
      yield* requestRepository(ref, false).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("GitHub ticket sync stopped for a repository", {
            repository: ref.repository,
            cause,
          }),
        ),
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
