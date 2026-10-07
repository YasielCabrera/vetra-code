import { ClaudeSettings, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";

import { makeClaudeSubscriptionUsageCapability } from "./ClaudeSubscriptionUsage.ts";

const decodeClaudeSettings = Schema.decodeEffect(ClaudeSettings);

const probe = vi.hoisted(() => {
  let usageOptions: unknown;
  return {
    readOptions: () => usageOptions,
    usage: async (options?: unknown) => {
      usageOptions = options;
      return {
        subscription_type: "max",
        rate_limits_available: true,
        rate_limits: { five_hour: { utilization: 40, resets_at: null } },
        behaviors: null,
      };
    },
  };
});
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: () => ({
    initializationResult: async () => ({ account: { email: "dev@example.com" } }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: probe.usage,
  }),
}));

it.effect("reads Claude plan limits without the local transcript scan", () =>
  Effect.gen(function* () {
    const capability = makeClaudeSubscriptionUsageCapability({
      instance: {
        instanceId: ProviderInstanceId.make("claudeAgent_work"),
        driverKind: ProviderDriverKind.make("claudeAgent"),
        displayName: "Claude",
      },
      settings: yield* decodeClaudeSettings({ binaryPath: "claude" }),
      environment: {},
      cwd: "/tmp",
      path: yield* Path.Path,
    });
    const { result } = yield* capability.read;

    assert.deepEqual(probe.readOptions(), { skipBehaviors: true });
    assert.equal(result.state, "ready");
    assert.equal(result.accountLabel, "dev@example.com");
    assert.deepEqual(
      result.windows.map((window) => [window.label, window.usedPercent]),
      [["Session", 40]],
    );
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
