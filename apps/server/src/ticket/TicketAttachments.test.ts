// @effect-diagnostics nodeBuiltinImport:off - fixtures must also live outside the OS temp root.
import * as NodeOS from "node:os";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ThreadId, TicketId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { resolveAttachmentPath } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import { claimTicketAttachments } from "./TicketAttachments.ts";

const actor = { type: "agent", threadId: ThreadId.make("attachment-caller") } as const;
const ticketId = TicketId.make("attachment-ticket");
const encodeWorkspace = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ worktreePath: Schema.String })),
);

const withWorkspace = <A, E, R>(
  body: (paths: {
    readonly workspaceRoot: string;
    readonly worktreePath: string;
    readonly outsideRoot: string;
    readonly tempRoot: string;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({
      directory: NodeOS.homedir(),
      prefix: "vetra-ticket-path-test-",
    });
    const workspaceRoot = path.join(directory, "repo");
    const worktreePath = path.join(directory, "worktree");
    const outsideRoot = path.join(directory, "repo-evil");
    const tempRoot = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-ticket-temp-test-" });
    for (const root of [workspaceRoot, worktreePath, outsideRoot]) {
      yield* fs.makeDirectory(root);
    }
    return yield* Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const payload = yield* encodeWorkspace({ worktreePath });
      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, scripts_json, created_at, updated_at
        ) VALUES ('attachment-project', 'Project', ${workspaceRoot}, '[]', '2026-10-01', '2026-10-01')
      `;
      yield* sql`
        INSERT INTO orchestration_v2_projection_threads (
          thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
          created_at, updated_at, payload_json
        ) VALUES (
          ${actor.threadId}, 'attachment-project', 'Caller', 'claude', 'approval-required',
          'default', '2026-10-01', '2026-10-01', ${payload}
        )
      `;
      return yield* body({ workspaceRoot, worktreePath, outsideRoot, tempRoot });
    }).pipe(
      Effect.provide(SqlitePersistenceMemory),
      Effect.provide(
        ServerConfig.layerTest(workspaceRoot, path.join(workspaceRoot, ".vetra-code")),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped);

const writeSource = Effect.fn(function* (root: string, name = "report.txt", bytes = "report") {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = path.join(root, name);
  yield* fs.makeDirectory(path.dirname(source), { recursive: true });
  yield* fs.writeFileString(source, bytes);
  return { path: source };
});

describe("TicketAttachments agent path confinement", () => {
  it.effect("copies workspace, worktree, and OS temp files using canonical roots", () =>
    withWorkspace(({ workspaceRoot, worktreePath, tempRoot }) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sql = yield* SqlClient.SqlClient;
        const workspaceAlias = `${workspaceRoot}-alias`;
        const worktreeAlias = `${worktreePath}-alias`;
        yield* fs.symlink(workspaceRoot, workspaceAlias);
        yield* fs.symlink(worktreePath, worktreeAlias);
        yield* sql`UPDATE projection_projects SET workspace_root = ${workspaceAlias}`;
        yield* sql`UPDATE orchestration_v2_projection_threads
          SET payload_json = json_set(payload_json, '$.worktreePath', ${worktreeAlias})`;
        const roots = [workspaceRoot, worktreePath, tempRoot];
        if (path.sep === "/") {
          roots.push(
            yield* fs.makeTempDirectoryScoped({ directory: "/tmp", prefix: "vetra-ticket-" }),
          );
        }
        const sources = yield* Effect.forEach(roots, (root, index) =>
          writeSource(root, `report-${index}.txt`, `bytes-${index}`),
        );
        const claim = yield* claimTicketAttachments(ticketId, sources, actor);
        const config = yield* ServerConfig.ServerConfig;
        assert.strictEqual(claim.attachments.length, sources.length);
        for (const [index, attachment] of claim.attachments.entries()) {
          const storedPath = resolveAttachmentPath({
            attachmentsDir: config.attachmentsDir,
            attachment,
          });
          assert.isNotNull(storedPath);
          assert.strictEqual(yield* fs.readFileString(storedPath!), `bytes-${index}`);
          assert.strictEqual(yield* fs.readFileString(sources[index]!.path), `bytes-${index}`);
        }
      }),
    ),
  );

  it.effect(
    "refuses outside paths, symlink escapes, and Vetra home in every runtime mode without copies",
    () =>
      withWorkspace(({ workspaceRoot, outsideRoot }) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const config = yield* ServerConfig.ServerConfig;
          const sql = yield* SqlClient.SqlClient;
          const workspaceFile = yield* writeSource(workspaceRoot);
          const outside = yield* writeSource(outsideRoot, ".ssh/id_ed25519", "synthetic secret");
          const prefixTrick = yield* writeSource(outsideRoot);
          const secret = yield* writeSource(
            config.secretsDir,
            "test-secret",
            "synthetic Vetra secret",
          );
          const outsideLink = path.join(workspaceRoot, "outside-link.txt");
          const homeLink = path.join(workspaceRoot, "home-link.txt");
          yield* fs.symlink(outside.path, outsideLink);
          yield* fs.symlink(secret.path, homeLink);
          for (const mode of ["approval-required", "auto-accept-edits", "auto", "full-access"]) {
            yield* sql`UPDATE orchestration_v2_projection_threads SET runtime_mode = ${mode}`;
            for (const source of [
              outside,
              prefixTrick,
              secret,
              { path: outsideLink },
              { path: homeLink },
            ]) {
              const error = yield* claimTicketAttachments(
                ticketId,
                [workspaceFile, source],
                actor,
              ).pipe(Effect.flip);
              assert.strictEqual(error._tag, "TicketError");
              assert.include(error.message, "never from the Vetra home");
              assert.include(error.message, "Copy the file into the workspace first.");
              assert.deepStrictEqual(yield* fs.readDirectory(config.attachmentsDir), []);
            }
          }
          assert.strictEqual(yield* fs.readFileString(outside.path), "synthetic secret");
          assert.strictEqual(yield* fs.readFileString(secret.path), "synthetic Vetra secret");
        }),
      ),
  );

  it.effect("refuses an unknown caller even for a temp file", () =>
    withWorkspace(({ tempRoot }) =>
      Effect.gen(function* () {
        const source = yield* writeSource(tempRoot);
        const error = yield* claimTicketAttachments(ticketId, [source], {
          type: "agent",
          threadId: ThreadId.make("unknown"),
        }).pipe(Effect.flip);
        assert.strictEqual(error.message, "Cannot resolve the attachment caller's workspace.");
        const config = yield* ServerConfig.ServerConfig;
        assert.deepStrictEqual(
          yield* (yield* FileSystem.FileSystem).readDirectory(config.attachmentsDir),
          [],
        );
      }),
    ),
  );
});
