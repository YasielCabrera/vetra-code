import type { PreviewAnnotationPayload } from "@vetra-code/contracts";

interface DecodedDataUrl {
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly mimeType: string;
}

/**
 * Reads a `data:` URL without `fetch`. The desktop renderer runs under a CSP
 * whose `connect-src` lists no `data:` source, so fetching the crop URL is
 * refused outright — every picked element lost its screenshot that way. The
 * payload is already in memory, so decode it here instead of asking the
 * network stack for something it is not allowed to hand back.
 */
function decodeDataUrl(dataUrl: string): DecodedDataUrl | null {
  if (!dataUrl.startsWith("data:")) return null;
  const separator = dataUrl.indexOf(",");
  if (separator < 0) return null;
  const header = dataUrl.slice("data:".length, separator);
  const payload = dataUrl.slice(separator + 1);
  const isBase64 = header.endsWith(";base64");
  const mimeType = header.split(";")[0] || "image/png";
  if (!isBase64) {
    return { bytes: new TextEncoder().encode(decodeURIComponent(payload)), mimeType };
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return { bytes, mimeType };
}

export type PreviewAnnotationCapture =
  /** The crop is ready to attach. */
  | { readonly status: "captured"; readonly file: File }
  /** The pick carried no crop, which is normal for comment-only annotations. */
  | { readonly status: "none" }
  /** The crop was unreadable. Send the annotation without it. */
  | { readonly status: "failed" };

/**
 * Turns a picked element's crop into a composer attachment. Decoding is local
 * and synchronous, so the picker never holds the composer waiting on it.
 */
export function capturePreviewAnnotationScreenshot(
  annotation: PreviewAnnotationPayload,
): PreviewAnnotationCapture {
  if (!annotation.screenshot) return { status: "none" };
  let decoded: DecodedDataUrl | null;
  try {
    decoded = decodeDataUrl(annotation.screenshot.dataUrl);
  } catch {
    // `atob` throws on a truncated or non-base64 payload.
    return { status: "failed" };
  }
  if (!decoded || decoded.bytes.length === 0) return { status: "failed" };
  const file = new File([decoded.bytes], `preview-annotation-${annotation.id}.png`, {
    type: decoded.mimeType,
  });
  return { status: "captured", file };
}
