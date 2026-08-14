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
