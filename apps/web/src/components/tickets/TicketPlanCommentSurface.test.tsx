// @vitest-environment jsdom

import { TicketPlanCommentId, type TicketPlanComment } from "@t3tools/contracts";
import type { PlanAnchorLocation, PlanCommentThread } from "@t3tools/shared/ticketPlanAnchors";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { TicketPlanCommentSurface } from "./TicketPlanCommentSurface";

class FakeHighlight {
  readonly ranges: ReadonlyArray<Range>;
  priority = 0;
  constructor(...ranges: Array<Range>) {
    this.ranges = ranges;
  }
}

const highlights = new Map<string, FakeHighlight>();
const BODY = "Hello world\n\nSecond block";

function thread(
  id: string,
  quote: string | null,
  location: PlanAnchorLocation | null,
): PlanCommentThread {
  const comment: TicketPlanComment = {
    id: TicketPlanCommentId.make(id),
    parentId: null,
    anchor: {
      source: quote ?? "Second block",
      revision: 1,
      ...(quote === null ? {} : { quote: { text: quote, prefix: "", suffix: "" } }),
    },
    body: "A comment",
    author: { type: "user" },
    createdAt: "2026-10-01T10:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
  };
  return { comment, location, replies: [] };
}

function highlighted(name: string): ReadonlyArray<string> {
  return highlights.get(name)?.ranges.map((range) => range.toString()) ?? [];
}

function Harness(props: {
  readonly threads: ReadonlyArray<PlanCommentThread>;
  readonly focusedId: string | null;
}) {
  const [focusedId, setFocusedId] = useState(
    props.focusedId === null ? null : TicketPlanCommentId.make(props.focusedId),
  );
  return (
    <TicketPlanCommentSurface
      ref={null}
      body={BODY}
      revision={1}
      threads={props.threads}
      focusedId={focusedId}
      draft={null}
      onDraft={() => {}}
      onFocusThread={setFocusedId}
    >
      <p data-plan-source-start="0" data-plan-source-end="11">
        Hello world
      </p>
      <p data-plan-source-start="13" data-plan-source-end="25">
        Second block
      </p>
    </TicketPlanCommentSurface>
  );
}

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("Highlight", FakeHighlight);
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  // jsdom lays nothing out, so a click lands on no highlighted passage.
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () => [],
  });
  highlights.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(Range.prototype, "getClientRects");
  vi.unstubAllGlobals();
});

async function render(threads: ReadonlyArray<PlanCommentThread>, focusedId: string | null) {
  await act(async () => root.render(<Harness threads={threads} focusedId={focusedId} />));
}

describe("TicketPlanCommentSurface", () => {
  it("highlights the passages of open comments the panel does not mark outdated", async () => {
    await render(
      [
        thread("current", "Hello", { status: "current", start: 0, end: 5 }),
        thread("outdated", "Second", { status: "outdated" }),
      ],
      "outdated",
    );
    expect(highlighted("vetra-plan-comment")).toEqual(["Hello"]);
    expect(highlighted("vetra-plan-comment-focused")).toEqual([]);
  });

  it("marks the block of a focused comment whose quote the rendered plan does not hold", async () => {
    await render(
      [thread("agent", "Second blocks", { status: "moved", start: 13, end: 25 })],
      "agent",
    );
    expect(highlighted("vetra-plan-comment")).toEqual([]);
    expect(highlighted("vetra-plan-comment-focused")).toEqual(["Second block"]);
  });

  it("clears the focus on a click in the plan that hits no passage", async () => {
    await render([thread("current", "Hello", { status: "current", start: 0, end: 5 })], "current");
    expect(highlighted("vetra-plan-comment-focused")).toEqual(["Hello"]);
    await act(async () => container.querySelector("p")!.click());
    expect(highlighted("vetra-plan-comment-focused")).toEqual([]);
    expect(highlighted("vetra-plan-comment")).toEqual(["Hello"]);
  });
});
