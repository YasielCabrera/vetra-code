import { describe, expect, it } from "vite-plus/test";

import { anchorFromSourceQuote, locatePlanAnchor, planSourceBlocks } from "./ticketPlanAnchors.ts";

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
});

describe("anchorFromSourceQuote", () => {
  it("takes the source from every block the quote overlaps, and locates as current", () => {
    const body = "# Plan\n\nAlpha one.\n\nBeta two.\n\nGamma.\n";
    const anchor = {
      quote: { text: "one.\n\nBeta", prefix: "", suffix: "" },
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
