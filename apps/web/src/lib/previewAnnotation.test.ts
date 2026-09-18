import type { PreviewAnnotationPayload } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { capturePreviewAnnotationScreenshot } from "./previewAnnotation";

const screenshot = (dataUrl: string) => ({
  dataUrl,
  width: 100,
  height: 80,
  cropRect: { x: 10, y: 20, width: 100, height: 80 },
});

const annotation: PreviewAnnotationPayload = {
  id: "annotation_1",
  pageUrl: "http://localhost:3000",
  pageTitle: "Example",
  comment: "Make these cards feel related.",
  elements: [],
  regions: [{ id: "region_1", rect: { x: 10, y: 20, width: 100, height: 80 } }],
  strokes: [
    {
      id: "stroke_1",
      color: "#7c3aed",
      width: 4,
      points: [
        { x: 10, y: 10 },
        { x: 20, y: 20 },
      ],
      bounds: { x: 6, y: 6, width: 18, height: 18 },
    },
  ],
  styleChanges: [
    {
      targetId: "element_1",
      selector: ".card",
      property: "border-radius",
      previousValue: "4px",
      value: "16px",
    },
  ],
  screenshot: screenshot("data:image/png;base64,c2NyZWVuc2hvdA=="),
  createdAt: "2026-06-11T00:00:00.000Z",
};

const withDataUrl = (dataUrl: string): PreviewAnnotationPayload => ({
  ...annotation,
  screenshot: screenshot(dataUrl),
});

describe("preview annotation capture", () => {
  // The desktop CSP refuses `fetch` on a `data:` URL, so the crop has to be
  // decoded in-process. A regression here silently drops every screenshot.
  it("decodes the crop into an attachable file", async () => {
    const capture = capturePreviewAnnotationScreenshot(annotation);
    expect(capture.status).toBe("captured");
    if (capture.status !== "captured") return;
    expect(capture.file.name).toBe("preview-annotation-annotation_1.png");
    expect(capture.file.type).toBe("image/png");
    expect(await capture.file.text()).toBe("screenshot");
  });

  it("reports none when the annotation carries no crop", () => {
    expect(capturePreviewAnnotationScreenshot({ ...annotation, screenshot: null })).toEqual({
      status: "none",
    });
  });

  it("fails on an unreadable crop instead of attaching an empty file", () => {
    expect(capturePreviewAnnotationScreenshot(withDataUrl("data:image/png;base64,%%%%"))).toEqual({
      status: "failed",
    });
    expect(capturePreviewAnnotationScreenshot(withDataUrl("data:image/png;base64,"))).toEqual({
      status: "failed",
    });
    expect(capturePreviewAnnotationScreenshot(withDataUrl("blob:nope"))).toEqual({
      status: "failed",
    });
  });
});
