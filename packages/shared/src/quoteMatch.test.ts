import { describe, expect, it } from "vite-plus/test";
import { ASSISTANT_CITATION_CONTEXT_LENGTH } from "@t3tools/contracts";

import { matchQuote, normalizeWhitespace, type SearchText, searchText } from "./quoteMatch.ts";

describe("matchQuote", () => {
  it.each([
    { text: "quote", prefix: "c ", suffix: "", expected: { start: 13, end: 18 } },
    { text: "quote", prefix: "", suffix: " b", expected: { start: 2, end: 7 } },
    { text: "quote", prefix: "", suffix: "", expected: null },
    { text: "quote", prefix: "x ", suffix: "", expected: null },
    { text: "quote\n  d", prefix: "x ", suffix: "", expected: { start: 13, end: 20 } },
    { text: " \n", prefix: "", suffix: "", expected: null },
  ])(
    "takes the one fitting occurrence, else the only one: $text / $prefix / $suffix",
    ({ expected, ...selector }) => {
      expect(matchQuote([{ text: "a quote b; c quote d" }], selector)).toEqual(expected);
    },
  );

  it("counts occurrences that several texts place at one span once", () => {
    const source = "x * y x y";
    const texts = [searchText(source), searchText(source, new Uint8Array([0, 0, 1]))];
    const place = ({ offsets }: SearchText, start: number, end: number) => ({
      start: offsets[start]!,
      end: offsets[end - 1]! + 1,
    });
    expect(texts[1]).toEqual({ text: "x y x y", offsets: [0, 1, 4, 5, 6, 7, 8] });
    expect(matchQuote(texts, { text: "x y", prefix: "", suffix: "" }, place)).toBeNull();
    expect(matchQuote(texts, { text: "x y", prefix: "y ", suffix: "" }, place)).toEqual({
      start: 6,
      end: 9,
    });
  });

  function selector(
    text: string,
    overrides: Partial<{ start: number; end: number; prefix: string; suffix: string }> = {},
  ) {
    return {
      text,
      start: 0,
      end: text.replace(/\s+/g, " ").length,
      prefix: "",
      suffix: "",
      ...overrides,
    };
  }

  function matchDocument(text: string, quote: ReturnType<typeof selector>) {
    return matchQuote([{ text: normalizeWhitespace(text) }], quote);
  }

  it("resolves an exact selection with its saved position and context", () => {
    expect(
      matchDocument(
        "Before the selected text after.",
        selector("selected text", { start: 11, end: 24, prefix: "Before the ", suffix: " after." }),
      ),
    ).toEqual({ start: 11, end: 24 });
  });

  it("finds a unique quote when insertion before it shifts its offsets", () => {
    expect(
      matchDocument(
        "An inserted paragraph. Before the selected text after.",
        selector("selected text", { start: 11, end: 24, prefix: "Before the ", suffix: " after." }),
      ),
    ).toEqual({ start: 34, end: 47 });
  });

  it("still finds a unique quote after its surrounding text changes", () => {
    expect(
      matchDocument(
        "New selected text nearby.",
        selector("selected text", { start: 11, end: 24, prefix: "Before the ", suffix: " after." }),
      ),
    ).toEqual({ start: 4, end: 17 });
  });

  it("uses both context sides when each side alone matches several repeated quotes", () => {
    const text = "left quote one; other quote two; left quote two";
    expect(
      matchDocument(
        text,
        selector("quote", { start: 5, end: 10, prefix: "left ", suffix: " two" }),
      ),
    ).toEqual({ start: 38, end: 43 });
  });

  it("does not trust stale offsets that now point at another occurrence", () => {
    expect(
      matchDocument(
        "wrong quote here; right quote there",
        selector("quote", { start: 6, end: 11, prefix: "right ", suffix: " there" }),
      ),
    ).toEqual({ start: 24, end: 29 });
  });

  it.each([
    { prefix: "first ", suffix: "", expected: { start: 6, end: 11 } },
    { prefix: "", suffix: " last", expected: { start: 14, end: 19 } },
  ])(
    "allows a single context side to disambiguate: $prefix / $suffix",
    ({ expected, ...context }) => {
      expect(matchDocument("first quote / quote last", selector("quote", context))).toEqual(
        expected,
      );
    },
  );

  it("does not guess between quotes without context, even at the saved position", () => {
    expect(matchDocument("quote / quote", selector("quote"))).toBeNull();
  });

  it("does not use distance or saved offsets to break a context tie", () => {
    expect(
      matchDocument(
        "same quote end / same quote end",
        selector("quote", { start: 5, end: 10, prefix: "same ", suffix: " end" }),
      ),
    ).toBeNull();
  });

  it("rejects repeated quotes when neither occurrence matches all supplied context", () => {
    expect(
      matchDocument(
        "left quote wrong / wrong quote right",
        selector("quote", { prefix: "left ", suffix: " right" }),
      ),
    ).toBeNull();
  });

  it("counts overlapping occurrences when checking ambiguity", () => {
    expect(matchDocument("banana", selector("ana", { start: 1, end: 4 }))).toBeNull();
  });

  it("matches multiline code after indentation, tabs, and line endings change", () => {
    const quote = "if (ready) {\r\n    run();\r\n}";
    expect(
      matchDocument(
        "Example:\nif (ready) {\n\trun();\n}\nDone.",
        selector(quote, { prefix: "Example:\n", suffix: "\nDone." }),
      ),
    ).toEqual({ start: 9, end: 30 });
  });

  it("normalizes nonbreaking spaces and keeps selected boundary whitespace", () => {
    expect(
      matchDocument("before\u00a0\n quoted\t text \nafter", selector("\nquoted  text\t")),
    ).toEqual({ start: 6, end: 19 });
  });

  it("does not trim the document's leading whitespace out of its offsets", () => {
    expect(matchDocument("\n\t  quote", selector("quote"))).toEqual({
      start: 1,
      end: 6,
    });
  });

  it("uses UTF-16 offsets for emoji and combining characters", () => {
    expect(matchDocument("😀 cafe\u0301 🚀 done", selector("cafe\u0301 🚀"))).toEqual({
      start: 3,
      end: 11,
    });
  });

  it("uses up to 32 UTF-16 context units without requiring the entire surrounding text", () => {
    const prefix = "x".repeat(ASSISTANT_CITATION_CONTEXT_LENGTH - 1) + " ";
    const suffix = " " + "y".repeat(ASSISTANT_CITATION_CONTEXT_LENGTH - 1);
    const text = `unrelated quote / ${prefix}quote${suffix} changed further away`;
    const start = text.lastIndexOf("quote");
    expect(matchDocument(text, selector("quote", { prefix, suffix }))).toEqual({
      start,
      end: start + 5,
    });
  });

  it.each(["", " \n\t\r\n", "absent", "QUOTE", "qu.te"])(
    "rejects empty or missing literal text: %j",
    (quote) => {
      expect(matchDocument("quote", selector(quote))).toBeNull();
    },
  );

  it.each([
    { start: -1, end: 4 },
    { start: 2.5, end: 7.5 },
    { start: Number.NaN, end: Number.NaN },
    { start: Number.POSITIVE_INFINITY, end: Number.POSITIVE_INFINITY },
    { start: 8, end: 3 },
  ])("treats invalid stored offsets as unusable hints: $start / $end", (offsets) => {
    expect(matchDocument("a quote", selector("quote", offsets))).toEqual({
      start: 2,
      end: 7,
    });
  });

  it("preserves multiline quotes and their matching location", () => {
    const quote = "selected\r\n  code 🚀";
    const prefix = "x".repeat(ASSISTANT_CITATION_CONTEXT_LENGTH - 1);
    const suffix = "y".repeat(ASSISTANT_CITATION_CONTEXT_LENGTH - 1);
    const text = `${quote} elsewhere\n😀${prefix}${quote}${suffix}🚀`;
    const start = "selected code 🚀 elsewhere 😀".length + prefix.length;
    const end = start + "selected code 🚀".length;
    const parsed = selector(quote, { start, end, prefix, suffix });
    expect(matchDocument(text, parsed)).toEqual({ start, end });
    expect(matchDocument(`Inserted paragraph.\n${text}`, parsed)).toEqual({
      start: "Inserted paragraph. ".length + start,
      end: "Inserted paragraph. ".length + end,
    });
  });

  it.each(["prefix", "suffix"])(
    "does not relocate to a replacement-character decoy after clipping the %s",
    (side) => {
      const prefix = "x".repeat(ASSISTANT_CITATION_CONTEXT_LENGTH - (side === "prefix" ? 1 : 0));
      const suffix = "y".repeat(ASSISTANT_CITATION_CONTEXT_LENGTH - (side === "suffix" ? 1 : 0));
      const occurrence = (character: string) =>
        `${side === "prefix" ? character : ""}${prefix}quote${suffix}${side === "suffix" ? character : ""}`;
      const text = `${occurrence("😀")} / ${occurrence("\uFFFD")}`;
      const start = side === "prefix" ? 33 : 32;
      expect(
        matchDocument(text, selector("quote", { start, end: start + 5, prefix, suffix })),
      ).toBeNull();
    },
  );
});
