/**
 * An image dropped into a GitHub issue or pull request is written into the body as a link to
 * `github.com/user-attachments/assets/…`, which answers only a request carrying the viewer's
 * GitHub credential. A browser never has one: session cookies are `SameSite=Lax`, so they are
 * not sent with an `<img>` subresource, and a private repository's screenshots come back 404.
 *
 * Recognising the shape is what lets a client hand the URL back to its environment, which does
 * hold a GitHub login, instead of pointing an `<img>` at it and rendering a broken tile.
 */
const GITHUB_ATTACHMENT_URL_PATTERN =
  /^https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]{1,128}$/u;

/** The URL when it is an attachment an environment can fetch on the viewer's behalf, else null. */
export function parseSourceControlAttachmentUrl(value: string): string | null {
  const trimmed = value.trim();
  return GITHUB_ATTACHMENT_URL_PATTERN.test(trimmed) ? trimmed : null;
}
