import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { McpSchema } from "effect/ai";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as DesktopBrowserChannel from "../../../preview/DesktopBrowserChannel.ts";
import * as PreviewManager from "../../../preview/Manager.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as ServerPreviewWallet from "../../../web3/ServerPreviewWallet.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";
import { hostAssignmentKey } from "../../PreviewAutomationBroker.ts";
import { PreviewWalletToolkitHandlersLive } from "./handlers.ts";
import { PreviewWalletToolkit } from "./tools.ts";

const invocation = {
  environmentId: EnvironmentId.make("environment-web3-test"),
  requestNamespace: "provider-session-web3-test",
  thread: {
    threadId: ThreadId.make("thread-web3-test"),
    providerSessionId: "provider-session-web3-test",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  capabilities: new Set(["preview"] as const),
  issuedAt: 1,
};
const ORIGIN = "http://localhost:5173";

/** A local node on chain 31337. */
const anvil = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() =>
      HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x7a69" })),
      ),
    ),
  ),
);

/** The real wallet of a server no desktop started, over a temporary state directory. */
const makeLayer = (input: {
  readonly walletEnabled: boolean;
  readonly capabilities?: ReadonlySet<McpInvocationContext.McpCapability>;
}) =>
  McpToolAccess.HandlersLayer.layer(PreviewWalletToolkitHandlersLive).pipe(
    Layer.provideMerge(McpToolAccessTestkit.liveThreadsLayer),
    Layer.provideMerge(
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        ...invocation,
        capabilities: input.capabilities ?? invocation.capabilities,
      }),
    ),
    Layer.provideMerge(ServerPreviewWallet.layer),
    Layer.provideMerge(
      Layer.mergeAll(
        ServerSecretStore.layer,
        ServerSettings.layerTest({
          web3Wallet: { enabled: input.walletEnabled, approvalMode: "always-ask" },
        }),
        DesktopBrowserChannel.layer,
        PreviewManager.layer,
        anvil,
      ),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-web3-handlers-" })),
    Layer.provideMerge(NodeServices.layer),
  );

const callTool = Effect.fn("Web3Handlers.test.callTool")(function* (
  name:
    | "preview_wallet_status"
    | "preview_wallet_configure"
    | "preview_wallet_requests"
    | "preview_wallet_approve"
    | "preview_wallet_reject",
  payload: Record<string, unknown>,
) {
  const built = yield* PreviewWalletToolkit;
  return yield* built.handle(name, payload).pipe(
    Stream.unwrap,
    Stream.run(Sink.last()),
    Effect.map((last) => Option.getOrThrow(last).result),
    Effect.result,
  );
});

/** What the MCP server answers a tool call with; constructing it validates `structuredContent`. */
const callToolResult = Effect.fn("Web3Handlers.test.callToolResult")(function* (
  name: "preview_wallet_status" | "preview_wallet_requests",
  payload: Record<string, unknown>,
) {
  const built = yield* PreviewWalletToolkit;
  const last = Option.getOrThrow(
    yield* built.handle(name, payload).pipe(Stream.unwrap, Stream.run(Sink.last())),
  );
  return new McpSchema.CallToolResult({
    isError: last.isFailure,
    structuredContent: last.isFailure ? undefined : last.encodedResult,
    content: [],
  });
});

/** Opens a server tab owned by `owner` and parks a request from its page, a signature by default. */
const parkRequest = (
  owner: string,
  call: { readonly method: string; readonly params: unknown } = {
    method: "personal_sign",
    params: ["0x68656c6c6f"],
  },
) =>
  Effect.gen(function* () {
    const manager = yield* PreviewManager.PreviewManager;
    const wallet = yield* ServerPreviewWallet.ServerPreviewWallet;
    yield* wallet.ready;
    const tab = yield* manager.open({
      threadId: invocation.thread.threadId,
      runtime: "server",
      automationOwner: owner,
    });
    const key = { threadId: invocation.thread.threadId, tabId: tab.tabId };
    const page = yield* wallet
      .request(key, { documentId: "document-1", origin: ORIGIN, ...call })
      .pipe(Effect.forkScoped);
    const status = yield* wallet.changes.pipe(
      Stream.filter((current) => current.pendingRequests.some((r) => r.tabId === tab.tabId)),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    );
    const request = status.pendingRequests.find((pending) => pending.tabId === tab.tabId)!;
    return { tabId: tab.tabId, requestId: request.requestId, page };
  });

it.effect("tells an agent where the switch is while the wallet is off, for every tool", () =>
  Effect.gen(function* () {
    for (const [name, payload] of [
      ["preview_wallet_status", {}],
      ["preview_wallet_approve", { requestId: "req-1" }],
    ] as const) {
      const result = yield* callTool(name, payload);
      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("PreviewWalletDisabledError");
        expect(String(result.failure)).toContain("Settings > Web3");
      }
    }
  }).pipe(Effect.scoped, Effect.provide(makeLayer({ walletEnabled: false }))),
);

it.effect("refuses a session without the preview capability", () =>
  Effect.gen(function* () {
    const result = yield* callTool("preview_wallet_status", {});
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("PreviewAutomationUnavailableError");
    }
  }).pipe(
    Effect.scoped,
    Effect.provide(makeLayer({ walletEnabled: true, capabilities: new Set() })),
  ),
);

it.effect("shows and resolves only the requests of the agent's own tabs", () =>
  Effect.gen(function* () {
    const mine = yield* parkRequest(hostAssignmentKey(invocation));
    const theirs = yield* parkRequest("another-provider-session");

    const listed = yield* callTool("preview_wallet_requests", {});
    expect(listed._tag).toBe("Success");
    if (listed._tag === "Success") {
      expect(listed.success).toMatchObject({
        requests: [
          {
            requestId: mine.requestId,
            tabId: mine.tabId,
            threadId: invocation.thread.threadId,
            method: "personal_sign",
            origin: ORIGIN,
          },
        ],
      });
    }
    const narrowed = yield* callTool("preview_wallet_status", { tabId: theirs.tabId });
    if (narrowed._tag === "Success") {
      expect(narrowed.success).toMatchObject({ enabled: true, pendingRequests: [] });
    }

    for (const [requestId, tabId] of [
      [theirs.requestId, undefined],
      [mine.requestId, theirs.tabId],
    ] as const) {
      const refused = yield* callTool("preview_wallet_approve", {
        requestId,
        ...(tabId === undefined ? {} : { tabId }),
      });
      expect(refused._tag).toBe("Failure");
      if (refused._tag === "Failure") {
        expect(refused.failure).toMatchObject({ _tag: "PreviewWalletRequestNotFoundError" });
      }
    }

    const approved = yield* callTool("preview_wallet_approve", { requestId: mine.requestId });
    expect(approved._tag).toBe("Success");
    const reply = yield* Fiber.join(mine.page);
    expect(reply.ok).toBe(true);
    if (approved._tag === "Success" && reply.ok) {
      expect(approved.success).toEqual({
        requestId: mine.requestId,
        method: "personal_sign",
        outcome: "approved",
        result: reply.result,
        failure: null,
      });
    }

    // The other session's request is still waiting for its own agent or a person.
    const wallet = yield* ServerPreviewWallet.ServerPreviewWallet;
    yield* wallet.reject(theirs.requestId);
    expect(yield* Fiber.join(theirs.page)).toMatchObject({ ok: false, code: 4001 });
  }).pipe(Effect.scoped, Effect.provide(makeLayer({ walletEnabled: true }))),
);

it.effect("configures the wallet and answers with the agent's view of it", () =>
  Effect.gen(function* () {
    const result = yield* callTool("preview_wallet_configure", {
      approvalMode: "always-auto",
      generateAccount: true,
    });
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success).toMatchObject({
        enabled: true,
        approvalMode: "always-auto",
        pendingRequests: [],
      });
      const status = result.success as { accounts: ReadonlyArray<unknown> };
      expect(status.accounts).toHaveLength(4);
    }
  }).pipe(Effect.scoped, Effect.provide(makeLayer({ walletEnabled: true }))),
);

it.effect("lists a page's call that came without params", () =>
  Effect.gen(function* () {
    // A headless page's binding hands over the page's params as they are, often none.
    const parked = yield* parkRequest(hostAssignmentKey(invocation), {
      method: "eth_requestAccounts",
      params: undefined,
    });

    for (const name of ["preview_wallet_requests", "preview_wallet_status"] as const) {
      const result = yield* callToolResult(name, {});
      expect(result.isError).toBe(false);
      expect(JSON.stringify(result.structuredContent)).toContain(parked.requestId);
    }
    const listed = yield* callTool("preview_wallet_requests", {});
    if (listed._tag === "Success") {
      expect(listed.success).toMatchObject({
        requests: [{ requestId: parked.requestId, method: "eth_requestAccounts", params: [] }],
      });
    }

    const wallet = yield* ServerPreviewWallet.ServerPreviewWallet;
    yield* wallet.reject(parked.requestId);
    expect(yield* Fiber.join(parked.page)).toMatchObject({ ok: false, code: 4001 });
  }).pipe(Effect.scoped, Effect.provide(makeLayer({ walletEnabled: true }))),
);
