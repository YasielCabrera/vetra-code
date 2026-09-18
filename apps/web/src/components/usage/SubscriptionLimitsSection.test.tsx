import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSubscriptionUsageInstanceResult,
  type ProviderSubscriptionUsageReport,
  type ProviderSubscriptionUsageWindow,
} from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import type { EnvironmentProviderSubscriptionUsageStatus } from "../../state/providerSubscriptionUsage";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    hash,
    children,
    className,
  }: {
    readonly to: string;
    readonly hash: string;
    readonly children: ReactNode;
    readonly className?: string;
  }) => (
    <a href={`${to}#${hash}`} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("../chat/ProviderInstanceIcon", () => ({
  ProviderInstanceIcon: ({ displayName }: { readonly displayName: string }) => (
    <span data-provider-icon>{displayName}</span>
  ),
}));

import { EnvironmentSubscriptionLimits, SubscriptionLimitCard } from "./SubscriptionLimitsSection";
import {
  ProviderSubscriptionLimitCard,
  ProviderSubscriptionWindow,
  type ReadySubscriptionUsage,
} from "./ProviderSubscriptionLimitCard";

const environmentId = (value: string) => EnvironmentId.make(value);
const instanceId = (value: string) => ProviderInstanceId.make(value);

const readyInstance = (input: {
  readonly id: string;
  readonly displayName: string;
  readonly usedPercent: number;
  readonly freshness?: "fresh" | "stale";
  readonly accountLabel?: string;
}): ProviderSubscriptionUsageInstanceResult => ({
  instanceId: instanceId(input.id),
  driver: ProviderDriverKind.make("codex"),
  displayName: input.displayName,
  state: "ready",
  freshness: input.freshness ?? "fresh",
  fetchedAt: "2026-08-13T12:00:00.000Z",
  source: "provider-cli",
  ...(input.accountLabel ? { accountLabel: input.accountLabel } : {}),
  planLabel: "Plus",
  windows: [
    {
      id: "weekly",
      label: "Weekly",
      usedPercent: input.usedPercent,
      resetsAt: "2026-08-20T12:00:00.000Z",
    },
  ],
  details: [{ id: "credits", label: "Credits", value: "$12.50" }],
});

const usageReport = (
  instances: ReadonlyArray<ProviderSubscriptionUsageInstanceResult>,
): ProviderSubscriptionUsageReport => ({
  contractVersion: 1,
  readAt: "2026-08-13T12:00:00.000Z",
  instances,
});

const environment = (input: {
  readonly id: string;
  readonly label: string;
  readonly report?: ProviderSubscriptionUsageReport | null;
  readonly error?: EnvironmentProviderSubscriptionUsageStatus["error"];
  readonly isPending?: boolean;
  readonly connectionPhase?: EnvironmentProviderSubscriptionUsageStatus["connectionPhase"];
}): EnvironmentProviderSubscriptionUsageStatus => ({
  environmentId: environmentId(input.id),
  label: input.label,
  connectionPhase: input.connectionPhase ?? "connected",
  providerInstancesKey: "[]",
  isPending: input.isPending ?? false,
  error: input.error ?? null,
  report: input.report ?? null,
});

describe("subscription limit presentation", () => {
  it("renders Cursor with CodexBar-style pace, cost history, and credits", () => {
    const now = new Date("2026-08-14T09:00:00.000Z");
    const instance = {
      instanceId: instanceId("cursor_work"),
      driver: ProviderDriverKind.make("cursor"),
      displayName: "Cursor",
      state: "ready",
      freshness: "fresh",
      fetchedAt: "2026-08-14T08:58:00.000Z",
      source: "provider-app",
      accountLabel: "yasiel9506@gmail.com",
      planLabel: "pro",
      windows: [
        {
          id: "monthly-included",
          label: "Total",
          usedPercent: 33,
          durationMinutes: 43_200,
          resetsAt: "2026-08-14T21:22:00.000Z",
        },
        {
          id: "auto-composer",
          label: "Auto",
          usedPercent: 38,
          durationMinutes: 43_200,
          resetsAt: "2026-08-14T21:22:00.000Z",
        },
        {
          id: "api-models",
          label: "API",
          usedPercent: 0,
          durationMinutes: 43_200,
          resetsAt: "2026-08-14T21:22:00.000Z",
        },
      ],
      details: [
        { id: "included", label: "Included usage", value: "$20.00 / $20.00" },
        { id: "personal-on-demand", label: "Personal on-demand", value: "$0.00 used" },
      ],
      cost: {
        currencyCode: "USD",
        periodDays: 30,
        meteredCost: 113.95,
        todayCost: 0,
        periodCost: 205,
        latestTokens: 7_600_000,
        periodTokens: 158_000_000,
        topModel: "cursor-grok-4.6-xhigh-fast",
        daily: [
          { date: "2026-08-01", cost: 2, tokens: 1_000_000 },
          { date: "2026-08-13", cost: 147, tokens: 7_600_000 },
        ],
      },
    } satisfies Extract<ProviderSubscriptionUsageInstanceResult, { readonly state: "ready" }>;

    const html = renderToStaticMarkup(
      <ProviderSubscriptionLimitCard instance={instance} now={now} />,
    );

    expect(html).toContain("Cursor Pro");
    expect(html).toContain("Updated 2m ago");
    expect(html).toContain("67% left");
    expect(html).toContain("65% in reserve");
    expect(html).toContain("Resets in 12h 22m");
    expect(html).toContain("Lasts until reset");
    expect(html).toContain("Cursor-metered");
    expect(html).toContain("$113.95");
    expect(html).toContain("$205.00");
    expect(html).toContain("7.6M");
    expect(html).toContain("158M");
    expect(html).toContain('aria-label="30-day Cursor cost history"');
    expect(html).toContain("cursor-grok-4.6-xhigh-fast");
    expect(html).toContain("On-demand usage beyond included plan limits.");
    expect(html).not.toContain("$20.00 / $20.00");
  });

  it("renders Claude limits, local usage history, and extra usage as distinct sections", () => {
    const instance = {
      instanceId: instanceId("claude_work"),
      driver: ProviderDriverKind.make("claudeAgent"),
      displayName: "Claude",
      state: "ready",
      freshness: "fresh",
      fetchedAt: "2026-08-14T08:58:00.000Z",
      source: "provider-cli",
      accountLabel: "yasiel@powerhouse.inc",
      planLabel: "team_premium",
      windows: [
        {
          id: "five-hour",
          label: "Session",
          usedPercent: 0,
          durationMinutes: 300,
          resetsAt: "2026-08-14T13:40:00.000Z",
        },
        {
          id: "seven-day",
          label: "Weekly",
          usedPercent: 47,
          durationMinutes: 10_080,
          resetsAt: "2026-08-18T09:00:00.000Z",
        },
        { id: "seven-day-opus", label: "Opus only", usedPercent: 1 },
        { id: "extra-usage", label: "Extra usage", usedPercent: 47 },
      ],
      details: [
        { id: "extra-usage-status", label: "Extra usage", value: "Enabled" },
        { id: "extra-usage-used", label: "Extra usage spent", value: "$93.59" },
        { id: "extra-usage-limit", label: "Extra usage limit", value: "$200.00" },
      ],
      cost: {
        currencyCode: "USD",
        periodDays: 30,
        scope: "local-environment",
        costCoverage: "partial",
        todayCost: 33.38,
        periodCost: 5_699.04,
        latestTokens: 52_000_000,
        periodTokens: 7_200_000_000,
        topModel: "claude-opus-5",
        daily: [
          { date: "2026-08-13", cost: 472, tokens: 25_000_000 },
          { date: "2026-08-14", cost: 33.38, tokens: 52_000_000 },
        ],
      },
    } satisfies ReadySubscriptionUsage;

    const html = renderToStaticMarkup(
      <ProviderSubscriptionLimitCard
        instance={instance}
        now={new Date("2026-08-14T09:00:00.000Z")}
      />,
    );

    expect(html).toContain("Team Premium");
    expect(html).toContain("Session");
    expect(html).toContain("Weekly");
    expect(html).toContain("Opus only");
    expect(html).toContain("30d cost*");
    expect(html).toContain("$5,699.04");
    expect(html).toContain("7.2B");
    expect(html).toContain('aria-label="30-day Claude cost history"');
    expect(html).toContain("Estimated from local Claude logs at API rates");
    expect(html).toContain("Cost excludes usage whose model pricing was unavailable");
    expect(html).toContain('aria-label="Extra usage used"');
    expect(html).toContain("47% used");
    expect(html).toContain("Monthly cap: $93.59 / $200.00");
    expect(html).toContain("background-color:#cc7c5e");
  });

  it("renders Codex plan multipliers, usage history, credits, and spending", () => {
    const instance = {
      instanceId: instanceId("codex_personal"),
      driver: ProviderDriverKind.make("codex"),
      displayName: "Codex",
      state: "ready",
      freshness: "fresh",
      fetchedAt: "2026-08-14T08:58:00.000Z",
      source: "provider-cli",
      accountLabel: "yasiel9506@gmail.com",
      planLabel: "prolite",
      windows: [
        {
          id: "codex:secondary",
          label: "Weekly",
          usedPercent: 17,
          durationMinutes: 10_080,
          resetsAt: "2026-08-19T22:00:00.000Z",
        },
        {
          id: "codex-spark-weekly",
          label: "Codex Spark Weekly",
          usedPercent: 0,
          durationMinutes: 10_080,
          resetsAt: "2026-08-21T08:00:00.000Z",
        },
        { id: "review:primary", label: "Code review", usedPercent: 17 },
      ],
      details: [
        { id: "codex:credits", label: "Codex · Credits", value: "0" },
        { id: "reset-credits", label: "Reset credits", value: "1" },
        { id: "codex:spend-used", label: "Codex · Spend used", value: "$2.00" },
        { id: "codex:spend-limit", label: "Codex · Spend limit", value: "$20.00" },
      ],
      cost: {
        currencyCode: "USD",
        periodDays: 30,
        scope: "local-environment",
        costCoverage: "complete",
        todayCost: 35.97,
        periodCost: 1_894.17,
        latestTokens: 52_000_000,
        periodTokens: 2_300_000_000,
        topModel: "gpt-5.6-sol",
        daily: [{ date: "2026-08-14", cost: 179, tokens: 52_000_000 }],
      },
    } satisfies ReadySubscriptionUsage;

    const html = renderToStaticMarkup(
      <ProviderSubscriptionLimitCard
        instance={instance}
        now={new Date("2026-08-14T09:00:00.000Z")}
      />,
    );

    expect(html).toContain("Pro 5x");
    expect(html).toContain("Codex Spark Weekly");
    expect(html).toContain("Code review");
    expect(html).toContain("$1,894.17");
    expect(html).toContain('aria-label="30-day Codex cost history"');
    expect(html).toContain("Top model:");
    expect(html).toContain("gpt-5.6-sol");
    expect(html).toContain("Credits and resets reported by the Codex account.");
    expect(html).toContain("Account spending controls for Codex usage.");
    expect(html).toContain("background-color:#49a3b0");
  });

  it("gives Grok and OpenCode provider-specific allowance sections", () => {
    const grok = {
      instanceId: instanceId("grok_personal"),
      driver: ProviderDriverKind.make("grok"),
      displayName: "Grok",
      state: "ready",
      freshness: "fresh",
      fetchedAt: "2026-08-14T08:58:00.000Z",
      source: "provider-cli",
      windows: [
        {
          id: "monthly-included",
          label: "Monthly included allowance",
          usedPercent: 42,
        },
      ],
      details: [
        { id: "included-allowance", label: "Included allowance", value: "$42.00 / $100.00" },
        { id: "on-demand", label: "On-demand", value: "$12.00 / $50.00" },
        { id: "on-demand-status", label: "On-demand spending", value: "Enabled" },
      ],
    } satisfies ReadySubscriptionUsage;
    const opencode = {
      instanceId: instanceId("opencode_go"),
      driver: ProviderDriverKind.make("opencode"),
      displayName: "OpenCode",
      state: "ready",
      freshness: "fresh",
      fetchedAt: "2026-08-14T08:58:00.000Z",
      source: "manual-credential",
      planLabel: "OpenCode Go",
      windows: [{ id: "five-hour", label: "5-hour", usedPercent: 20 }],
      details: [{ id: "zen-balance", label: "Zen balance", value: "$12.50" }],
    } satisfies ReadySubscriptionUsage;

    const grokHtml = renderToStaticMarkup(
      <ProviderSubscriptionLimitCard instance={grok} now={new Date("2026-08-14T09:00:00.000Z")} />,
    );
    const openCodeHtml = renderToStaticMarkup(
      <ProviderSubscriptionLimitCard
        instance={opencode}
        now={new Date("2026-08-14T09:00:00.000Z")}
      />,
    );

    expect(grokHtml).toContain("Usage beyond the included monthly allowance.");
    expect(grokHtml).toContain("$12.00 / $50.00");
    expect(grokHtml).toContain("background-color:#10a37f");
    expect(openCodeHtml).toContain("OpenCode Go");
    expect(openCodeHtml).toContain("Prepaid Zen balance available for model usage.");
    expect(openCodeHtml).toContain("$12.50");
    expect(openCodeHtml).toContain("background-color:#3b82f6");
  });

  it("renders same-account instances separately by environment and redacts their labels", () => {
    const html = renderToStaticMarkup(
      <div>
        <EnvironmentSubscriptionLimits
          environment={environment({
            id: "local",
            label: "Laptop",
            report: usageReport([
              readyInstance({
                id: "codex_work",
                displayName: "Codex Work",
                usedPercent: 25,
                accountLabel: "work@example.com",
              }),
            ]),
          })}
        />
        <EnvironmentSubscriptionLimits
          environment={environment({
            id: "remote",
            label: "Desktop",
            report: usageReport([
              readyInstance({
                id: "codex_work",
                displayName: "Codex Work",
                usedPercent: 75,
                accountLabel: "work@example.com",
              }),
            ]),
          })}
        />
      </div>,
    );

    expect(html).toContain("Laptop");
    expect(html).toContain("Desktop");
    expect(html).toContain("75% left");
    expect(html).toContain("25% left");
    expect(html).not.toContain("work@example.com");
    expect(html.match(/aria-label="Toggle subscription account visibility"/gu)).toHaveLength(2);
    expect(html.match(/blur-\[2px\]/gu)).toHaveLength(2);
  });

  it("renders loading, offline, and old-environment states independently", () => {
    const loading = renderToStaticMarkup(
      <EnvironmentSubscriptionLimits
        environment={environment({ id: "loading", label: "Loading", isPending: true })}
      />,
    );
    const offline = renderToStaticMarkup(
      <EnvironmentSubscriptionLimits
        environment={environment({
          id: "offline",
          label: "Offline",
          error: "offline",
          connectionPhase: "offline",
        })}
      />,
    );
    const old = renderToStaticMarkup(
      <EnvironmentSubscriptionLimits
        environment={environment({ id: "old", label: "Old", error: "not-supported" })}
      />,
    );
    const failed = renderToStaticMarkup(
      <EnvironmentSubscriptionLimits
        environment={environment({ id: "failed", label: "Failed", error: "error" })}
      />,
    );

    expect(loading).toContain('aria-label="Loading subscription limits for Loading"');
    expect(offline).toContain("not connected");
    expect(old).toContain("not supported by this environment");
    expect(old).toContain("API-equivalent activity remains available in its tab");
    expect(failed).toContain("could not be loaded");
  });

  it("shows stale, authentication, unsupported, and error cards distinctly", () => {
    const stale = renderToStaticMarkup(
      <SubscriptionLimitCard
        environmentId={environmentId("local")}
        instance={readyInstance({
          id: "codex_stale",
          displayName: "Codex Stale",
          usedPercent: 80,
          freshness: "stale",
        })}
      />,
    );
    const stateCard = (state: "needs-auth" | "unsupported" | "error") =>
      renderToStaticMarkup(
        <SubscriptionLimitCard
          environmentId={environmentId("remote")}
          instance={{
            instanceId: instanceId(`cursor_${state}`),
            driver: ProviderDriverKind.make("cursor"),
            displayName: `Cursor ${state}`,
            state,
            accountLabel: "private@example.com",
            message: `${state} message`,
            windows: [],
            details: [],
          }}
        />,
      );

    expect(stale).toContain("Stale");
    const needsAuth = stateCard("needs-auth");
    expect(needsAuth).toContain("Open Cursor needs-auth settings");
    expect(needsAuth).toContain("/settings/providers#provider-instance/remote/");
    expect(needsAuth).not.toContain("private@example.com");
    expect(needsAuth).toContain('aria-label="Toggle subscription account visibility"');
    expect(needsAuth).toContain("blur-[2px]");
    expect(stateCard("unsupported")).toContain("unsupported message");
    expect(stateCard("error")).toContain("error message");
  });

  it("renders remaining allowance in the visual and accessible meter", () => {
    const renderedAt = new Date("2026-08-14T09:00:00.000Z");
    const meter = (window: ProviderSubscriptionUsageWindow) =>
      renderToStaticMarkup(<ProviderSubscriptionWindow window={window} now={renderedAt} />);
    const healthy = meter({ id: "monthly", label: "Monthly", usedPercent: 25 });
    // Raw provider percentages are not capped; only the meter is clamped.
    const exhausted = meter({ id: "weekly", label: "Weekly", usedPercent: 127.5 });
    const low = meter({ id: "five-hour", label: "5-hour", usedPercent: 96 });

    expect(healthy).toContain('aria-valuenow="75"');
    expect(healthy).toContain("width:75%");
    expect(exhausted).toContain('aria-label="Weekly remaining"');
    expect(exhausted).toContain('aria-valuenow="0"');
    expect(exhausted).toContain("width:0%");
    expect(exhausted).toContain("bg-destructive");
    expect(low).toContain("4% left");
    expect(low).toContain('aria-valuenow="4"');
    expect(low).toContain("width:4%");
  });
});
