import { type TicketPlanComment, TicketPlanCommentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  anchorFromRenderedSelection,
  anchorFromSourceQuote,
  locatePlanAnchor,
  orderPlanCommentThreads,
  planSourceBlocks,
} from "./ticketPlanAnchors.ts";

const BODY = "# Plan\n\nFirst step uses **foo** bar.\n\nSecond step.\n";
const ANCHOR = {
  quote: { text: "foo bar", prefix: "", suffix: "" },
  source: "First step uses **foo** bar.",
  revision: 1,
};

describe("locatePlanAnchor", () => {
  it("resolves an unchanged block as current, and still current after an edit before it", () => {
    expect(locatePlanAnchor(BODY, ANCHOR)).toEqual({ status: "current", start: 8, end: 36 });
    expect(
      locatePlanAnchor(
        "# Plan\n\nIntro.\n\nFirst step uses **foo** bar.\n\nSecond step.\n",
        ANCHOR,
      ),
    ).toEqual({ status: "current", start: 16, end: 44 });
  });

  it("finds the quoted words as moved after an edit inside the block", () => {
    expect(
      locatePlanAnchor("# Plan\n\nFirst step now uses foo\nbar.\n\nSecond step.\n", ANCHOR),
    ).toEqual({ status: "moved", start: 28, end: 35 });
  });

  it("matches a rendered quote across inline markers and links, spanning the raw text", () => {
    expect(locatePlanAnchor("# Plan\n\nThe first step uses **foo** bar.\n", ANCHOR)).toEqual({
      status: "moved",
      start: 30,
      end: 39,
    });
    expect(
      locatePlanAnchor("# Plan\n\nThe first step uses [foo](https://x.test) bar.\n", ANCHOR),
    ).toEqual({ status: "moved", start: 29, end: 53 });
  });

  it("matches a quote across emphasis underscores and list, heading and blockquote markers", () => {
    expect(
      locatePlanAnchor("Use _fast_ mode for all builds.", {
        quote: { text: "fast mode", prefix: "Use ", suffix: " for builds." },
        source: "Use _fast_ mode for builds.",
        revision: 1,
      }),
    ).toEqual({ status: "moved", start: 5, end: 15 });
    expect(
      locatePlanAnchor("- alpha one\n- beta three\n", {
        quote: { text: "alpha one\nbeta", prefix: "", suffix: "" },
        source: "- alpha one\n- beta two\n",
        revision: 1,
      }),
    ).toEqual({ status: "moved", start: 2, end: 18 });
    expect(
      locatePlanAnchor("## Steps\n\n> 1. Back off\n> 2) Give up\n\n+ Log it\n", {
        quote: { text: "Steps\n\nBack off\nGive up\n\nLog it", prefix: "", suffix: "" },
        source: "gone",
        revision: 1,
      }),
    ).toEqual({ status: "moved", start: 3, end: 46 });
  });

  it("keeps snake_case underscores and regex metacharacters as text", () => {
    const moved = (body: string, text: string) =>
      locatePlanAnchor(body, {
        quote: { text, prefix: "", suffix: "" },
        source: "gone",
        revision: 1,
      });
    expect(moved("Set **max_retries** to 3.", "max_retries to 3")).toEqual({
      status: "moved",
      start: 6,
      end: 24,
    });
    expect(moved("Cost is $5 (approx) [x] a\\b c.", "$5 (approx)\n[x] a\\b")).toEqual({
      status: "moved",
      start: 8,
      end: 27,
    });
  });

  it("marks a deleted passage outdated", () => {
    expect(locatePlanAnchor("# Plan\n\nSecond step.\n", ANCHOR)).toEqual({ status: "outdated" });
  });

  it("marks a source-only anchor outdated once its block changes", () => {
    const blockAnchor = { source: "```sh\nnpm test\n```", revision: 1 };
    expect(locatePlanAnchor("Run:\n\n```sh\nnpm test\n```\n", blockAnchor)).toEqual({
      status: "current",
      start: 6,
      end: 24,
    });
    expect(locatePlanAnchor("Run:\n\n```sh\nnpm run test\n```\n", blockAnchor)).toEqual({
      status: "outdated",
    });
  });

  it("marks ambiguous legacy blocks and quotes outdated", () => {
    expect(
      locatePlanAnchor("```sh\nnpm test\n```\n\n```sh\nnpm test\n```", {
        source: "```sh\nnpm test\n```",
        revision: 1,
      }),
    ).toEqual({ status: "outdated" });
    expect(
      locatePlanAnchor("Run npm test.\n\nAlso run npm test.", {
        source: "Original instructions: npm test",
        quote: { text: "npm test", prefix: "", suffix: "" },
        revision: 1,
      }),
    ).toEqual({ status: "outdated" });
  });

  it("uses rendered quote context to find the right repeated passage after an edit", () => {
    const body = "Alpha: run **npm test**.\n\nBeta: run **npm test** after setup.";
    const start = body.lastIndexOf("npm test");
    expect(
      locatePlanAnchor(body, {
        source: "Beta: run npm test before setup.",
        quote: { text: "npm test", prefix: "Beta: run ", suffix: " after setup." },
        revision: 1,
      }),
    ).toEqual({ status: "moved", start, end: start + "npm test".length });
  });

  it("keeps selected whitespace when matching context around repeated quotes", () => {
    const body = "First: same words end.\n\nSecond: same words stop.";
    const start = body.lastIndexOf(" same words ");
    expect(
      locatePlanAnchor(body, {
        source: "gone",
        quote: { text: " same\nwords ", prefix: "Second:", suffix: "stop." },
        revision: 1,
      }),
    ).toEqual({ status: "moved", start, end: start + " same words ".length });
  });

  it("does not prefer a literal occurrence over a different rendered contextual match", () => {
    const body = "First: foo.\n\nSecond: **f**oo.";
    const start = body.lastIndexOf("f**oo");
    expect(
      locatePlanAnchor(body, {
        source: "gone",
        quote: { text: "foo", prefix: "Second: ", suffix: "." },
        revision: 1,
      }),
    ).toEqual({ status: "moved", start, end: start + "f**oo".length });
  });
});

describe("anchorFromSourceQuote", () => {
  it("takes the source from every block the quote overlaps, and locates as current", () => {
    const body = "# Plan\n\nAlpha one.\n\nBeta two.\n\nGamma.\n";
    const anchor = {
      quote: { text: "one. Beta", prefix: "", suffix: "" },
      source: "Alpha one.\n\nBeta two.",
      revision: 3,
    };
    expect(anchorFromSourceQuote(body, "one.\n\nBeta", 3)).toEqual(anchor);
    expect(locatePlanAnchor(body, anchor)).toEqual({ status: "current", start: 8, end: 29 });
  });

  it("keeps a fenced code block with blank lines as one block", () => {
    expect(
      anchorFromSourceQuote(
        "Intro\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\nOutro\n",
        "const b = 2;",
        2,
      ),
    ).toMatchObject({ source: "```ts\nconst a = 1;\n\nconst b = 2;\n```" });
  });

  it("cuts an oversized block to a window around the quote", () => {
    const anchor = anchorFromSourceQuote(
      "x".repeat(5_000) + "NEEDLE" + "y".repeat(5_000),
      "NEEDLE",
      1,
    );
    expect(anchor).toMatchObject({ source: "x".repeat(1_997) + "NEEDLE" + "y".repeat(1_997) });
  });

  it("stores the quoted range as it renders, and no quote for markup alone", () => {
    const body = "## Steps\n\n1. Retry the **token** call.\n\n```\nlog()\n```\n";
    expect(
      ["## Steps", "1. Retry the", "**token**", "```\nlog"].map((quote) => {
        const anchor = anchorFromSourceQuote(body, quote, 1);
        return "quote" in anchor ? anchor.quote?.text : anchor;
      }),
    ).toEqual(["Steps", "Retry the", "token", "log"]);
    expect(anchorFromSourceQuote(body, "## ", 1)).toEqual({ source: "## Steps", revision: 1 });
  });

  it("counts the matches of a quote that is not in the source exactly once", () => {
    expect(anchorFromSourceQuote(BODY, "foo bar", 1)).toEqual({ matches: 0 });
    expect(anchorFromSourceQuote(BODY, "step", 1)).toEqual({ matches: 2 });
    expect(anchorFromSourceQuote(BODY, "**foo** bar", 1)).toMatchObject({
      source: "First step uses **foo** bar.",
    });
  });

  it("rejects overlapping occurrences of a source quote", () => {
    expect(anchorFromSourceQuote("aaa", "aa", 1)).toEqual({ matches: 2 });
    expect(anchorFromSourceQuote("aaaa", "aa", 1)).toEqual({ matches: 3 });
  });
});

describe("planSourceBlocks", () => {
  it("splits on blank lines and ends a fence only at a matching closing fence", () => {
    expect(planSourceBlocks("Text\n~~~~\nx\n~~~\n\ny\n~~~~\nafter")).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 23 },
      { start: 24, end: 29 },
    ]);
  });
});

describe("anchorFromRenderedSelection", () => {
  const body = "# Plan\n\nFirst step uses **foo** bar.\n\n```ts\nconst a = 1;\n```\n";

  it("takes the source of the blocks the selection spans and keeps the rendered quote", () => {
    const quote = { text: "Plan First step", prefix: "", suffix: " uses foo bar." };
    const anchor = anchorFromRenderedSelection(body, { start: 0, end: 36 }, quote, 4);
    expect(anchor).toEqual({
      quote,
      source: "# Plan\n\nFirst step uses **foo** bar.",
      revision: 4,
    });
    expect(locatePlanAnchor(body, anchor)).toEqual({ status: "current", start: 0, end: 36 });
  });

  it("anchors a whole block without a quote", () => {
    expect(anchorFromRenderedSelection(body, { start: 38, end: 60 }, undefined, 1)).toEqual({
      source: "```ts\nconst a = 1;\n```",
      revision: 1,
    });
  });

  it("cuts a long span to a window around the rendered quote", () => {
    const long = `${"x".repeat(5_000)} **NEEDLE** ${"y".repeat(5_000)}`;
    const anchor = anchorFromRenderedSelection(
      long,
      { start: 0, end: long.length },
      { text: "NEEDLE y", prefix: "", suffix: "" },
      1,
    );
    expect(anchor.source).toBe(`${"x".repeat(1_992)} **NEEDLE** ${"y".repeat(1_996)}`);
  });

  it.each([
    { prefix: "", suffix: "" },
    { prefix: "Other block has ", suffix: "." },
  ])("keeps a span-local quote when the document match is ambiguous or elsewhere", (context) => {
    const outside = "Other block has NEEDLE.\n\n";
    const selectedBlock = `${"x".repeat(6_000)} **NEEDLE** ${"y".repeat(1_000)}`;
    const body = `${outside}${selectedBlock}`;
    const anchor = anchorFromRenderedSelection(
      body,
      { start: outside.length, end: body.length },
      { text: "NEEDLE", ...context },
      1,
    );
    expect(anchor.source.length).toBe(4_000);
    expect(anchor.source).toContain("**NEEDLE**");
    expect(locatePlanAnchor(body, anchor).status).toBe("current");
  });

  it.each([
    ["code", "```sh\nnpm test\n```"],
    ["diagram", "```mermaid\ngraph TD; A-->B\n```"],
    ["image", "![Preview](vetra-attachment://image-1)"],
  ])("locates a comment on the second identical %s block", (_kind, block) => {
    const duplicateBody = `First context\n\n${block}\n\nSecond context\n\n${block}\n`;
    const start = duplicateBody.lastIndexOf(block);
    const anchor = anchorFromRenderedSelection(
      duplicateBody,
      { start, end: start + block.length },
      undefined,
      1,
    );
    expect(locatePlanAnchor(duplicateBody, anchor)).toEqual({
      status: "current",
      start,
      end: start + block.length,
    });
    const movedBody = `Introduction.\n\n${duplicateBody}`;
    expect(locatePlanAnchor(movedBody, anchor)).toEqual({
      status: "current",
      start: start + "Introduction.\n\n".length,
      end: start + "Introduction.\n\n".length + block.length,
    });
  });

  it("distinguishes duplicate blocks at document edges", () => {
    const block = "```sh\nnpm test\n```";
    const duplicateBody = `${block}\n\n${block}`;
    const start = duplicateBody.lastIndexOf(block);
    const anchor = anchorFromRenderedSelection(
      duplicateBody,
      { start, end: duplicateBody.length },
      undefined,
      1,
    );
    expect(locatePlanAnchor(duplicateBody, anchor)).toEqual({
      status: "current",
      start,
      end: duplicateBody.length,
    });
  });

  it("keeps an anchored first duplicate after a heading is prepended", () => {
    const block = "```sh\nnpm test\n```";
    const body = `${block}\n\nSecond section\n\n${block}`;
    const anchor = anchorFromRenderedSelection(body, { start: 0, end: block.length }, undefined, 1);
    const introduction = "# Introduction\n\n";
    expect(anchor.sourceContext?.prefix).toBe("");
    expect(locatePlanAnchor(`${introduction}${body}`, anchor)).toEqual({
      status: "current",
      start: introduction.length,
      end: introduction.length + block.length,
    });
  });

  it("keeps an anchored last duplicate after more text is appended", () => {
    const block = "```sh\nnpm test\n```";
    const body = `${block}\n\nSecond section\n\n${block}`;
    const start = body.lastIndexOf(block);
    const anchor = anchorFromRenderedSelection(body, { start, end: body.length }, undefined, 1);
    expect(anchor.sourceContext?.suffix).toBe("");
    expect(locatePlanAnchor(`${body}\n\n# Next steps`, anchor)).toEqual({
      status: "current",
      start,
      end: body.length,
    });
  });

  it("does not move a deleted duplicate block's comment onto the surviving copy", () => {
    const block = "```sh\nnpm test\n```";
    const duplicateBody = `First context\n\n${block}\n\nSecond context\n\n${block}\n`;
    const start = duplicateBody.lastIndexOf(block);
    const anchor = anchorFromRenderedSelection(
      duplicateBody,
      { start, end: start + block.length },
      undefined,
      1,
    );
    expect(locatePlanAnchor(`First context\n\n${block}\n`, anchor)).toEqual({ status: "outdated" });
  });

  it("marks duplicate blocks with indistinguishable surrounding context outdated", () => {
    const block = "```sh\nnpm test\n```";
    const repeated = `${"x".repeat(40)}\n\n${block}\n\n${"y".repeat(40)}`;
    const duplicateBody = `${repeated}\n\n${repeated}`;
    const start = duplicateBody.lastIndexOf(block);
    const anchor = anchorFromRenderedSelection(
      duplicateBody,
      { start, end: start + block.length },
      undefined,
      1,
    );
    expect(locatePlanAnchor(duplicateBody, anchor)).toEqual({ status: "outdated" });
  });
});

describe("orderPlanCommentThreads", () => {
  const body = "Alpha one.\n\nBeta two.\n";
  let created = 0;
  const comment = (
    id: string,
    patch: Partial<Pick<TicketPlanComment, "parentId" | "anchor" | "resolvedAt">> = {},
  ): TicketPlanComment => ({
    id: TicketPlanCommentId.make(id),
    parentId: null,
    anchor: null,
    body: id,
    author: { type: "user" },
    createdAt: `2026-10-03T10:00:0${created++}.000Z`,
    resolvedAt: null,
    resolvedBy: null,
    ...patch,
  });
  const quoted = (text: string, source: string) => ({
    quote: { text, prefix: "", suffix: "" },
    source,
    revision: 1,
  });

  it("orders anchored threads by position, then outdated and whole-plan ones oldest first", () => {
    const threads = orderPlanCommentThreads(body, [
      comment("whole"),
      comment("beta", { anchor: quoted("two", "Beta two.") }),
      comment("gone", { anchor: quoted("three", "Gamma three.") }),
      comment("reply-to-beta", { parentId: TicketPlanCommentId.make("beta") }),
      comment("alpha", {
        anchor: quoted("one", "Alpha one."),
        resolvedAt: "2026-10-03T11:00:00.000Z",
      }),
      comment("moved", { anchor: quoted("Beta", "Beta 2.") }),
      comment("second-reply-to-beta", { parentId: TicketPlanCommentId.make("beta") }),
    ]);
    expect(
      threads.map((thread) => [
        thread.comment.id,
        thread.location,
        thread.replies.map((reply) => reply.id),
      ]),
    ).toEqual([
      ["alpha", { status: "current", start: 0, end: 10 }, []],
      [
        "beta",
        { status: "current", start: 12, end: 21 },
        ["reply-to-beta", "second-reply-to-beta"],
      ],
      ["moved", { status: "moved", start: 12, end: 16 }, []],
      ["whole", null, []],
      ["gone", { status: "outdated" }, []],
    ]);
  });

  it("orders comments on repeated blocks by the selected copy", () => {
    const block = "```sh\nnpm test\n```";
    const repeatedBody = `First\n\n${block}\n\nMiddle.\n\nSecond\n\n${block}`;
    const anchorAt = (start: number) =>
      anchorFromRenderedSelection(repeatedBody, { start, end: start + block.length }, undefined, 1);
    const threads = orderPlanCommentThreads(repeatedBody, [
      comment("second-block", { anchor: anchorAt(repeatedBody.lastIndexOf(block)) }),
      comment("middle", { anchor: { source: "Middle.", revision: 1 } }),
      comment("first-block", { anchor: anchorAt(repeatedBody.indexOf(block)) }),
    ]);
    expect(threads.map(({ comment }) => comment.id)).toEqual([
      "first-block",
      "middle",
      "second-block",
    ]);
  });
});
