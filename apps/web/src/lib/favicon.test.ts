import { describe, expect, it } from "vite-plus/test";

import { faviconUrlForOrigin } from "./favicon";

describe("faviconUrlForOrigin", () => {
  it("uses the HTTP origin root", () => {
    expect(faviconUrlForOrigin("http://localhost:5173/dashboard?mode=edit#preview")).toBe(
      "http://localhost:5173/favicon.ico",
    );
  });

  it("preserves HTTPS and non-default ports", () => {
    expect(faviconUrlForOrigin("https://example.test:8443/nested/page")).toBe(
      "https://example.test:8443/favicon.ico",
    );
  });

  it("removes credentials, paths, queries, and fragments", () => {
    expect(faviconUrlForOrigin("https://user:p%40ss@example.test/app?q=secret#details")).toBe(
      "https://example.test/favicon.ico",
    );
  });

  it("rejects malformed and unsupported URLs", () => {
    expect(faviconUrlForOrigin(null)).toBeNull();
    expect(faviconUrlForOrigin("not a url")).toBeNull();
    expect(faviconUrlForOrigin("ftp://example.test/app")).toBeNull();
    expect(faviconUrlForOrigin("about:blank")).toBeNull();
  });
});
