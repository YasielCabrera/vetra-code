import { getViewportForBounds, type Rect, type Viewport } from "@xyflow/react";

export const SCHEMA_DIAGRAM_PNG_LIMITS = {
  padding: 64,
  maxDimension: 8_192,
  maxPixels: 16_000_000,
  maxPixelRatio: 2,
} as const;

export interface SchemaDiagramPngPlan {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
  readonly viewport: Viewport;
}

export function buildSchemaDiagramPngPlan(bounds: Rect): SchemaDiagramPngPlan {
  const naturalWidth = Math.max(1, bounds.width + SCHEMA_DIAGRAM_PNG_LIMITS.padding * 2);
  const naturalHeight = Math.max(1, bounds.height + SCHEMA_DIAGRAM_PNG_LIMITS.padding * 2);
  const scale = Math.min(
    1,
    SCHEMA_DIAGRAM_PNG_LIMITS.maxDimension / naturalWidth,
    SCHEMA_DIAGRAM_PNG_LIMITS.maxDimension / naturalHeight,
    Math.sqrt(SCHEMA_DIAGRAM_PNG_LIMITS.maxPixels / (naturalWidth * naturalHeight)),
  );
  const width = Math.max(1, Math.floor(naturalWidth * scale));
  const height = Math.max(1, Math.floor(naturalHeight * scale));
  const pixelRatio = Math.max(
    1,
    Math.min(
      SCHEMA_DIAGRAM_PNG_LIMITS.maxPixelRatio,
      SCHEMA_DIAGRAM_PNG_LIMITS.maxDimension / width,
      SCHEMA_DIAGRAM_PNG_LIMITS.maxDimension / height,
      Math.sqrt(SCHEMA_DIAGRAM_PNG_LIMITS.maxPixels / (width * height)),
    ),
  );
  const padding = SCHEMA_DIAGRAM_PNG_LIMITS.padding * scale;
  const paddingInPixels: `${number}px` = `${padding}px`;

  return {
    width,
    height,
    pixelRatio,
    viewport: getViewportForBounds(bounds, width, height, 0.001, 1, {
      x: paddingInPixels,
      y: paddingInPixels,
    }),
  };
}

export function schemaDiagramPngFilename(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "graphql"}-schema.png`;
}

export async function renderSchemaDiagramPng({
  viewportElement,
  bounds,
  backgroundColor,
}: {
  viewportElement: HTMLElement;
  bounds: Rect;
  backgroundColor: string;
}): Promise<Blob> {
  const imageModule = import("html-to-image");
  const plan = buildSchemaDiagramPngPlan(bounds);
  const { toBlob } = await imageModule;
  const blob = await toBlob(viewportElement, {
    backgroundColor,
    width: plan.width,
    height: plan.height,
    pixelRatio: plan.pixelRatio,
    style: {
      width: `${plan.width}px`,
      height: `${plan.height}px`,
      transform: `translate(${plan.viewport.x}px, ${plan.viewport.y}px) scale(${plan.viewport.zoom})`,
      transformOrigin: "0 0",
    },
  });
  if (blob === null) {
    throw new Error("The browser could not create the diagram image.");
  }
  return blob;
}

export async function downloadSchemaDiagramPng({
  image,
  filename,
}: {
  image: Promise<Blob>;
  filename: string;
}): Promise<void> {
  const blob = await image;
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.download = filename;
  anchor.href = objectUrl;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

export function copySchemaDiagramPng(renderImage: () => Promise<Blob>): Promise<void> {
  if (
    typeof navigator === "undefined" ||
    navigator.clipboard?.write === undefined ||
    typeof ClipboardItem === "undefined"
  ) {
    return Promise.reject(
      new Error("Copying images requires clipboard access from a secure browser connection."),
    );
  }

  try {
    // Pass the pending render directly so clipboard.write runs during the
    // menu click's user activation, including in browsers with stricter rules.
    const image = renderImage();
    const clipboardItem = new ClipboardItem(
      { "image/png": image },
      { presentationStyle: "inline" },
    );
    return navigator.clipboard.write([clipboardItem]);
  } catch (error) {
    return Promise.reject(error);
  }
}
