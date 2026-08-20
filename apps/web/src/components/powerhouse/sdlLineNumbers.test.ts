import { describe, expect, it } from "vite-plus/test";

import { countCodeLines, lineNumberGutterText } from "./sdlLineNumbers";

describe("countCodeLines", () => {
  it("numbers a single line without separators", () => {
    expect(countCodeLines("type Todo { id: ID! }")).toBe(1);
    expect(countCodeLines("")).toBe(1);
  });

  it("counts one line per separator", () => {
    expect(countCodeLines("type Todo {\n  id: ID!\n}")).toBe(3);
  });

  it("keeps the trailing empty line Shiki renders", () => {
    expect(countCodeLines("type Todo {\n  id: ID!\n}\n")).toBe(4);
  });
});

describe("lineNumberGutterText", () => {
  it("joins the numbers so the gutter is one text node", () => {
    expect(lineNumberGutterText(3)).toBe("1\n2\n3");
  });

  it("stays aligned with the code it labels", () => {
    const code = "enum Status {\n  DRAFT\n  DONE\n}";
    expect(lineNumberGutterText(countCodeLines(code)).split("\n")).toHaveLength(
      code.split("\n").length,
    );
  });
});
