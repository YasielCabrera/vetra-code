/**
 * Issue links cross from an environment response into the local browser or desktop shell. Keep
 * that boundary HTTPS-only even when the connected environment is older or untrusted.
 */
export function normalizeIssueExternalUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}
