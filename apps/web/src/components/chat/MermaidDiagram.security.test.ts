// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";

import { renderMermaid } from "./MermaidDiagram";

describe("renderMermaid with Mermaid itself", () => {
  it.each([
    ["an init directive's themeCSS", `%%{init: {"themeCSS": "@keyframes spin{to{opacity:0}}"}}%%`],
    [
      "a frontmatter fontFamily",
      `---\nconfig:\n  fontFamily: "x; @keyframes spin{to{opacity:0}}"\n---`,
    ],
  ])("keeps %s out of the page's styles", async (_name, config) => {
    const result = await renderMermaid(`${config}\npie\n"a": 1`, "light");

    if (result.status === "error") throw new Error(result.message);
    expect(result.svg).toContain('aria-roledescription="pie"');
    expect(result.svg).not.toContain("@keyframes spin");
  });
});
