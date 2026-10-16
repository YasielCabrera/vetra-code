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
  let queryOptions: unknown;
  return {
    readOptions: () => usageOptions,
    readQueryOptions: () => queryOptions,
    captureQueryOptions: (options: unknown) => {
      queryOptions = options;
    },
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
  query: (input: { options: unknown }) => {
    probe.captureQueryOptions(input.options);
    return {
      initializationResult: async () => ({ account: { email: "dev@example.com" } }),
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: probe.usage,
    };
  },
}));

it.effect.each([false, true])(
  "reads Claude plan limits with managed MCP config %s",
  (managedMcpConfig) =>
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
        managedMcpConfig,
        path: yield* Path.Path,
      });
      const { result } = yield* capability.read;

      assert.deepEqual(probe.readOptions(), { skipBehaviors: true });
      if (managedMcpConfig) {
        assert.notProperty(probe.readQueryOptions(), "strictMcpConfig");
      } else {
        assert.propertyVal(probe.readQueryOptions(), "strictMcpConfig", true);
      }
      assert.equal(result.state, "ready");
      assert.equal(result.accountLabel, "dev@example.com");
      assert.deepEqual(
        result.windows.map((window) => [window.label, window.usedPercent]),
        [["Session", 40]],
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
