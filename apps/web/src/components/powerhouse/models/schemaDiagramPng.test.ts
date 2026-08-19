import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildSchemaDiagramPngPlan,
  copySchemaDiagramPng,
  SCHEMA_DIAGRAM_PNG_LIMITS,
  schemaDiagramPngFilename,
} from "./schemaDiagramPng";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildSchemaDiagramPngPlan", () => {
  it("keeps a small graph at readable scale with a high-density output", () => {
    const plan = buildSchemaDiagramPngPlan({ x: 100, y: 200, width: 1_000, height: 500 });

    expect(plan).toMatchObject({ width: 1_128, height: 628, pixelRatio: 2 });
    expect(plan.viewport).toEqual({ x: -36, y: -136, zoom: 1 });
  });

  it("bounds very large exports by dimension and pixel area", () => {
    const plan = buildSchemaDiagramPngPlan({ x: 0, y: 0, width: 20_000, height: 10_000 });
    const outputPixels = plan.width * plan.height * plan.pixelRatio ** 2;

    expect(plan.width).toBeLessThanOrEqual(SCHEMA_DIAGRAM_PNG_LIMITS.maxDimension);
    expect(plan.height).toBeLessThanOrEqual(SCHEMA_DIAGRAM_PNG_LIMITS.maxDimension);
    expect(outputPixels).toBeLessThanOrEqual(SCHEMA_DIAGRAM_PNG_LIMITS.maxPixels);
    expect(plan.viewport.zoom).toBeLessThan(1);
  });
});

describe("schemaDiagramPngFilename", () => {
  it("creates a portable schema filename", () => {
    expect(schemaDiagramPngFilename("Global state")).toBe("global-state-schema.png");
    expect(schemaDiagramPngFilename("  État / local  ")).toBe("etat-local-schema.png");
    expect(schemaDiagramPngFilename("---")).toBe("graphql-schema.png");
  });
});

describe("copySchemaDiagramPng", () => {
  it("starts the clipboard write with the pending PNG render", async () => {
    class ClipboardItemMock {
      constructor(
        readonly items: Record<string, string | Blob | PromiseLike<string | Blob>>,
        readonly options?: ClipboardItemOptions,
      ) {}
    }
    const write = vi.fn((_items: ClipboardItem[]) => Promise.resolve());
    vi.stubGlobal("ClipboardItem", ClipboardItemMock);
    vi.stubGlobal("navigator", { clipboard: { write } });

    let resolveImage: ((blob: Blob) => void) | undefined;
    const image = new Promise<Blob>((resolve) => {
      resolveImage = resolve;
    });
    const operation = copySchemaDiagramPng(() => image);

    expect(write).toHaveBeenCalledTimes(1);
    const clipboardItem = write.mock.calls[0]?.[0][0] as unknown as ClipboardItemMock;
    expect(clipboardItem.items["image/png"]).toBe(image);
    expect(clipboardItem.options).toEqual({ presentationStyle: "inline" });

    resolveImage?.(new Blob(["png"], { type: "image/png" }));
    await operation;
  });

  it("explains when image clipboard access is unavailable", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    vi.stubGlobal("navigator", { clipboard: {} });
    const renderImage = vi.fn(() => Promise.resolve(new Blob()));

    await expect(copySchemaDiagramPng(renderImage)).rejects.toThrow("secure browser connection");
    expect(renderImage).not.toHaveBeenCalled();
  });
});
