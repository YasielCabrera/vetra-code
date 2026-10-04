import { describe, expect, it, vi } from "vite-plus/test";

const fakeMermaid = vi.hoisted(() => {
  let theme: string | undefined;
  const renderCounts = new Map<string, number>();
  return {
    mermaidAPI: { defaultConfig: { secure: ["secure"] } },
    initialize(config: { theme?: string }) {
      theme = config.theme;
    },
    async render(_id: string, source: string) {
      // Real Mermaid reads its global config after an async gap, so an unserialized
      // second initialize() would leak into this render.
      await Promise.resolve();
      if (source.startsWith("broken")) throw new Error("Parse error on line 1");
      const count = (renderCounts.get(source) ?? 0) + 1;
      renderCounts.set(source, count);
      return { svg: `<svg data-theme="${theme}" data-render="${count}">${source}</svg>` };
    },
  };
});
vi.mock("mermaid", () => ({ default: fakeMermaid }));

import { MAX_CACHED_MERMAID_DIAGRAMS, renderMermaidDiagram } from "./mermaidRendering";

describe("renderMermaidDiagram", () => {
  it("renders a source once per theme", async () => {
    await renderMermaidDiagram("graph TD; A-->B", "light");

    expect(await renderMermaidDiagram("graph TD; A-->B", "light")).toEqual({
      kind: "diagram",
      svg: '<svg data-theme="default" data-render="1">graph TD; A-->B</svg>',
    });
    expect(await renderMermaidDiagram("graph TD; A-->B", "dark")).toEqual({
      kind: "diagram",
      svg: '<svg data-theme="dark" data-render="2">graph TD; A-->B</svg>',
    });
  });

  it("keeps each theme when renders overlap", async () => {
    const [light, dark] = await Promise.all([
      renderMermaidDiagram("graph LR; C-->D", "light"),
      renderMermaidDiagram("graph LR; E-->F", "dark"),
    ]);

    expect(light).toEqual({
      kind: "diagram",
      svg: '<svg data-theme="default" data-render="1">graph LR; C-->D</svg>',
    });
    expect(dark).toEqual({
      kind: "diagram",
      svg: '<svg data-theme="dark" data-render="1">graph LR; E-->F</svg>',
    });
  });

  it("reports a parse error and keeps rendering later diagrams", async () => {
    const [failed, next] = await Promise.all([
      renderMermaidDiagram("broken graph", "light"),
      renderMermaidDiagram("graph TD; G-->H", "light"),
    ]);

    expect(failed).toEqual({ kind: "error", message: "Parse error on line 1" });
    expect(next).toEqual({
      kind: "diagram",
      svg: '<svg data-theme="default" data-render="1">graph TD; G-->H</svg>',
    });
  });

  it("renders the least recently used diagram again once the cache is full", async () => {
    await renderMermaidDiagram("graph TD; evicted", "light");
    for (let index = 0; index < MAX_CACHED_MERMAID_DIAGRAMS; index += 1) {
      await renderMermaidDiagram(`graph TD; filler-${index}`, "light");
    }

    expect(await renderMermaidDiagram("graph TD; evicted", "light")).toEqual({
      kind: "diagram",
      svg: '<svg data-theme="default" data-render="2">graph TD; evicted</svg>',
    });
  });

  it("loads Mermaid again for a diagram whose chunk failed to load", async () => {
    let failNextImport = true;
    vi.resetModules();
    vi.doMock("mermaid", () => {
      if (!failNextImport) return { default: fakeMermaid };
      failNextImport = false;
      throw new Error("Failed to fetch dynamically imported module");
    });
    const fresh = await import("./mermaidRendering");

    expect(await fresh.renderMermaidDiagram("graph TD; I-->J", "light")).toMatchObject({
      kind: "error",
    });
    expect(await fresh.renderMermaidDiagram("graph TD; I-->J", "light")).toEqual({
      kind: "diagram",
      svg: '<svg data-theme="default" data-render="1">graph TD; I-->J</svg>',
    });
  });
});
