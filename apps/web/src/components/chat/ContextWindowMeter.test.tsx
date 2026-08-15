import { EventId, type OrchestrationThreadActivity, TurnId } from "@vetra-code/contracts";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../ui/popover", () => ({
  Popover: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ render }: { readonly render: ReactNode }) => render,
  PopoverPopup: ({ children }: { readonly children: ReactNode }) => <div>{children}</div>,
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

describe("ContextWindowMeter", () => {
  it("preserves its trigger and detail presentation through the shared ring", () => {
    const usage = deriveLatestContextWindowSnapshot([
      activity({
        usedTokens: 75_000,
        totalProcessedTokens: 125_000,
        maxTokens: 100_000,
        compactsAutomatically: true,
      }),
    ]);
    if (!usage) throw new Error("context usage fixture did not resolve");

    const html = renderToStaticMarkup(
      <ContextWindowMeter usage={usage} modelDisplayName="Codex" />,
    );

    expect(html).toContain('aria-label="Context window 75% used"');
    expect(html).toContain('data-usage-meter-value="75"');
    expect(html).toContain("75k/100k");
    expect(html).toContain("Total processed");
    expect(html).toContain("125k");
    expect(html).toContain("Context for Codex compacts automatically when needed.");
  });
});
