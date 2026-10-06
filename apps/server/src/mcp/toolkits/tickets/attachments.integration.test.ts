import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  GitHubIssueSnapshot,
  OrchestrationV2ThreadShell,
  ProviderInstanceId,
  type ChatAttachment,
  type TicketAttachment,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as Tool from "effect/ai/Tool";
import { HttpClient, HttpClientRequest, HttpRouter, HttpServer } from "effect/http";
import * as NetAddress from "effect/net/NetAddress";
import * as SqlClient from "effect/sql/SqlClient";

import { issueAssetUrl } from "../../../assets/AssetAccess.ts";
import * as NativeAppIconResolver from "../../../assets/NativeAppIconResolver.ts";
import { resolveAttachmentPathById } from "../../../attachmentStore.ts";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as ServerHttp from "../../../http.ts";
import * as Orchestrator from "../../../orchestration-v2/Orchestrator.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../../../persistence/Layers/Sqlite.ts";
import * as ProjectFaviconResolver from "../../../project/ProjectFaviconResolver.ts";
import * as T3ProjectFileLoader from "../../../project/T3ProjectFileLoader.ts";
import * as GitHubCli from "../../../sourceControl/GitHubCli.ts";
import * as SourceControlAttachmentResolver from "../../../sourceControl/SourceControlAttachmentResolver.ts";
import * as TicketGitHub from "../../../ticket/TicketGitHub.ts";
import * as TicketService from "../../../ticket/TicketService.ts";
import * as WorkspacePaths from "../../../workspace/WorkspacePaths.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { providerHttpOrigin } from "../../httpOrigin.ts";
import * as AttachmentHandlers from "../attachment/handlers.ts";
import { AttachmentToolkit } from "../attachment/tools.ts";
import { TicketsToolkitHandlersLive } from "./handlers.ts";
import { TicketsToolkit } from "./tools.ts";

const caller = Schema.decodeUnknownSync(OrchestrationV2ThreadShell)({
  createdBy: "user",
  creationSource: "web",
  id: "caller-thread",
  projectId: "caller-project",
  title: "Agent",
  providerInstanceId: "codex",
  modelSelection: { provider: "codex", model: "gpt-5" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: "caller-thread" },
  forkedFrom: null,
  activeProviderThreadId: null,
  latestRunId: "run-1",
  activeRunId: "run-1",
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
});

const configLayer = Layer.effect(
  ServerConfig.ServerConfig,
  Effect.map(ServerConfig.ServerConfig, (config) => ({ ...config, port: 1 })),
).pipe(
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "vetra-mcp-ticket-upload-" })),
);
const externalLayers = Layer.mergeAll(
  Layer.succeed(McpInvocationContext.McpInvocationContext, {
    environmentId: EnvironmentId.make("environment"),
    requestNamespace: "session",
    thread: {
      threadId: caller.id,
      providerSessionId: "session",
      providerInstanceId: ProviderInstanceId.make("codex"),
    },
    client: undefined,
    issuedAt: 0,
    capabilities: new Set(["orchestration", "tickets"] as const),
  }),
  Layer.mock(ThreadManagement.ThreadManagementService)({
    getThreadShell: () => Effect.succeed(caller),
  }),
  Layer.mock(Orchestrator.OrchestratorV2)({}),
  Layer.mock(TicketGitHub.TicketGitHub)({}),
  Layer.mock(ProjectFaviconResolver.ProjectFaviconResolver)({}),
  Layer.mock(T3ProjectFileLoader.T3ProjectFileLoader)({}),
  Layer.mock(NativeAppIconResolver.NativeAppIconResolver)({}),
  Layer.mock(SourceControlAttachmentResolver.SourceControlAttachmentResolver)({}),
  Layer.mock(GitHubCli.GitHubCli)({}),
  SqlitePersistence.layerMemory,
);
const testLayer = Layer.mergeAll(
  TicketsToolkitHandlersLive,
  AttachmentHandlers.layer,
  HttpRouter.serve(Layer.merge(ServerHttp.layerAssetRoute, ServerHttp.layerAttachmentUploadRoute), {
    disableListenLog: true,
    disableLogger: true,
  }),
).pipe(
  Layer.provideMerge(
    Layer.mergeAll(TicketService.layer, ServerSecretStore.layer, WorkspacePaths.layer),
  ),
  Layer.provideMerge(externalLayers),
  Layer.provideMerge(configLayer),
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provideMerge(NodeServices.layer),
);

type Tools = (typeof TicketsToolkit)["tools"];
const decodePrepared = Schema.decodeUnknownEffect(
  AttachmentToolkit.tools.t3_attachment_prepare_upload.successSchema,
);
const decodePrepareInput = Schema.decodeUnknownEffect(
  AttachmentToolkit.tools.t3_attachment_prepare_upload.parametersSchema,
);
const encodeGitHubSnapshot = Schema.encodeEffect(Schema.fromJsonString(GitHubIssueSnapshot));
const call = <Name extends keyof Tools & string>(
  name: Name,
  raw: Tool.ParametersEncoded<Tools[Name]>,
) =>
  Effect.gen(function* () {
    const toolkit = yield* TicketsToolkit;
    const results = yield* toolkit.handle(name, raw).pipe(Stream.unwrap, Stream.runCollect);
    const output = results.at(-1);
    if (output === undefined || output.isFailure)
      return yield* Effect.die(new Error(`${name} did not return a success.`));
    return output.result as Tool.Success<Tools[Name]>;
  });

const prepare = Effect.fn(function* (upload: {
  type: "image" | "file";
  name: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const tool = AttachmentToolkit.tools.t3_attachment_prepare_upload;
  const input = yield* decodePrepareInput({ upload });
  const toolkit = yield* AttachmentToolkit;
  const results = yield* toolkit.handle(tool.name, input).pipe(Stream.unwrap, Stream.runCollect);
  return yield* decodePrepared(results.at(-1)?.result);
});

const request = (input: HttpClientRequest.HttpClientRequest) =>
  Effect.flatMap(HttpClient.HttpClient, (client) => client.execute(input)).pipe(
    Effect.provide(FetchHttpClient.layer),
  );

const upload = Effect.fn(function* (
  type: "image" | "file",
  name: string,
  mimeType: string,
  text: string,
) {
  const bytes = new TextEncoder().encode(text);
  const metadata = { type, name, mimeType, sizeBytes: bytes.byteLength };
  const prepared = yield* prepare(metadata);
  const server = yield* HttpServer.HttpServer;
  const config = yield* ServerConfig.ServerConfig;
  const origin = Result.getOrThrow(providerHttpOrigin(server.address));
  expect(new URL(prepared.uploadUrl).origin).toBe(origin);
  expect(new URL(prepared.uploadUrl).port).not.toBe(String(config.port));
  expect(new URL(prepared.uploadUrl).pathname).toBe(prepared.relativeUrl);
  expect(prepared.expiresAt).toBeGreaterThan(yield* Clock.currentTimeMillis);
  const response = yield* request(
    HttpClientRequest.post(prepared.uploadUrl).pipe(HttpClientRequest.bodyUint8Array(bytes)),
  );
  expect(response.status).toBe(204);
  return { ...metadata, id: prepared.attachmentId } satisfies ChatAttachment;
});

const readBytes = Effect.fn(function* (id: string) {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = resolveAttachmentPathById({
    attachmentsDir: config.attachmentsDir,
    attachmentId: id,
  });
  if (path === null) return yield* Effect.die(new Error(`Attachment ${id} is missing.`));
  return yield* fs.readFileString(path);
});
const ownedFiles = Effect.fn(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  return (yield* fs.readDirectory(config.attachmentsDir))
    .filter((name) => name.startsWith("ticket-"))
    .sort();
});
const bodyFor = (attachments: ReadonlyArray<{ id: string; name: string; mimeType: string }>) =>
  attachments
    .map(
      (attachment) =>
        `${attachment.mimeType === "text/plain" ? "" : "!"}[${attachment.name}](vetra-attachment://${attachment.id})`,
    )
    .join("\n");
const storedForUploads = (
  uploads: ReadonlyArray<ChatAttachment>,
  stored: ReadonlyArray<TicketAttachment>,
) =>
  uploads.map((upload) => {
    const match = stored.find((attachment) => attachment.name === upload.name);
    if (match === undefined) throw new Error(`Stored attachment ${upload.name} is missing.`);
    return match;
  });

describe("ticket attachments through MCP and HTTP", () => {
  it.live("rejects unsupported HTTP origins before requesting the signing key", () =>
    Effect.gen(function* () {
      const toolkit = yield* AttachmentToolkit;
      const server = yield* HttpServer.HttpServer;
      let signingRequests = 0;
      for (const address of [
        NetAddress.unixPathAddress("/tmp/vetra-upload-test.sock"),
        Result.getOrThrow(
          NetAddress.inetAddressV6(Result.getOrThrow(NetAddress.ipv6FromString("fe80::1")), 43123, {
            scopeId: 3,
          }),
        ),
      ]) {
        const results = yield* toolkit
          .handle("t3_attachment_prepare_upload", {
            upload: { type: "file", name: "file.txt", mimeType: "text/plain", sizeBytes: 1 },
          })
          .pipe(
            Stream.unwrap,
            Stream.runCollect,
            Effect.provideService(HttpServer.HttpServer, { ...server, address }),
            Effect.provide(
              Layer.mock(ServerSecretStore.ServerSecretStore)({
                getOrCreateRandom: () =>
                  Effect.sync(() => {
                    signingRequests++;
                    return new Uint8Array(32);
                  }),
              }),
            ),
          );
        expect(results.at(-1)?.isFailure).toBe(true);
        expect(results.at(-1)?.result).toMatchObject({
          _tag: "OrchestratorMcpFailure",
          code: "orchestration_error",
        });
      }
      expect(signingRequests).toBe(0);
    }).pipe(Effect.provide(testLayer)),
  );

  it.live(
    "uploads image, video and file bytes, claims canonical copies, appends and removes them",
    () =>
      Effect.gen(function* () {
        const uploads = [
          yield* upload("image", "shot.png", "image/png", "image"),
          yield* upload("file", "clip.mp4", "video/mp4", "0123456789"),
          yield* upload("file", "notes.txt", "text/plain", "notes"),
        ];
        const created = yield* call("t3_ticket_create", {
          title: "Evidence",
          body: bodyFor(uploads),
          attachments: uploads,
          linkCaller: false,
        });
        const detail = yield* call("t3_ticket_get", { ticket: created.id });
        const stored = storedForUploads(uploads, detail.attachments);
        expect(detail.summary.attachmentCount).toBe(3);
        expect(detail.body).toBe(bodyFor(stored));
        for (const [index, attachment] of stored.entries()) {
          const { id: pendingId, ...metadata } = uploads[index]!;
          expect(attachment.id).toMatch(new RegExp(`^ticket-${created.id}-`));
          expect(attachment.id).not.toBe(pendingId);
          expect(attachment).toMatchObject(metadata);
          expect(yield* readBytes(attachment.id)).toBe(["image", "0123456789", "notes"][index]);
        }

        const origin = Result.getOrThrow(
          providerHttpOrigin((yield* HttpServer.HttpServer).address),
        );
        for (const attachment of detail.attachments) {
          const asset = yield* issueAssetUrl({
            resource: {
              _tag: "attachment",
              attachmentId: attachment.id,
              fileName: attachment.name,
              mimeType: attachment.mimeType,
            },
          });
          const video = attachment.mimeType === "video/mp4";
          const response = yield* request(
            HttpClientRequest.get(new URL(asset.relativeUrl, origin).href, {
              headers: video ? { Range: "bytes=2-5" } : {},
            }),
          );
          expect(response.status).toBe(video ? 206 : 200);
          expect(response.headers["content-type"]).toBe(attachment.mimeType);
          expect(yield* response.text).toBe(
            video ? "2345" : attachment.type === "image" ? "image" : "notes",
          );
          if (video) expect(response.headers["content-range"]).toBe("bytes 2-5/10");
          else if (attachment.type === "file") {
            expect(response.headers["content-disposition"]).toContain('filename="notes.txt"');
          }
        }

        const appended = [
          yield* upload("image", "next.webp", "image/webp", "next image"),
          yield* upload("file", "next.webm", "video/webm", "next video"),
          yield* upload("file", "next.txt", "text/plain", "next file"),
        ];
        const updated = yield* call("t3_ticket_update", {
          ticket: created.id,
          expectedRevision: 1,
          body: `${detail.body}\n${bodyFor(appended)}`,
          attachments: appended,
        });
        const after = yield* call("t3_ticket_get", { ticket: created.id });
        expect(updated.revision).toBe(2);
        expect(after.body).toBe(
          bodyFor(storedForUploads([...uploads, ...appended], after.attachments)),
        );
        expect(
          after.attachments.filter((attachment) =>
            detail.attachments.some((previous) => previous.id === attachment.id),
          ),
        ).toEqual(detail.attachments);
        for (const [index, attachment] of storedForUploads(appended, after.attachments).entries()) {
          expect(yield* readBytes(attachment.id)).toBe(
            ["next image", "next video", "next file"][index],
          );
        }
        expect(after.attachments.map((attachment) => attachment.name).sort()).toEqual(
          [...uploads, ...appended].map((attachment) => attachment.name).sort(),
        );
        const late = yield* upload("file", "late.txt", "text/plain", "late file");
        yield* call("t3_ticket_update", {
          ticket: created.id,
          expectedRevision: 2,
          title: "Renamed",
        });
        yield* call("t3_ticket_update", {
          ticket: created.id,
          expectedRevision: 1,
          attachments: [late],
        });
        const attachmentOnly = yield* call("t3_ticket_get", { ticket: created.id });
        expect([
          attachmentOnly.body,
          attachmentOnly.summary.revision,
          attachmentOnly.summary.attachmentCount,
        ]).toEqual([after.body, 3, 7]);
        const attachmentToolkit = yield* AttachmentToolkit;
        yield* attachmentToolkit
          .handle("t3_attachment_discard", { attachmentId: uploads[0]!.id })
          .pipe(Stream.unwrap, Stream.runDrain);
        expect(yield* readBytes(stored[0]!.id)).toBe("image");
        const config = yield* ServerConfig.ServerConfig;
        expect(
          resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: uploads[0]!.id,
          }),
        ).toBeNull();
        yield* call("t3_ticket_update", {
          ticket: created.id,
          expectedRevision: 1,
          removeAttachmentIds: [stored[0]!.id],
        });
        const removed = yield* call("t3_ticket_get", { ticket: created.id });
        expect([removed.summary.attachmentCount, removed.summary.revision, removed.body]).toEqual([
          6,
          3,
          after.body,
        ]);
        expect(removed.attachments.some((attachment) => attachment.id === stored[0]!.id)).toBe(
          false,
        );
        expect(
          resolveAttachmentPathById({
            attachmentsDir: config.attachmentsDir,
            attachmentId: stored[0]!.id,
          }),
        ).toBeNull();
        expect((yield* ownedFiles()).length).toBe(6);
      }).pipe(Effect.provide(testLayer)),
  );

  it.live("rolls back missing uploads, partial claim batches and stale body edits", () =>
    Effect.gen(function* () {
      const existing = yield* upload("file", "existing.txt", "text/plain", "existing");
      const created = yield* call("t3_ticket_create", {
        title: "Keep",
        body: "Keep body",
        attachments: [existing],
        linkCaller: false,
      });
      const baseline = yield* ownedFiles();
      const missing = yield* prepare({
        type: "file",
        name: "missing.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
      });
      const missingFailure = yield* call("t3_ticket_update", {
        ticket: created.id,
        expectedRevision: 1,
        attachments: [
          {
            type: "file",
            id: missing.attachmentId,
            name: "missing.txt",
            mimeType: "text/plain",
            sizeBytes: 4,
          },
        ],
      }).pipe(Effect.flip);
      expect(missingFailure._tag).toBe("TicketError");
      const first = yield* upload("file", "first.txt", "text/plain", "first");
      const second = yield* upload("file", "second.txt", "text/plain", "second");
      const mismatch = yield* call("t3_ticket_update", {
        ticket: created.id,
        expectedRevision: 1,
        attachments: [first, { ...second, sizeBytes: second.sizeBytes + 1 }],
      }).pipe(Effect.flip);
      expect(mismatch._tag).toBe("TicketError");
      expect(yield* ownedFiles()).toEqual(baseline);
      yield* call("t3_ticket_update", {
        ticket: created.id,
        expectedRevision: 1,
        body: "Current body",
      });
      const stale = yield* call("t3_ticket_update", {
        ticket: created.id,
        expectedRevision: 1,
        body: "Lost body",
        attachments: [first],
      }).pipe(Effect.flip);
      expect(stale._tag).toBe("TicketRevisionConflictError");
      expect(yield* ownedFiles()).toEqual(baseline);
      const detail = yield* call("t3_ticket_get", { ticket: created.id });
      expect([detail.body, detail.summary.attachmentCount, detail.summary.revision]).toEqual([
        "Current body",
        1,
        2,
      ]);
      expect(yield* readBytes(first.id)).toBe("first");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("keeps the plan upload workflow and ticket ownership", () =>
    Effect.gen(function* () {
      const created = yield* call("t3_ticket_create", { title: "Plan", linkCaller: false });
      const image = yield* upload("image", "plan.png", "image/png", "plan image");
      yield* call("t3_ticket_plan_create", {
        ticket: created.id,
        title: "Steps",
        body: bodyFor([image]),
        attachments: [image],
      });
      const before = yield* call("t3_ticket_plan_get", { plan: "T-1/P1" });
      const file = yield* upload("file", "plan.txt", "text/plain", "plan file");
      yield* call("t3_ticket_plan_update", {
        plan: "T-1/P1",
        expectedRevision: 1,
        edits: [{ find: before.body, replace: `${before.body}\n${bodyFor([file])}` }],
        attachments: [file],
      });
      const after = yield* call("t3_ticket_plan_get", { plan: "T-1/P1" });
      const ticket = yield* call("t3_ticket_get", { ticket: created.id });
      expect(after.body).toBe(bodyFor(storedForUploads([image, file], ticket.attachments)));
      expect(after.plan.revision).toBe(2);
      expect(ticket.attachments.map((attachment) => attachment.name).sort()).toEqual([
        "plan.png",
        "plan.txt",
      ]);
      expect(yield* readBytes(storedForUploads([file], ticket.attachments)[0]!.id)).toBe(
        "plan file",
      );
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("allows local GitHub attachments and rolls back forbidden issue body edits", () =>
    Effect.gen(function* () {
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
      yield* sql`INSERT INTO tickets (ticket_id, number, kind, title, body, labels_json, status_id, sort_key, revision, created_by_json, created_at, updated_at, github_host, github_repository, github_number, github_snapshot_json) VALUES ('github-ticket', 100, 'github', 'Issue', 'Issue body', '[]', 'todo', 'a0', 1, '{"type":"sync"}', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'github.com', 'acme/app', 7, ${snapshot})`;
      const file = yield* upload("file", "issue.txt", "text/plain", "issue file");
      yield* call("t3_ticket_update", {
        ticket: "T-100",
        expectedRevision: 1,
        attachments: [file],
      });
      const baseline = yield* ownedFiles();
      const forbidden = yield* upload("image", "issue.png", "image/png", "issue image");
      const error = yield* call("t3_ticket_update", {
        ticket: "T-100",
        expectedRevision: 1,
        body: bodyFor([forbidden]),
        attachments: [forbidden],
      }).pipe(Effect.flip);
      expect(error._tag).toBe("TicketError");
      expect(yield* ownedFiles()).toEqual(baseline);
      const detail = yield* call("t3_ticket_get", { ticket: "T-100" });
      expect([detail.body, detail.summary.attachmentCount, detail.summary.revision]).toEqual([
        "Issue body",
        1,
        1,
      ]);
      yield* call("t3_ticket_update", {
        ticket: "T-100",
        expectedRevision: 1,
        removeAttachmentIds: [detail.attachments[0]!.id],
      });
      expect(yield* ownedFiles()).toEqual([]);
    }).pipe(Effect.provide(testLayer)),
  );
});
