import { describe, expect, it } from "vite-plus/test";

import { sdlFoldRanges } from "./sdlFolding";

describe("sdlFoldRanges", () => {
  it("finds multiline type, enum, input, interface, and schema bodies", () => {
    const source = [
      "schema {",
      "  query: Query",
      "}",
      "enum Status {",
      "  ACTIVE",
      "  ARCHIVED",
      "}",
      "interface Node {",
      "  id: ID!",
      "}",
      "input Filter {",
      "  query: String",
      "}",
      "type Query {",
      "  node: Node",
      "}",
    ].join("\n");

    const ranges = sdlFoldRanges(source);
    expect(ranges.map(({ startLine, endLine, label }) => ({ startLine, endLine, label }))).toEqual([
      { startLine: 1, endLine: 3, label: "schema" },
      { startLine: 4, endLine: 7, label: "enum Status" },
      { startLine: 8, endLine: 10, label: "interface Node" },
      { startLine: 11, endLine: 13, label: "input Filter" },
      { startLine: 14, endLine: 16, label: "type Query" },
    ]);
    expect(new Set(ranges.map((range) => range.id)).size).toBe(ranges.length);
  });

  it("ignores braces in descriptions, comments, strings, and directive arguments", () => {
    const source = [
      '"""Description with { braces }"""',
      "# another { brace }",
      'type Rule @meta(config: { pattern: "}" }) {',
      "  value: String",
      "}",
    ].join("\n");

    expect(
      sdlFoldRanges(source).map(({ startLine, endLine, label }) => ({
        startLine,
        endLine,
        label,
      })),
    ).toEqual([{ startLine: 3, endLine: 5, label: "type Rule" }]);
  });

  it("supports extensions and skips declarations without multiline bodies", () => {
    const source = [
      "scalar Date",
      "union Result = Success | Failure",
      "type Inline { value: String }",
      "extend type User {",
      "  name: String",
      "}",
      "type Unclosed {",
      "  id: ID",
    ].join("\n");

    expect(
      sdlFoldRanges(source).map(({ startLine, endLine, label }) => ({
        startLine,
        endLine,
        label,
      })),
    ).toEqual([{ startLine: 4, endLine: 6, label: "type User" }]);
  });
});
