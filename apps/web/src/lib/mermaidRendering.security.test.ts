// @vitest-environment jsdom

import { describe, expect, it } from "vite-plus/test";

import { renderMermaidDiagram } from "./mermaidRendering";

describe("renderMermaidDiagram with Mermaid itself", () => {
  it.each([
    ["an init directive's themeCSS", `%%{init: {"themeCSS": "@keyframes spin{to{opacity:0}}"}}%%`],
    [
      "a frontmatter fontFamily",
      `---\nconfig:\n  fontFamily: "x; @keyframes spin{to{opacity:0}}"\n---`,
    ],
  ])("keeps %s out of the page's styles", async (_name, config) => {
    const outcome = await renderMermaidDiagram(`${config}\npie\n"a": 1`, "light");

    if (outcome.kind === "error") throw new Error(outcome.message);
    expect(outcome.svg).toContain('aria-roledescription="pie"');
    expect(outcome.svg).not.toContain("@keyframes spin");
  });
});
