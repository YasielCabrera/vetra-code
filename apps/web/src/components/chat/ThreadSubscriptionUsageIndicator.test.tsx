import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSubscriptionUsageInstanceResult,
  type ProviderSubscriptionUsageReport,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentProviderSubscriptionUsageStatus } from "../../state/providerSubscriptionUsage";

const mocks = vi.hoisted(() => ({
  useProviderSubscriptionUsage: vi.fn(),
}));

vi.mock("../../state/providerSubscriptionUsage", () => ({
  useProviderSubscriptionUsage: mocks.useProviderSubscriptionUsage,
}));

vi.mock("../ui/popover", () => ({
  Popover: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ render }: { readonly render: ReactNode }) => render,
  PopoverPopup: ({ children }: { readonly children: ReactNode }) => (
    <div data-subscription-popup>{children}</div>
  ),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    hash,
    children,
    className,
  }: {
    readonly to: string;
    readonly hash?: string;
    readonly children: ReactNode;
    readonly className?: string;
  }) => (
    <a href={`${to}${hash ? `#${hash}` : ""}`} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("../usage/ProviderInstanceIcon", () => ({
  ProviderInstanceIcon: ({ displayName }: { readonly displayName: string }) => (
    <span data-provider-icon>{displayName}</span>
  ),
}));

import {
  resolveThreadSubscriptionUsage,
  ThreadSubscriptionUsageIndicator,
  threadSubscriptionUsageRingColor,
} from "./ThreadSubscriptionUsageIndicator";

const localEnvironmentId = EnvironmentId.make("environment-local");
const remoteEnvironmentId = EnvironmentId.make("environment-remote");
const codexInstanceId = ProviderInstanceId.make("codex_work");
const codexDriver = ProviderDriverKind.make("codex");

const readyInstance = (input: {
  readonly usedPercents: readonly number[];
  readonly freshness?: "fresh" | "stale";
  readonly instanceId?: string;
}): Extract<ProviderSubscriptionUsageInstanceResult, { readonly state: "ready" }> => ({
  instanceId: ProviderInstanceId.make(input.instanceId ?? codexInstanceId),
  driver: codexDriver,
  displayName: "Codex Work",
  state: "ready",
  freshness: input.freshness ?? "fresh",
  fetchedAt: "2026-08-14T11:58:00.000Z",
  source: "provider-cli",
  accountLabel: "work@example.com",
  planLabel: "pro",
  windows: input.usedPercents.map((usedPercent, index) => ({
    id: `window-${index}`,
    label: index === 0 ? "Session" : `Window ${index + 1}`,
    usedPercent,
    resetsAt: "2026-08-20T12:00:00.000Z",
  })),
  details: [{ id: "codex:credits", label: "Codex · Credits", value: "12" }],
});

const report = (
  instances: readonly ProviderSubscriptionUsageInstanceResult[],
): ProviderSubscriptionUsageReport => ({
  contractVersion: 1,
  readAt: "2026-08-14T12:00:00.000Z",
  instances,
});

const environment = (input: {
  readonly environmentId?: EnvironmentId;
  readonly report?: ProviderSubscriptionUsageReport | null;
  readonly error?: EnvironmentProviderSubscriptionUsageStatus["error"];
  readonly isPending?: boolean;
  readonly connectionPhase?: EnvironmentProviderSubscriptionUsageStatus["connectionPhase"];
}): EnvironmentProviderSubscriptionUsageStatus => ({
  environmentId: input.environmentId ?? localEnvironmentId,
  label: input.environmentId === remoteEnvironmentId ? "Remote" : "Local",
  connectionPhase: input.connectionPhase ?? "connected",
  providerInstancesKey: "[]",
  isPending: input.isPending ?? false,
  error: input.error ?? null,
  report: input.report ?? null,
});

describe("resolveThreadSubscriptionUsage", () => {
  it("matches the exact environment and provider instance without merging accounts", () => {
    const local = readyInstance({ usedPercents: [20] });
    const remote = readyInstance({ usedPercents: [92] });
    const resolved = resolveThreadSubscriptionUsage(
      [
        environment({ report: report([local]) }),
        environment({ environmentId: remoteEnvironmentId, report: report([remote]) }),
      ],
      remoteEnvironmentId,
      codexInstanceId,
    );

    expect(resolved.kind).toBe("instance");
    if (resolved.kind !== "instance") return;
    expect(resolved.instance).toBe(remote);
    expect(resolved.primaryWindow?.usedPercent).toBe(92);
  });

  it("selects the first reported window instead of the most-used window", () => {
    const instance = readyInstance({ usedPercents: [40, 127.5, 127.5] });
    const resolved = resolveThreadSubscriptionUsage(
      [environment({ report: report([instance]) })],
      localEnvironmentId,
      codexInstanceId,
    );

    expect(resolved.kind).toBe("instance");
    if (resolved.kind !== "instance") return;
    expect(resolved.primaryWindow).toBe(instance.windows[0]);
  });

  it.each([
    ["offline", environment({ error: "offline", connectionPhase: "offline" })],
    ["not-supported", environment({ error: "not-supported" })],
    ["not-supported", environment({ error: "contract-version" })],
    ["error", environment({ error: "error" })],
    ["loading", environment({ isPending: true })],
    ["empty", environment({})],
    ["missing-instance", environment({ report: report([]) })],
  ] as const)("resolves the %s neutral state", (expected, status) => {
    expect(resolveThreadSubscriptionUsage([status], localEnvironmentId, codexInstanceId)).toEqual({
      kind: "status",
      status: expected,
    });
  });

  it("keeps non-ready provider results available to the shared status card", () => {
    const instance: ProviderSubscriptionUsageInstanceResult = {
      instanceId: codexInstanceId,
      driver: codexDriver,
      displayName: "Codex Work",
      state: "needs-auth",
      message: "Sign in to Codex.",
      windows: [],
      details: [],
    };
    const resolved = resolveThreadSubscriptionUsage(
      [environment({ report: report([instance]) })],
      localEnvironmentId,
      codexInstanceId,
    );

    expect(resolved).toEqual({ kind: "instance", instance, primaryWindow: null });
  });
});

describe("thread subscription usage presentation", () => {
  beforeEach(() => {
    mocks.useProviderSubscriptionUsage.mockReset();
  });

  it("uses provider, warning, stale, and exhausted ring colors", () => {
    const healthy = readyInstance({ usedPercents: [40] });
    const low = readyInstance({ usedPercents: [95] });
    const stale = readyInstance({ usedPercents: [20], freshness: "stale" });
    const exhausted = readyInstance({ usedPercents: [100] });

    expect(threadSubscriptionUsageRingColor(healthy, healthy.windows[0]!)).toBe("#49a3b0");
    expect(threadSubscriptionUsageRingColor(low, low.windows[0]!)).toBe("var(--color-warning)");
    expect(threadSubscriptionUsageRingColor(stale, stale.windows[0]!)).toBe("var(--color-warning)");
    expect(threadSubscriptionUsageRingColor(exhausted, exhausted.windows[0]!)).toBe(
      "var(--color-error)",
    );
  });

  it("renders the existing rich card for a ready selected instance", () => {
    const instance = readyInstance({ usedPercents: [25, 95] });
    mocks.useProviderSubscriptionUsage.mockReturnValue({
      environments: [environment({ report: report([instance]) })],
      refresh: vi.fn(),
    });

    const html = renderToStaticMarkup(
      <ThreadSubscriptionUsageIndicator
        environmentId={localEnvironmentId}
        providerInstanceId={codexInstanceId}
        providerDisplayName="Codex Work"
      />,
    );

    expect(html).toContain('data-usage-meter-value="75"');
    expect(html).toContain('stroke="#49a3b0"');
    expect(html).toContain("Codex Work subscription usage: Session 75% left, 25% used");
    expect(html).toContain("Pro 20x");
    expect(html).toContain("Session");
    expect(html).toContain("Window 2");
    expect(html).toContain("5% left");
    expect(html).toContain("Credits and resets reported by the Codex account.");
    expect(html).not.toContain("work@example.com");
    expect(html).toContain('aria-label="Toggle subscription account visibility"');
  });

  it("reuses non-ready instance actions and redaction", () => {
    const instance: ProviderSubscriptionUsageInstanceResult = {
      instanceId: codexInstanceId,
      driver: codexDriver,
      displayName: "Codex Work",
      state: "needs-auth",
      accountLabel: "work@example.com",
      message: "Sign in to Codex.",
      windows: [],
      details: [],
    };
    mocks.useProviderSubscriptionUsage.mockReturnValue({
      environments: [environment({ report: report([instance]) })],
      refresh: vi.fn(),
    });

    const html = renderToStaticMarkup(
      <ThreadSubscriptionUsageIndicator
        environmentId={localEnvironmentId}
        providerInstanceId={codexInstanceId}
      />,
    );

    expect(html).toContain('data-usage-meter-state="neutral"');
    expect(html).toContain("Sign in to Codex.");
    expect(html).toContain("Open Codex Work settings");
    expect(html).toContain("/settings/providers#provider-instance/environment-local/codex_work");
    expect(html).not.toContain("work@example.com");
  });

  it.each([
    [
      "offline",
      environment({ error: "offline", connectionPhase: "offline" }),
      "Its provider limits are not merged with another device.",
    ],
    [
      "unsupported environment",
      environment({ error: "not-supported" }),
      "Subscription limits are not supported by this environment.",
    ],
    [
      "read failure",
      environment({ error: "error" }),
      "Subscription limits could not be loaded from this environment.",
    ],
    [
      "loading",
      environment({ isPending: true }),
      "Loading subscription limits for the selected provider.",
    ],
    [
      "empty report",
      environment({}),
      "No enabled provider instances reported subscription limits.",
    ],
    [
      "missing instance",
      environment({ report: report([]) }),
      "The selected provider has not reported subscription limits yet.",
    ],
  ] as const)("shows the shared %s message behind a neutral ring", (_name, status, copy) => {
    mocks.useProviderSubscriptionUsage.mockReturnValue({
      environments: [status],
      refresh: vi.fn(),
    });

    const html = renderToStaticMarkup(
      <ThreadSubscriptionUsageIndicator
        environmentId={localEnvironmentId}
        providerInstanceId={codexInstanceId}
        providerDisplayName="Codex Work"
      />,
    );

    expect(html).toContain('data-usage-meter-state="neutral"');
    expect(html).toContain(copy);
  });

  it.each(["unsupported", "error"] as const)(
    "keeps a %s instance result behind a neutral ring",
    (state) => {
      const instance: ProviderSubscriptionUsageInstanceResult = {
        instanceId: codexInstanceId,
        driver: codexDriver,
        displayName: "Codex Work",
        state,
        message: `${state} message`,
        windows: [],
        details: [],
      };
      mocks.useProviderSubscriptionUsage.mockReturnValue({
        environments: [environment({ report: report([instance]) })],
        refresh: vi.fn(),
      });

      const html = renderToStaticMarkup(
        <ThreadSubscriptionUsageIndicator
          environmentId={localEnvironmentId}
          providerInstanceId={codexInstanceId}
        />,
      );

      expect(html).toContain('data-usage-meter-state="neutral"');
      expect(html).toContain(`${state} message`);
    },
  );

  it("uses a neutral ring for a ready instance without a percentage window", () => {
    const instance = readyInstance({ usedPercents: [] });
    mocks.useProviderSubscriptionUsage.mockReturnValue({
      environments: [environment({ report: report([instance]) })],
      refresh: vi.fn(),
    });

    const html = renderToStaticMarkup(
      <ThreadSubscriptionUsageIndicator
        environmentId={localEnvironmentId}
        providerInstanceId={codexInstanceId}
      />,
    );

    expect(html).toContain('data-usage-meter-state="neutral"');
    expect(html).toContain("subscription usage has no percentage window");
    expect(html).toContain("Credits and resets reported by the Codex account.");
  });
});
