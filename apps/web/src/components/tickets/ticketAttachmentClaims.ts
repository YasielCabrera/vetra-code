import type { Editor } from "@tiptap/core";

import {
  attachmentReferenceIds,
  replaceClaimedAttachmentReferences,
} from "../../lib/attachmentReferences";

/** Recognizes a controlled value update that only replaces pending attachment references. */
export function claimedAttachmentChanges(before: string, after: string): TicketClaimedAttachment[] {
  const beforeIds = attachmentReferenceIds(before);
  const afterIds = attachmentReferenceIds(after);
  if (beforeIds.length !== afterIds.length) return [];
  const claimed = beforeIds.flatMap((pendingId, index) => {
    const attachmentId = afterIds[index];
    return pendingId.startsWith("pending-") &&
      attachmentId !== undefined &&
      attachmentId !== pendingId &&
      !attachmentId.startsWith("pending-")
      ? [{ pendingId, attachmentId }]
      : [];
  });
  return replaceClaimedAttachmentReferences(before, claimed) === after ? claimed : [];
}

/** Rewrite attributes in place so claiming a paste never becomes an undoable document edit. */
export function synchronizeAttachmentClaims(
  editor: Editor,
  claimed: ReadonlyArray<TicketClaimedAttachment>,
) {
  if (claimed.length === 0) return;
  const transaction = editor.state.tr;
  editor.state.doc.descendants((node, position) => {
    const src: unknown = node.attrs.src;
    if (node.type.name === "image" && typeof src === "string") {
      const canonical = replaceClaimedAttachmentReferences(src, claimed);
      if (canonical !== src) transaction.setNodeAttribute(position, "src", canonical);
    }
    for (const mark of node.marks) {
      const href: unknown = mark.attrs.href;
      if (mark.type.name !== "link" || typeof href !== "string") continue;
      const canonical = replaceClaimedAttachmentReferences(href, claimed);
      if (canonical === href) continue;
      transaction.removeMark(position, position + node.nodeSize, mark);
      transaction.addMark(
        position,
        position + node.nodeSize,
        mark.type.create({ ...mark.attrs, href: canonical }),
      );
    }
  });
  if (transaction.docChanged) {
    editor.view.dispatch(transaction.setMeta("addToHistory", false).setMeta("preventUpdate", true));
  }
}
import type { TicketClaimedAttachment } from "@t3tools/contracts";
