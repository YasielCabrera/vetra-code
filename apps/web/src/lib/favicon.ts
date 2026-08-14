import { isPublicFaviconHost } from "~/browser/browserTargetResolver";

const FAVICON_PROVIDER = "https://www.google.com/s2/favicons";

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
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (!url.host) return null;
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!isPublicFaviconHost(url.hostname)) return null;
    return `${FAVICON_PROVIDER}?domain=${encodeURIComponent(url.host)}&sz=${size}`;
  } catch {
    return null;
  }
}
