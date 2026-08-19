import { describe, expect, it } from "vite-plus/test";

import {
  collectComposerInlineTokens,
  serializePowerhouseReference,
  type PowerhouseReferenceFields,
} from "./composerInlineTokens.ts";

describe("collectComposerInlineTokens", () => {
  it("collects file links, mentions, and skills with source ranges", () => {
    const text = "Use $ui and inspect [Chat.tsx](src/Chat.tsx) with @AGENTS.md please";

    expect(collectComposerInlineTokens(text)).toEqual([
      {
        type: "skill",
        value: "ui",
        source: "$ui",
        start: 4,
        end: 7,
      },
      {
        type: "mention",
        value: "src/Chat.tsx",
        source: "[Chat.tsx](src/Chat.tsx)",
        start: 20,
        end: 44,
      },
      {
        type: "mention",
        value: "AGENTS.md",
        source: "@AGENTS.md",
        start: 50,
        end: 60,
      },
    ]);
  });

  it("does not convert incomplete trailing tokens", () => {
    expect(collectComposerInlineTokens("Use $ui")).toEqual([]);
    expect(collectComposerInlineTokens("Inspect @AGENTS.md")).toEqual([]);
  });

  it("keeps the delimiter after a token outside its source range", () => {
    const text = "Inspect [package.json](package.json) next";

    expect(collectComposerInlineTokens(text)).toEqual([
      {
        type: "mention",
        value: "package.json",
        source: "[package.json](package.json)",
        start: 8,
        end: 36,
      },
    ]);
    expect(text.slice(36)).toBe(" next");
  });

  it("preserves a confirmed pill when only its trailing delimiter is removed", () => {
    const withDelimiter = "[package.json](package.json) ";
    const confirmed = collectComposerInlineTokens(withDelimiter);

    expect(
      collectComposerInlineTokens(withDelimiter.trimEnd(), { preserveTrailingFrom: confirmed }),
    ).toEqual([
      {
        type: "mention",
        value: "package.json",
        source: "[package.json](package.json)",
        start: 0,
        end: 28,
      },
    ]);
  });

  it("does not preserve a pill after its source is edited", () => {
    const confirmed = collectComposerInlineTokens("[package.json](package.json) ");

    expect(
      collectComposerInlineTokens("[package.json](package-json)", {
        preserveTrailingFrom: confirmed,
      }),
    ).toEqual([]);
  });

  it("ignores normal web links", () => {
    expect(collectComposerInlineTokens("Read [docs](https://example.com) first")).toEqual([]);
  });

  it.each(["@expo/ui", "@jane/foo.js", "@scope/pkg/sub/path"])(
    "keeps scoped package reference %s as plain text",
    (reference) => {
      expect(collectComposerInlineTokens(`Install ${reference} next`)).toEqual([]);
    },
  );

  it("keeps scoped package references plain across incomplete input and IME whitespace", () => {
    expect(collectComposerInlineTokens("Install @expo/ui")).toEqual([]);
    expect(collectComposerInlineTokens("入力 @expo/ui　を追加")).toEqual([]);
  });

  it("keeps bare non-scoped file paths as mentions", () => {
    expect(collectComposerInlineTokens("Inspect @README.md next")).toEqual([
      {
        type: "mention",
        value: "README.md",
        source: "@README.md",
        start: 8,
        end: 18,
      },
    ]);
  });

  it("keeps canonical file links for scoped paths as mentions", () => {
    expect(collectComposerInlineTokens("Inspect [sub](@scope/pkg/sub) next")).toEqual([
      {
        type: "mention",
        value: "@scope/pkg/sub",
        source: "[sub](@scope/pkg/sub)",
        start: 8,
        end: 29,
      },
    ]);
  });

  it("allows ambiguous scoped paths through explicit quoted mentions", () => {
    expect(collectComposerInlineTokens('Inspect @"expo/ui" next')).toEqual([
      {
        type: "mention",
        value: "expo/ui",
        source: '@"expo/ui"',
        start: 8,
        end: 18,
      },
    ]);
  });

  it("still collects a file link whose label is at the length cap", () => {
    const label = `${"a".repeat(508)}.tsx`;
    const tokens = collectComposerInlineTokens(`see [${label}](src/${label}) ok`);

    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.value).toBe(`src/${label}`);
  });

  it("leaves a file link past the label cap as plain text", () => {
    const label = `${"a".repeat(509)}.tsx`;
    expect(collectComposerInlineTokens(`see [${label}](src/${label}) ok`)).toEqual([]);
  });

  it("stays fast on unterminated bracket runs", () => {
    // Unbounded, the label body rescanned the rest of the text from every
    // whitespace: this input took seconds.
    const started = performance.now();
    expect(collectComposerInlineTokens(" [[".repeat(40_000))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

const reference = (
  overrides: Partial<PowerhouseReferenceFields> = {},
): PowerhouseReferenceFields => ({
  kind: "doc",
  id: "c4cb1cab-fb9e-4c12-a76c-d865b36f48c6",
  name: "nordwind-p1.pdf",
  documentType: "pfnur/toll-statement",
  slug: "",
  path: "powerhouse/Invoices",
  reactorUrl: "http://127.0.0.1:4001",
  ...overrides,
});

describe("serializePowerhouseReference", () => {
  it("writes the addressable token followed by the facts in a fixed order", () => {
    expect(serializePowerhouseReference(reference())).toBe(
      "`powerhouse:doc/c4cb1cab-fb9e-4c12-a76c-d865b36f48c6` (nordwind-p1.pdf \u00b7 pfnur/toll-statement \u00b7 in powerhouse/Invoices \u00b7 http://127.0.0.1:4001)",
    );
  });

  it("leaves out the facts a caller had nothing for", () => {
    expect(
      serializePowerhouseReference(
        reference({ kind: "drive", id: "powerhouse", name: "", documentType: "", path: "" }),
      ),
    ).toBe("`powerhouse:drive/powerhouse` (http://127.0.0.1:4001)");
  });
});

describe("collectComposerInlineTokens with Powerhouse references", () => {
  it("names the item for every combination of present and absent facts", () => {
    const cases: ReadonlyArray<readonly [PowerhouseReferenceFields, string]> = [
      [reference(), "nordwind-p1.pdf"],
      [reference({ path: "" }), "nordwind-p1.pdf"],
      [reference({ slug: "toll" }), "nordwind-p1.pdf"],
      [reference({ kind: "folder", documentType: "", name: "Invoices" }), "Invoices"],
      [
        reference({ kind: "drive", documentType: "", path: "", slug: "powerhouse" }),
        "nordwind-p1.pdf",
      ],
      // A name carrying the separator must survive, since the reactor picks it.
      [reference({ name: "a \u00b7 b" }), "a \u00b7 b"],
      // No name: the chip falls back to the id the reference addresses.
      [reference({ name: "" }), "c4cb1cab-fb9e-4c12-a76c-d865b36f48c6"],
      [
        reference({ kind: "drive", documentType: "", name: "", path: "", id: "drive-1" }),
        "drive-1",
      ],
    ];
    for (const [fields, expected] of cases) {
      const source = serializePowerhouseReference(fields);
      const token = collectComposerInlineTokens(`${source} `)[0];
      if (token?.type !== "powerhouse") throw new Error(`not a reference: ${source}`);
      expect(token.label).toBe(expected);
      expect(token.source).toBe(source);
    }
  });

  it("collects a reference with its label, detail, and source range", () => {
    const source = serializePowerhouseReference(reference());
    const tokens = collectComposerInlineTokens(`look at ${source} now`);

    expect(tokens).toHaveLength(1);
    const token = tokens[0];
    expect(token?.type).toBe("powerhouse");
    if (token?.type !== "powerhouse") return;
    expect(token.value).toBe("doc/c4cb1cab-fb9e-4c12-a76c-d865b36f48c6");
    expect(token.kind).toBe("doc");
    expect(token.label).toBe("nordwind-p1.pdf");
    expect(token.detail).toBe(
      "nordwind-p1.pdf \u00b7 pfnur/toll-statement \u00b7 in powerhouse/Invoices \u00b7 http://127.0.0.1:4001",
    );
    expect(token.source).toBe(source);
    expect(`look at ${source} now`.slice(token.start, token.end)).toBe(source);
  });

  it("keeps two adjacent references apart", () => {
    const first = serializePowerhouseReference(reference({ id: "a" }));
    const second = serializePowerhouseReference(reference({ id: "b" }));
    const tokens = collectComposerInlineTokens(`${first} ${second} end`);

    expect(tokens.map((token) => token.source)).toEqual([first, second]);
  });

  it("matches a reference whose name carries parentheses", () => {
    const source = serializePowerhouseReference(reference({ name: "report (final).pdf" }));
    const tokens = collectComposerInlineTokens(`${source} end`);

    const token = tokens[0];
    if (token?.type !== "powerhouse") throw new Error("expected a powerhouse token");
    expect(token.label).toBe("report (final).pdf");
    expect(token.source).toBe(source);
  });

  it("collects references alongside mentions and skills, in source order", () => {
    const source = serializePowerhouseReference(reference());
    const tokens = collectComposerInlineTokens(`$ui [a.ts](src/a.ts) ${source} @AGENTS.md done`);

    expect(tokens.map((token) => token.type)).toEqual([
      "skill",
      "mention",
      "powerhouse",
      "mention",
    ]);
  });

  it("stays fast on unterminated reference runs", () => {
    const started = performance.now();
    expect(collectComposerInlineTokens(" `powerhouse:doc/a` (".repeat(20_000))).toEqual([]);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
