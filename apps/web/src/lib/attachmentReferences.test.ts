import { describe, expect, it } from "vite-plus/test";

import {
  attachmentReferenceIds,
  attachmentReferenceMarkdown,
  parseAttachmentReferenceHref,
  replaceClaimedAttachmentReferences,
} from "./attachmentReferences";

describe("attachment references", () => {
  it("writes embeds and links that parse back to their id", () => {
    expect(
      attachmentReferenceMarkdown({
        attachmentId: "pending-1.png",
        name: "shot [1].png",
        embed: true,
      }),
    ).toBe("![shot \\[1\\].png](vetra-attachment://pending-1.png)");
    expect(
      attachmentReferenceMarkdown({ attachmentId: "p-2.pdf", name: "spec.pdf", embed: false }),
    ).toBe("[spec.pdf](vetra-attachment://p-2.pdf)");
    expect(parseAttachmentReferenceHref("vetra-attachment://p-2.pdf")).toBe("p-2.pdf");
    expect(parseAttachmentReferenceHref("https://example.com/p-2.pdf")).toBeNull();
    expect(
      attachmentReferenceIds(
        "![a](vetra-attachment://x) [b](vetra-attachment://y) ![a](vetra-attachment://x)",
      ),
    ).toEqual(["x", "y"]);
  });

  it("points claimed pending references at the ticket's ids and leaves the rest alone", () => {
    const text =
      "Typed more\n![a](vetra-attachment://pending-a)\n[b](vetra-attachment://claimed-b)\n![a again](vetra-attachment://pending-a)";
    expect(
      replaceClaimedAttachmentReferences(text, [
        { pendingId: "pending-a", attachmentId: "ticket-1-a" },
        { pendingId: "pending-z", attachmentId: "ticket-1-z" },
      ]),
    ).toBe(
      "Typed more\n![a](vetra-attachment://ticket-1-a)\n[b](vetra-attachment://claimed-b)\n![a again](vetra-attachment://ticket-1-a)",
    );
    expect(replaceClaimedAttachmentReferences(text, [])).toBe(text);
  });
});
