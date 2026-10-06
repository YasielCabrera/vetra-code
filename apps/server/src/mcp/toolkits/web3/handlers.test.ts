import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";

import * as ServerSettings from "../../../serverSettings.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as PreviewAutomationBroker from "../../PreviewAutomationBroker.ts";
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

/**
 * No desktop host is connected, so a call that clears the wallet gate reaches
 * the broker and fails there. That is exactly the distinction under test: a
 * disabled wallet must fail *before* the broker, with its own error.
 */
const makeLayer = (walletEnabled: boolean) =>
  PreviewWalletToolkitHandlersLive.pipe(
    Layer.provideMerge(PreviewAutomationBroker.layer.pipe(Layer.provide(NodeServices.layer))),
    Layer.provideMerge(ServerSettings.layerTest({ web3Wallet: { enabled: walletEnabled } })),
    Layer.provideMerge(Layer.succeed(McpInvocationContext.McpInvocationContext, invocation)),
  );

const callTool = Effect.fn("Web3Handlers.test.callTool")(function* (
  name: "preview_wallet_status" | "preview_wallet_approve",
  payload: Record<string, unknown>,
) {
  const built = yield* PreviewWalletToolkit;
  return yield* built
    .handle(name, payload)
    .pipe(Stream.unwrap, Stream.run(Sink.last()), Effect.result);
});

it.effect("fails with PreviewWalletDisabledError when the wallet is switched off", () =>
  Effect.gen(function* () {
    const result = yield* callTool("preview_wallet_status", {});

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("PreviewWalletDisabledError");
      // The message has to tell an agent where the switch is.
      expect(String(result.failure)).toContain("Settings > Web3");
    }
  }).pipe(Effect.provide(makeLayer(false))),
);

it.effect("gates every wallet tool, not just the read-only one", () =>
  Effect.gen(function* () {
    const result = yield* callTool("preview_wallet_approve", { requestId: "req-1" });

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("PreviewWalletDisabledError");
    }
  }).pipe(Effect.provide(makeLayer(false))),
);

it.effect("reaches the broker once the wallet is enabled", () =>
  Effect.gen(function* () {
    const result = yield* callTool("preview_wallet_status", {});

    // Still a failure — no desktop host is connected — but a routing failure,
    // which proves the gate let the call through.
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).not.toBe("PreviewWalletDisabledError");
      expect(result.failure._tag).toBe("PreviewAutomationNoAvailableHostError");
    }
  }).pipe(Effect.provide(makeLayer(true))),
);
