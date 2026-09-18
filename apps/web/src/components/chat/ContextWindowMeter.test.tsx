import { EventId, type OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverPopup: ({ children }: { children: ReactNode }) => children,
  PopoverTrigger: ({ closeDelay, render }: { closeDelay: number; render: ReactNode }) => (
    <div data-close-delay={closeDelay}>{render}</div>
  ),
}));

import { deriveLatestContextWindowSnapshot } from "../../lib/contextWindow";
import { ContextWindowMeter } from "./ContextWindowMeter";

const activity = (payload: unknown): OrchestrationThreadActivity => ({
  id: EventId.make("context-meter-test"),
  tone: "info",
  kind: "context-window.updated",
  summary: "Context window updated",
  payload,
  turnId: TurnId.make("turn-1"),
  createdAt: "2026-08-14T12:00:00.000Z",
});

const usage = deriveLatestContextWindowSnapshot([
  activity({ usedTokens: 100_000, maxTokens: 1_000_000 }),
]);

if (!usage) {
  throw new Error("The context window test fixture did not produce a snapshot.");
}

describe("ContextWindowMeter", () => {
  it("preserves its trigger and detail presentation through the shared ring", () => {
    const detailedUsage = deriveLatestContextWindowSnapshot([
      activity({
        usedTokens: 75_000,
        totalProcessedTokens: 125_000,
        maxTokens: 100_000,
        compactsAutomatically: true,
      }),
    ]);
    if (!detailedUsage) throw new Error("context usage fixture did not resolve");

    const html = renderToStaticMarkup(
      <ContextWindowMeter usage={detailedUsage} modelDisplayName="Codex" />,
    );

    expect(html).toContain('aria-label="Context window 75% used"');
    expect(html).toContain('data-usage-meter-value="75"');
    expect(html).toContain("75k/100k");
    expect(html).toContain("Total processed");
    expect(html).toContain("125k");
    expect(html).toContain("Context for Codex compacts automatically when needed.");
  });

  it("keeps the hover popover open while the pointer moves to the compact button", () => {
    const markup = renderToStaticMarkup(<ContextWindowMeter usage={usage} onCompact={() => {}} />);

    expect(markup).toContain('data-close-delay="150"');
    expect(markup).toContain("Compact context");
  });

  it("closes an informational hover popover without delay", () => {
    const markup = renderToStaticMarkup(<ContextWindowMeter usage={usage} />);

    expect(markup).toContain('data-close-delay="0"');
    expect(markup).not.toContain("Compact context");
  });

  it("explains why the compact action is disabled", () => {
    const markup = renderToStaticMarkup(
      <ContextWindowMeter
        usage={usage}
        onCompact={() => {}}
        compactDisabled
        compactDisabledReason="Send or clear your draft before compacting"
      />,
    );

    expect(markup).toContain('disabled=""');
    expect(markup).toContain(">Send or clear your draft before compacting<");
    expect(markup).not.toContain('aria-label="Send or clear your draft before compacting"');
  });
});
