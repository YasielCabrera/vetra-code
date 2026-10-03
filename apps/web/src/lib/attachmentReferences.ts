const ATTACHMENT_REFERENCE_PREFIX = "vetra-attachment://";
const ATTACHMENT_REFERENCE_PATTERN = /vetra-attachment:\/\/([^\s)"'<>]+)/g;

export function parseAttachmentReferenceHref(href: string): string | null {
  if (!href.startsWith(ATTACHMENT_REFERENCE_PREFIX)) return null;
  const attachmentId = href.slice(ATTACHMENT_REFERENCE_PREFIX.length);
  return attachmentId.length > 0 ? attachmentId : null;
}

/** An image or video embeds inline; anything else is a link that renders as a file chip. */
export function attachmentReferenceMarkdown(input: {
  readonly attachmentId: string;
  readonly name: string;
  readonly embed: boolean;
}): string {
  const label = input.name.replaceAll(/[[\]\\]/g, (character) => `\\${character}`);
  return `${input.embed ? "!" : ""}[${label}](${ATTACHMENT_REFERENCE_PREFIX}${input.attachmentId})`;
}

/** Every attachment id the text references, in order of first appearance. */
export function attachmentReferenceIds(text: string): ReadonlyArray<string> {
  return [
    ...new Set(Array.from(text.matchAll(ATTACHMENT_REFERENCE_PATTERN), (match) => match[1]!)),
  ];
}

export function replaceClaimedAttachmentReferences(
  text: string,
  claimed: ReadonlyArray<{ readonly pendingId: string; readonly attachmentId: string }>,
): string {
  if (claimed.length === 0) return text;
  const attachmentIdByPendingId = new Map(
    claimed.map((claim) => [claim.pendingId, claim.attachmentId]),
  );
  return text.replaceAll(
    ATTACHMENT_REFERENCE_PATTERN,
    (_reference, id: string) =>
      `${ATTACHMENT_REFERENCE_PREFIX}${attachmentIdByPendingId.get(id) ?? id}`,
  );
}
