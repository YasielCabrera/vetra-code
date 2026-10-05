import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  EnvironmentId,
  GitHubIssueSnapshot,
  ProviderInstanceId,
  ThreadId,
  type ChatAttachment,
  OrchestrationV2ThreadShell,
  type TicketAttachment,
  type TicketDetail,
  type TicketListEvent,
  type TicketPlan,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import type * as Tool from "effect/unstable/ai/Tool";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Statement from "effect/unstable/sql/Statement";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";

import {
  createPendingAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
} from "../../../attachmentStore.ts";
import * as ServerConfig from "../../../config.ts";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import { SqlitePersistenceMemory } from "../../../persistence/Layers/Sqlite.ts";
import * as TicketGitHub from "../../../ticket/TicketGitHub.ts";
import * as TicketService from "../../../ticket/TicketService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { TicketsToolkitHandlersLive } from "./handlers.ts";
import { TicketsToolkit } from "./tools.ts";

const decodeCaller = Schema.decodeUnknownEffect(OrchestrationV2ThreadShell);
const encodeGitHubSnapshot = Schema.encodeEffect(Schema.fromJsonString(GitHubIssueSnapshot));

const callerId = ThreadId.make("caller-thread");
const providerInstanceId = ProviderInstanceId.make("codex");
const externalLayers = Layer.mergeAll(
  Layer.succeed(HostProcessPlatform, HostProcessPlatform.defaultValue()),
  Layer.succeed(McpInvocationContext.McpInvocationContext, {
    environmentId: EnvironmentId.make("environment"),
    threadId: callerId,
    providerSessionId: "session",
    providerInstanceId,
    issuedAt: 0,
    capabilities: new Set(["orchestration", "tickets"] as const),
  }),
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: () =>
      decodeCaller({
        createdBy: "user",
        creationSource: "web",
        id: callerId,
        projectId: "project",
        title: "Agent",
        providerInstanceId,
        modelSelection: { provider: "codex", model: "gpt-5" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: callerId },
        forkedFrom: null,
        activeProviderThreadId: null,
        latestRunId: "run",
        activeRunId: "run",
        status: "running",
        pendingRuntimeRequest: null,
        latestVisibleMessage: null,
        latestUserMessageAt: null,
        hasActionableProposedPlan: false,
        itemCount: 0,
        visibleItemCount: 0,
        createdAt: DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"),
        updatedAt: DateTime.makeUnsafe("2026-10-01T00:00:00.000Z"),
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        deletedAt: null,
      }).pipe(Effect.orDie),
  }),
  Layer.mock(TicketGitHub.TicketGitHub)({}),
);
const layerFor = (
  overrides: {
    readonly fileSystem?: (fs: FileSystem.FileSystem) => FileSystem.FileSystem;
    readonly sql?: (sql: SqlClient.SqlClient) => SqlClient.SqlClient;
  } = {},
) =>
  TicketsToolkitHandlersLive.pipe(
    Layer.provideMerge(TicketService.layer),
    Layer.provideMerge(externalLayers),
    Layer.provideMerge(
      Layer.effect(
        SqlClient.SqlClient,
        Effect.map(SqlClient.SqlClient, (sql) => overrides.sql?.(sql) ?? sql),
      ).pipe(Layer.provide(SqlitePersistenceMemory)),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "vetra-ticket-local-" })),
    Layer.provideMerge(
      Layer.effect(
        FileSystem.FileSystem,
        Effect.map(FileSystem.FileSystem, (fs) => overrides.fileSystem?.(fs) ?? fs),
      ).pipe(Layer.provide(NodeServices.layer)),
    ),
    Layer.provideMerge(NodeServices.layer),
  );

type Tools = (typeof TicketsToolkit)["tools"];
const call = <Name extends keyof Tools & string>(
  name: Name,
  raw: Tool.ParametersEncoded<Tools[Name]>,
) =>
  Effect.gen(function* () {
    const toolkit = yield* TicketsToolkit;
    const results = yield* toolkit.handle(name, raw).pipe(Stream.unwrap, Stream.runCollect);
    const output = results.at(-1);
    if (output === undefined || output.isFailure)
      return yield* Effect.die(new Error(`${name} did not succeed.`));
    return output.result as Tool.Success<Tools[Name]>;
  });
const source = Effect.fn(function* (name: string, bytes = name) {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(config.attachmentsDir, "..", "sources");
  yield* fs.makeDirectory(directory, { recursive: true });
  const filePath = path.join(directory, name);
  yield* fs.writeFileString(filePath, bytes);
  return { path: filePath };
});
const pending = Effect.fn(function* (name: string, bytes: string) {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* ServerConfig.ServerConfig;
  const attachment = {
    id: ChatAttachmentId.make(createPendingAttachmentId(".txt")),
    type: "file" as const,
    name,
    mimeType: "text/plain",
    sizeBytes: new TextEncoder().encode(bytes).length,
  };
  const path = resolveAttachmentPath({ attachmentsDir: config.attachmentsDir, attachment });
  if (path === null) return yield* Effect.die(new Error("Pending path missing."));
  yield* fs.writeFileString(path, bytes);
  return attachment satisfies ChatAttachment;
});
const bytesFor = Effect.fn(function* (id: string) {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = resolveAttachmentPathById({
    attachmentsDir: config.attachmentsDir,
    attachmentId: id,
  });
  if (path === null) return yield* Effect.die(new Error(`Owned attachment '${id}' is missing.`));
  return yield* fs.readFileString(path);
});
const ownedFiles = Effect.fn(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.readDirectory(config.attachmentsDir))
    .filter((name) => name.startsWith("ticket-"))
    .sort();
});
const expectPersisted = Effect.fn(function* (
  ticket: string,
  attachments: ReadonlyArray<TicketAttachment>,
) {
  const detail = yield* call("t3_ticket_get", { ticket });
  for (const attachment of attachments) {
    expect(detail.attachments.find((stored) => stored.id === attachment.id)).toEqual(attachment);
    expect(attachment.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  }
  return detail;
});

const attachmentWrites = ["create", "update", "createPlan", "updatePlan"] as const;
const attachmentWriteScenario = Effect.fn(function* (operation: (typeof attachmentWrites)[number]) {
  const ticket = yield* call("t3_ticket_create", {
    title: "Before ticket",
    body: "Before body",
    attachments: [yield* source("original.txt", "original")],
    linkCaller: false,
  });
  const [attachment] = ticket.attachments;
  if (attachment === undefined) return yield* Effect.die(new Error("Original file missing."));
  const plan = yield* call("t3_ticket_plan_create", {
    ticket: ticket.id,
    title: "Before plan",
    body: `[original](vetra-attachment://${attachment.id})`,
  });
  const local = yield* source("local.txt", "local");
  const upload = yield* pending("pending.txt", "pending");
  const attachments = [local, upload];
  const linkedThread = ThreadId.make("linked-thread");
  const write = (() => {
    switch (operation) {
      case "create":
        return call("t3_ticket_create", {
          title: "Changed ticket",
          attachments,
          links: [{ kind: "thread", threadId: linkedThread }],
          linkCaller: false,
        }).pipe(Effect.asVoid);
      case "update":
        return call("t3_ticket_update", {
          ticket: ticket.id,
          expectedRevision: 1,
          title: "Changed ticket",
          attachments,
          removeAttachmentIds: [attachment.id],
        }).pipe(Effect.asVoid);
      case "createPlan":
        return call("t3_ticket_plan_create", {
          ticket: ticket.id,
          title: "Changed plan",
          attachments,
        }).pipe(Effect.asVoid);
      case "updatePlan":
        return call("t3_ticket_plan_update", {
          plan: plan.planId,
          expectedRevision: 1,
          title: "Changed plan",
          attachments,
        }).pipe(Effect.asVoid);
    }
  })();
  return { ticket, plan, attachment, local, upload, linkedThread, write };
});

describe("one-call local ticket and plan attachments", () => {
  it.live.skipIf(HostProcessPlatform.defaultValue() === "win32")(
    "preserves exact spaced paths and basenames when adjacent filenames contain different bytes",
    () =>
      Effect.gen(function* () {
        const plain = yield* source("report.txt", "plain bytes");
        const spaced = yield* source("report.txt ", "spaced bytes");
        const created = yield* call("t3_ticket_create", {
          title: "Exact sources",
          attachments: [plain, spaced],
          linkCaller: false,
        });
        expect(created.attachments.map(({ name }) => name)).toEqual(["report.txt", "report.txt "]);
        expect(yield* bytesFor(created.attachments[0]!.id)).toBe("plain bytes");
        expect(yield* bytesFor(created.attachments[1]!.id)).toBe("spaced bytes");
        yield* expectPersisted(created.id, created.attachments);
        const fs = yield* FileSystem.FileSystem;
        expect(yield* fs.readFileString(plain.path)).toBe("plain bytes");
        expect(yield* fs.readFileString(spaced.path)).toBe("spaced bytes");
      }).pipe(Effect.provide(layerFor())),
  );

  it.live("creates and edits tickets with ordered independent image, video, and file copies", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sources = [
        yield* source("shot.png", "image"),
        yield* source("clip.mp4", "video"),
        yield* source("log.txt", "logs"),
      ];
      const created = yield* call("t3_ticket_create", {
        title: "Evidence",
        body: "Keep this body",
        attachments: sources,
        linkCaller: false,
      });
      expect(
        created.attachments.map(({ name, type, mimeType, sizeBytes }) => ({
          name,
          type,
          mimeType,
          sizeBytes,
        })),
      ).toEqual([
        { name: "shot.png", type: "image", mimeType: "image/png", sizeBytes: 5 },
        { name: "clip.mp4", type: "file", mimeType: "video/mp4", sizeBytes: 5 },
        { name: "log.txt", type: "file", mimeType: "text/plain", sizeBytes: 4 },
      ]);
      expect((yield* expectPersisted(created.id, created.attachments)).body).toBe("Keep this body");
      for (const file of sources) expect(yield* fs.exists(file.path)).toBe(true);
      yield* fs.writeFileString(sources[0]!.path, "changed");
      yield* fs.remove(sources[1]!.path);
      expect(yield* bytesFor(created.attachments[0]!.id)).toBe("image");
      expect(yield* bytesFor(created.attachments[1]!.id)).toBe("video");
      const edited = yield* call("t3_ticket_update", {
        ticket: created.id,
        expectedRevision: 99,
        attachments: [yield* source("extra.unknown-extension", "extra")],
      });
      expect(edited.revision).toBe(1);
      expect(edited.attachments[0]).toMatchObject({
        type: "file",
        mimeType: "application/octet-stream",
        sizeBytes: 5,
      });
      expect((yield* expectPersisted(created.id, edited.attachments)).body).toBe("Keep this body");
      yield* call("t3_ticket_update", {
        ticket: created.id,
        expectedRevision: 99,
        removeAttachmentIds: [created.attachments[0]!.id],
      });
      expect((yield* call("t3_ticket_get", { ticket: created.id })).attachments).toHaveLength(3);
      expect(yield* ownedFiles()).toHaveLength(3);
      expect(yield* fs.readFileString(sources[0]!.path)).toBe("changed");
    }).pipe(Effect.provide(layerFor())),
  );

  it.live("rewrites complete aliases once, preserves unknown targets, and rejects duplicates", () =>
    Effect.gen(function* () {
      const file = yield* source("shot.png", "image");
      const created = yield* call("t3_ticket_create", {
        title: "Aliases",
        linkCaller: false,
        body: "![one](vetra-attachment://shot) ![two](vetra-attachment://shot2) [unknown](vetra-attachment://shot.png) [path](vetra-attachment://shot/extra) vetra-attachment://other. See vetra-attachment://shot.",
        attachments: [
          { ...file, ref: "shot" },
          { ...file, ref: "shot2" },
        ],
      });
      const [one, two] = created.attachments;
      const detail = yield* call("t3_ticket_get", { ticket: created.id });
      expect(detail.body).toBe(
        `![one](vetra-attachment://${one!.id}) ![two](vetra-attachment://${two!.id}) [unknown](vetra-attachment://shot.png) [path](vetra-attachment://shot/extra) vetra-attachment://other. See vetra-attachment://${one!.id}.`,
      );
      const before = yield* ownedFiles();
      const duplicate = yield* call("t3_ticket_update", {
        ticket: created.id,
        expectedRevision: 1,
        attachments: [
          { ...file, ref: "shot" },
          { ...file, ref: "shot" },
        ],
      }).pipe(Effect.flip);
      expect(duplicate).toMatchObject({
        _tag: "TicketError",
        message: "Duplicate attachment reference 'shot'.",
      });
      expect(yield* ownedFiles()).toEqual(before);
      const upload = yield* pending("pending.txt", "pending");
      const collision = yield* call("t3_ticket_update", {
        ticket: created.id,
        expectedRevision: 1,
        attachments: [upload, { ...file, ref: upload.id }],
      }).pipe(Effect.flip);
      expect(collision).toMatchObject({ _tag: "TicketError" });
      expect(yield* ownedFiles()).toEqual(before);
    }).pipe(Effect.provide(layerFor())),
  );

  it.live(
    "creates and updates plans with visible escaped references, alias placement, and revisions",
    () =>
      Effect.gen(function* () {
        const ticket = yield* call("t3_ticket_create", { title: "Plans", linkCaller: false });
        const image = yield* source("shot[1].png", "image");
        const video = yield* source("clip.mp4", "video");
        const file = yield* source("log](bad).txt", "file");
        const plan = yield* call("t3_ticket_plan_create", {
          ticket: ticket.id,
          title: "Plan",
          body: "Here ![placed](vetra-attachment://video)",
          attachments: [image, { ...video, ref: "video" }, file],
        });
        expect(plan.attachments.map(({ name }) => name)).toEqual([
          "shot[1].png",
          "clip.mp4",
          "log](bad).txt",
        ]);
        const detail = yield* call("t3_ticket_plan_get", { plan: plan.ref });
        expect(detail.body).toBe(
          `Here ![placed](vetra-attachment://${plan.attachments[1]!.id})\n\n![shot\\[1\\].png](vetra-attachment://${plan.attachments[0]!.id})\n\n[log\\]\\(bad\\).txt](vetra-attachment://${plan.attachments[2]!.id})`,
        );
        const stored = yield* (yield* TicketService.TicketService).getPlan(plan.planId);
        expect(new Set(stored.attachments.map(({ id }) => id))).toEqual(
          new Set(plan.attachments.map(({ id }) => id)),
        );
        yield* expectPersisted(ticket.id, plan.attachments);
        const updated = yield* call("t3_ticket_plan_update", {
          plan: plan.ref,
          expectedRevision: 1,
          attachments: [yield* source("next.mp4", "next")],
        });
        expect(updated.revision).toBe(2);
        const after = yield* call("t3_ticket_plan_get", { plan: plan.ref });
        expect(after.body).toBe(
          `${detail.body}\n\n![next.mp4](vetra-attachment://${updated.attachments[0]!.id})`,
        );
        const edits = yield* call("t3_ticket_plan_update", {
          plan: plan.ref,
          expectedRevision: 2,
          edits: [{ find: "Here", replace: "Updated ![inline](vetra-attachment://last)" }],
          attachments: [{ ...image, ref: "last" }],
        });
        expect(edits.revision).toBe(3);
        expect((yield* call("t3_ticket_plan_get", { plan: plan.ref })).body).toContain(
          `Updated ![inline](vetra-attachment://${edits.attachments[0]!.id})`,
        );
      }).pipe(Effect.provide(layerFor())),
  );

  it.live(
    "keeps mixed pending and local results ordered without exposing local aliases as pending IDs",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const local = yield* source("local.txt", "local");
        const upload = { ...(yield* pending("pending.txt", "pending")), mimeType: "TEXT/PLAIN" };
        const created = yield* call("t3_ticket_create", {
          title: "Mixed",
          body: `[local](vetra-attachment://local) [pending](vetra-attachment://${upload.id})`,
          attachments: [{ ...local, ref: "local" }, upload, local],
          linkCaller: false,
        });
        expect(created.attachments[1]?.mimeType).toBe("text/plain");
        expect(created.attachments.map(({ name }) => name)).toEqual([
          "local.txt",
          "pending.txt",
          "local.txt",
        ]);
        expect((yield* expectPersisted(created.id, created.attachments)).body).toBe(
          `[local](vetra-attachment://${created.attachments[0]!.id}) [pending](vetra-attachment://${created.attachments[1]!.id})`,
        );
        expect(yield* bytesFor(upload.id)).toBe("pending");
        expect(yield* fs.readFileString(local.path)).toBe("local");
        const service = yield* TicketService.TicketService;
        const result = yield* service.update(
          {
            ticketId: created.id,
            expectedRevision: 1,
            attachments: [{ ...local, ref: "another" }, upload],
          },
          { type: "agent", threadId: callerId },
        );
        expect(result.attachments).toEqual([
          { pendingId: upload.id, attachmentId: result.storedAttachments[1]!.id },
        ]);
        expect(result.storedAttachments.map(({ name }) => name)).toEqual([
          "local.txt",
          "pending.txt",
        ]);
      }).pipe(Effect.provide(layerFor())),
  );

  it.live(
    "rolls back stale body and plan edits, archived plans, bad comments, and expanded body limits",
    () =>
      Effect.gen(function* () {
        const file = yield* source("file.txt", "file");
        const ticket = yield* call("t3_ticket_create", {
          title: "Failures",
          body: "Original",
          linkCaller: false,
        });
        const plan = yield* call("t3_ticket_plan_create", {
          ticket: ticket.id,
          title: "Plan",
          body: "Original",
        });
        const before = yield* ownedFiles();
        expect(
          (yield* call("t3_ticket_update", {
            ticket: ticket.id,
            expectedRevision: 99,
            body: "Changed",
            attachments: [file],
          }).pipe(Effect.flip))._tag,
        ).toBe("TicketRevisionConflictError");
        expect(
          (yield* call("t3_ticket_plan_update", {
            plan: plan.ref,
            expectedRevision: 99,
            attachments: [file],
          }).pipe(Effect.flip))._tag,
        ).toBe("TicketPlanRevisionConflictError");
        expect(
          (yield* call("t3_ticket_plan_update", {
            plan: plan.ref,
            expectedRevision: 1,
            attachments: [file],
            resolveCommentIds: ["missing-comment"],
          }).pipe(Effect.flip))._tag,
        ).toBe("TicketError");
        expect(
          (yield* call("t3_ticket_plan_create", {
            ticket: ticket.id,
            title: "Too long",
            body: "x".repeat(100_000),
            attachments: [file],
          }).pipe(Effect.flip))._tag,
        ).toBe("TicketError");
        expect(
          (yield* call("t3_ticket_update", {
            ticket: ticket.id,
            expectedRevision: 1,
            body: `${"x".repeat(99_970)}vetra-attachment://f`,
            attachments: [{ ...file, ref: "f" }],
          }).pipe(Effect.flip))._tag,
        ).toBe("TicketError");
        yield* call("t3_ticket_plan_update", {
          plan: plan.ref,
          expectedRevision: 1,
          status: "archived",
        });
        expect(
          (yield* call("t3_ticket_plan_update", {
            plan: plan.ref,
            expectedRevision: 1,
            attachments: [file],
          }).pipe(Effect.flip))._tag,
        ).toBe("TicketError");
        expect(yield* ownedFiles()).toEqual(before);
        expect((yield* call("t3_ticket_get", { ticket: ticket.id })).body).toBe("Original");
        expect((yield* call("t3_ticket_plan_get", { plan: plan.ref })).body).toBe("Original");
      }).pipe(Effect.provide(layerFor())),
  );

  it.live(
    "rejects missing, relative, empty, special, and oversized sources and accepts a regular symlink",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const regular = yield* source("file.txt", "valid");
        const empty = yield* source("empty.txt", "");
        const oversized = yield* source("oversized.png", "x");
        yield* fs.truncate(oversized.path, 10 * 1024 * 1024 + 1);
        const directory = path.join(path.dirname(regular.path), "directory");
        yield* fs.makeDirectory(directory);
        const invalid = [
          path.join(directory, "missing"),
          "relative.txt",
          "~/file.txt",
          "file:///tmp/file.txt",
          empty.path,
          oversized.path,
          directory,
        ];
        let unreadable: string | undefined;
        if ((yield* HostProcessPlatform) !== "win32" && process.getuid?.() !== 0) {
          unreadable = (yield* source("unreadable.txt", "private")).path;
          yield* fs.chmod(unreadable, 0o000);
          invalid.push(unreadable);
        }
        if ((yield* HostProcessPlatform) !== "win32") {
          const fifo = path.join(directory, "fifo");
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const process = yield* spawner.spawn(ChildProcess.make("mkfifo", [fifo]));
          expect(Number(yield* process.exitCode)).toBe(0);
          invalid.push(fifo);
        }
        for (const filePath of invalid) {
          const failure = yield* call("t3_ticket_create", {
            title: "Invalid",
            attachments: [regular, { path: filePath }],
            linkCaller: false,
          }).pipe(Effect.flip);
          expect(failure).toMatchObject({ _tag: "TicketError" });
          expect(failure.message).toContain(filePath);
          expect(yield* ownedFiles()).toEqual([]);
        }
        if (unreadable !== undefined) yield* fs.chmod(unreadable, 0o600);
        const symlink = path.join(directory, "linked.txt");
        yield* fs.symlink(regular.path, symlink);
        const created = yield* call("t3_ticket_create", {
          title: "Link",
          attachments: [{ path: symlink }],
          linkCaller: false,
        });
        expect(created.attachments[0]).toMatchObject({
          name: "linked.txt",
          mimeType: "text/plain",
        });
        expect(yield* bytesFor(created.attachments[0]!.id)).toBe("valid");
      }).pipe(Effect.provide(layerFor())),
  );

  it.live("cleans prior local copies when a later pending upload is absent or has wrong size", () =>
    Effect.gen(function* () {
      const local = yield* source("local.txt", "local");
      const upload = yield* pending("pending.txt", "pending");
      for (const bad of [
        { ...upload, sizeBytes: 99 },
        { ...upload, id: ChatAttachmentId.make(createPendingAttachmentId(".txt")) },
      ]) {
        expect(
          (yield* call("t3_ticket_create", {
            title: "Batch",
            attachments: [local, bad],
            linkCaller: false,
          }).pipe(Effect.flip))._tag,
        ).toBe("TicketError");
        expect(yield* ownedFiles()).toEqual([]);
      }
      expect(yield* bytesFor(upload.id)).toBe("pending");
    }).pipe(Effect.provide(layerFor())),
  );

  it.live("allows local attachments on GitHub tickets but rolls them back for issue edits", () =>
    Effect.gen(function* () {
      const ticket = yield* call("t3_ticket_create", {
        title: "GitHub",
        body: "Issue body",
        linkCaller: false,
      });
      const sql = yield* SqlClient.SqlClient;
      const snapshot = yield* encodeGitHubSnapshot({
        host: "github.com",
        repository: "acme/app",
        number: 7,
        state: "open",
        stateReason: null,
        author: "octocat",
        assignees: [],
        updatedAt: "2026-10-01T00:00:00.000Z",
        syncedAt: "2026-10-01T00:00:00.000Z",
        url: "https://github.com/acme/app/issues/7",
      });
      yield* sql`UPDATE tickets SET kind = 'github', github_host = 'github.com', github_repository = 'acme/app', github_number = 7, github_snapshot_json = ${snapshot} WHERE ticket_id = ${ticket.id}`;
      const local = yield* source("issue.txt", "issue");
      const updated = yield* call("t3_ticket_update", {
        ticket: ticket.id,
        expectedRevision: 99,
        attachments: [local],
      });
      expect(updated.revision).toBe(1);
      const before = yield* ownedFiles();
      expect(
        (yield* call("t3_ticket_update", {
          ticket: ticket.id,
          expectedRevision: 1,
          body: "Edit issue",
          attachments: [local],
        }).pipe(Effect.flip))._tag,
      ).toBe("TicketError");
      expect(yield* ownedFiles()).toEqual(before);
      expect((yield* call("t3_ticket_get", { ticket: ticket.id })).body).toBe("Issue body");
    }).pipe(Effect.provide(layerFor())),
  );

  it.live("validates the mixed batch count and image total before creating owned copies", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const regular = yield* source("regular.txt", "regular");
      expect(
        Exit.isFailure(
          yield* Effect.exit(
            call("t3_ticket_create", {
              title: "Count",
              attachments: Array.from({ length: 101 }, () => regular),
              linkCaller: false,
            }),
          ),
        ),
      ).toBe(true);
      const images = [];
      for (let index = 0; index < 8; index++) {
        const image = yield* source(`image-${index}.png`, "x");
        yield* fs.truncate(image.path, 10 * 1024 * 1024);
        images.push(image);
      }
      const config = yield* ServerConfig.ServerConfig;
      const upload = {
        id: ChatAttachmentId.make(createPendingAttachmentId()),
        type: "image" as const,
        name: "pending.png",
        mimeType: "image/png" as const,
        sizeBytes: 10 * 1024 * 1024,
      };
      const pendingPath = resolveAttachmentPath({
        attachmentsDir: config.attachmentsDir,
        attachment: upload,
      });
      if (pendingPath === null) return yield* Effect.die(new Error("Pending image path missing."));
      yield* fs.writeFileString(pendingPath, "x");
      yield* fs.truncate(pendingPath, upload.sizeBytes);
      const failure = yield* call("t3_ticket_create", {
        title: "Total",
        attachments: [...images, upload],
        linkCaller: false,
      }).pipe(Effect.flip);
      expect(failure).toMatchObject({ _tag: "TicketError" });
      expect(failure.message).toContain("80 MiB");
      expect(yield* ownedFiles()).toEqual([]);
      expect(Number((yield* fs.stat(pendingPath)).size)).toBe(upload.sizeBytes);
    }).pipe(Effect.provide(layerFor())),
  );

  it.live("cleans a partial pending destination and preceding local copies on copy failure", () =>
    Effect.gen(function* () {
      const local = yield* source("local.txt", "local");
      const upload = yield* pending("pending.txt", "pending");
      const failure = yield* call("t3_ticket_create", {
        title: "Partial",
        attachments: [local, upload],
        linkCaller: false,
      }).pipe(Effect.flip);
      expect(failure).toMatchObject({ _tag: "TicketError" });
      expect(yield* ownedFiles()).toEqual([]);
      expect(yield* bytesFor(upload.id)).toBe("pending");
    }).pipe(
      Effect.provide(
        layerFor({
          fileSystem: (fs) => ({
            ...fs,
            copyFile: (from, to) =>
              fs
                .writeFileString(to, "partial")
                .pipe(Effect.andThen(fs.copyFile(from, `${to}/impossible`))),
          }),
        }),
      ),
    ),
  );

  it.live("removes local partial files on storage failure and names the source", () =>
    Effect.gen(function* () {
      const local = yield* source("source.txt", "source");
      const failure = yield* call("t3_ticket_create", {
        title: "Write failure",
        attachments: [local],
        linkCaller: false,
      }).pipe(Effect.flip);
      expect(failure).toMatchObject({ _tag: "TicketError" });
      expect(failure.message).toContain(local.path);
      const config = yield* ServerConfig.ServerConfig;
      expect(yield* (yield* FileSystem.FileSystem).readDirectory(config.attachmentsDir)).toEqual(
        [],
      );
      expect(yield* (yield* FileSystem.FileSystem).readFileString(local.path)).toBe("source");
    }).pipe(
      Effect.provide(
        layerFor({
          fileSystem: (fs) => ({
            ...fs,
            sink: (destination, options) =>
              fs
                .sink(destination, options)
                .pipe(
                  Sink.mapEffect(() => fs.stat(`${destination}/impossible`).pipe(Effect.asVoid)),
                ),
          }),
        }),
      ),
    ),
  );

  it.live("rejects a source that grows during copying and removes its finished destination", () => {
    let sourcePath = "";
    return Effect.gen(function* () {
      const local = yield* source("growing.txt", "source");
      sourcePath = local.path;
      const failure = yield* call("t3_ticket_create", {
        title: "Changed source",
        attachments: [local],
        linkCaller: false,
      }).pipe(Effect.flip);
      expect(failure).toMatchObject({ _tag: "TicketError" });
      expect(failure.message).toContain(local.path);
      expect(failure.message).toContain("changed size");
      expect(yield* ownedFiles()).toEqual([]);
      expect(yield* (yield* FileSystem.FileSystem).readFileString(local.path)).toBe("source grew");
    }).pipe(
      Effect.provide(
        layerFor({
          fileSystem: (fs) => ({
            ...fs,
            rename: (from, to) =>
              fs
                .rename(from, to)
                .pipe(Effect.andThen(fs.writeFileString(sourcePath, "source grew"))),
          }),
        }),
      ),
    );
  });

  it.live("removes a completed local copy when interrupted before the transaction", () =>
    Effect.gen(function* () {
      const copied = yield* Deferred.make<void>();
      const gate = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const local = yield* source("source.txt", "source");
        const fiber = yield* Effect.forkChild(
          call("t3_ticket_create", {
            title: "Interrupted",
            attachments: [local],
            linkCaller: false,
          }),
        );
        yield* Deferred.await(copied);
        fiber.interruptUnsafe();
        yield* Deferred.succeed(gate, undefined);
        expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
        expect(yield* ownedFiles()).toEqual([]);
        expect((yield* (yield* TicketService.TicketService).list({ limit: 10 })).tickets).toEqual(
          [],
        );
      }).pipe(
        Effect.provide(
          layerFor({
            fileSystem: (fs) => ({
              ...fs,
              rename: (from, to) =>
                fs
                  .rename(from, to)
                  .pipe(
                    Effect.andThen(Deferred.succeed(copied, undefined)),
                    Effect.andThen(Deferred.await(gate)),
                  ),
            }),
          }),
        ),
      );
    }),
  );

  it.live.each(attachmentWrites)(
    "rolls back %s and its attachment copies when interrupted inside the transaction",
    (operation) =>
      Effect.gen(function* () {
        const inserting = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        const { ticket, plan, attachment, local, upload, write } =
          yield* attachmentWriteScenario(operation);
        const blockAttachmentInsert: Statement.Transformer = (statement) =>
          statement.compile()[0].includes("INSERT INTO ticket_attachments")
            ? Deferred.succeed(inserting, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.as(statement),
              )
            : Effect.succeed(statement);
        const fiber = yield* Effect.forkChild(
          write.pipe(Effect.provideService(Statement.CurrentTransformer, blockAttachmentInsert)),
        );
        yield* Deferred.await(inserting);
        fiber.interruptUnsafe();
        yield* Deferred.succeed(gate, undefined);
        expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
        const sql = yield* SqlClient.SqlClient;
        const counts = yield* sql<{
          readonly tickets: number;
          readonly plans: number;
          readonly attachments: number;
        }>`
            SELECT
              (SELECT COUNT(*) FROM tickets) AS tickets,
              (SELECT COUNT(*) FROM ticket_plans) AS plans,
              (SELECT COUNT(*) FROM ticket_attachments) AS attachments
          `;
        expect(counts).toEqual([{ tickets: 1, plans: 1, attachments: 1 }]);
        expect(yield* call("t3_ticket_get", { ticket: ticket.id })).toMatchObject({
          summary: { title: "Before ticket", revision: 1 },
          body: "Before body",
          attachments: [attachment],
        });
        expect(yield* call("t3_ticket_plan_get", { plan: plan.planId })).toMatchObject({
          plan: { title: "Before plan", revision: 1 },
          body: `[original](vetra-attachment://${attachment.id})`,
        });
        expect(yield* ownedFiles()).toHaveLength(1);
        expect(yield* bytesFor(attachment.id)).toBe("original");
        expect(yield* bytesFor(upload.id)).toBe("pending");
        expect(yield* (yield* FileSystem.FileSystem).readFileString(local.path)).toBe("local");
      }).pipe(Effect.provide(layerFor())),
  );

  it.live.each(attachmentWrites)(
    "completes %s notifications and file ownership when interrupted after SQL commit",
    (operation) =>
      Effect.gen(function* () {
        const committed = yield* Deferred.make<void>();
        const gate = yield* Deferred.make<void>();
        let armed = false;
        yield* Effect.gen(function* () {
          const { ticket, plan, attachment, local, upload, linkedThread, write } =
            yield* attachmentWriteScenario(operation);
          const tickets = yield* TicketService.TicketService;
          const lists = yield* Queue.unbounded<TicketListEvent>();
          const details = yield* Queue.unbounded<TicketDetail>();
          const plans = yield* Queue.unbounded<TicketPlan>();
          const links = yield* Queue.unbounded<ReadonlyArray<ThreadId>>();
          yield* tickets.subscribeList().pipe(
            Stream.runForEach((event) => Queue.offer(lists, event)),
            Effect.forkScoped,
          );
          yield* tickets.subscribeDetail(ticket.id).pipe(
            Stream.runForEach((detail) => Queue.offer(details, detail)),
            Effect.forkScoped,
          );
          yield* tickets.subscribePlan(plan.planId).pipe(
            Stream.runForEach((value) => Queue.offer(plans, value)),
            Effect.forkScoped,
          );
          yield* (yield* tickets.subscribeThreadLinks).pipe(
            Stream.runForEach((ids) => Queue.offer(links, ids)),
            Effect.forkScoped,
          );
          expect(yield* Queue.take(lists)).toMatchObject({
            type: "snapshot",
            tickets: [{ title: "Before ticket" }],
          });
          expect((yield* Queue.take(details)).attachments).toEqual([attachment]);
          expect((yield* Queue.take(plans)).attachments).toEqual([attachment]);
          armed = true;
          const fiber = yield* Effect.forkChild(write);
          yield* Deferred.await(committed);
          fiber.interruptUnsafe();
          yield* Deferred.succeed(gate, undefined);
          expect(Exit.hasInterrupts(yield* Fiber.await(fiber))).toBe(true);
          const delta = yield* Queue.take(lists);
          expect(delta.type).toBe("delta");
          if (delta.type !== "delta") return yield* Effect.die(new Error("Delta missing."));
          expect(delta.upserted).toHaveLength(1);
          const [changedTicket] = delta.upserted;
          if (changedTicket === undefined)
            return yield* Effect.die(new Error("Changed ticket missing."));
          expect(changedTicket.title).toBe(
            operation === "create" || operation === "update" ? "Changed ticket" : "Before ticket",
          );
          const detail = yield* tickets.get(changedTicket.id);
          const added = detail.attachments.filter((value) => value.id !== attachment.id);
          expect(added.map((value) => value.name).sort()).toEqual(["local.txt", "pending.txt"]);
          for (const file of added) {
            expect(yield* bytesFor(file.id)).toBe(file.name === "local.txt" ? "local" : "pending");
          }
          expect(yield* bytesFor(upload.id)).toBe("pending");
          expect(yield* (yield* FileSystem.FileSystem).readFileString(local.path)).toBe("local");
          if (operation === "create") {
            expect(yield* Queue.take(links)).toEqual([linkedThread]);
          } else {
            expect((yield* Queue.take(details)).attachments).toEqual(detail.attachments);
          }
          if (operation === "update") {
            expect((yield* Queue.take(plans)).attachments).toEqual([]);
            expect(detail.attachments).toHaveLength(2);
            expect(yield* ownedFiles()).toHaveLength(2);
            const config = yield* ServerConfig.ServerConfig;
            const removedPath = resolveAttachmentPath({
              attachmentsDir: config.attachmentsDir,
              attachment,
            });
            if (removedPath === null)
              return yield* Effect.die(new Error("Original attachment path missing."));
            expect(yield* (yield* FileSystem.FileSystem).exists(removedPath)).toBe(false);
          } else {
            expect(yield* bytesFor(attachment.id)).toBe("original");
            expect(yield* ownedFiles()).toHaveLength(3);
          }
          if (operation === "createPlan") {
            expect(changedTicket.plans.map((value) => value.title)).toEqual([
              "Before plan",
              "Changed plan",
            ]);
          }
          if (operation === "updatePlan") {
            const changedPlan = yield* Queue.take(plans);
            expect(changedPlan.summary).toMatchObject({ title: "Changed plan", revision: 2 });
            expect(changedPlan.attachments.map((value) => value.name).sort()).toEqual([
              "local.txt",
              "original.txt",
            ]);
          }
        }).pipe(
          Effect.provide(
            layerFor({
              sql: (sql) =>
                new Proxy(sql, {
                  get: (target, key, receiver) =>
                    key === "withTransaction"
                      ? <A, E, R>(effect: Effect.Effect<A, E, R>) =>
                          target.withTransaction(effect).pipe(
                            Effect.tap(() =>
                              armed ? Deferred.succeed(committed, undefined) : Effect.void,
                            ),
                            Effect.tap(() => (armed ? Deferred.await(gate) : Effect.void)),
                          )
                      : Reflect.get(target, key, receiver),
                }),
            }),
          ),
        );
      }),
  );
});
