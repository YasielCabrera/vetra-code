import { faviconUrlForOrigin as publicProviderFaviconUrl } from "@t3tools/shared/favicon";

/** Resolve the conventional root favicon for an HTTP(S) page URL. */
export function faviconUrlForOrigin(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (!url.host) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.username = "";
    url.password = "";
    url.pathname = "/favicon.ico";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/** Resolve a privacy-safe public favicon provider URL for a page origin. */
export function publicFaviconUrlForOrigin(
  rawUrl: string | null | undefined,
  size = 32,
): string | null {
  return publicProviderFaviconUrl(rawUrl, size);
}
