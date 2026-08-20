import { describe, expect, it } from "vite-plus/test";

import { normalizeIssueExternalUrl } from "./issueExternalUrl";

describe("normalizeIssueExternalUrl", () => {
  it("keeps HTTPS issue links", () => {
    expect(normalizeIssueExternalUrl("https://github.com/acme/web/issues/7")).toBe(
      "https://github.com/acme/web/issues/7",
    );
  });

  it("rejects executable, insecure, credential-bearing, and malformed links", () => {
    expect(normalizeIssueExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeIssueExternalUrl("http://github.com/acme/web/issues/7")).toBeNull();
    expect(
      normalizeIssueExternalUrl("https://user:secret@github.com/acme/web/issues/7"),
    ).toBeNull();
    expect(normalizeIssueExternalUrl("not a url")).toBeNull();
  });
});
