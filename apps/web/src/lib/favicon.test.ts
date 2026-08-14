import { describe, expect, it } from "vite-plus/test";

import { faviconUrlForOrigin, publicFaviconUrlForOrigin } from "./favicon";

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

describe("publicFaviconUrlForOrigin", () => {
  it("never sends private origin hostnames to the public provider", () => {
    for (const url of [
      "http://localhost:3000/",
      "http://127.0.0.1:3000/",
      "http://0.0.0.0:3000/",
      "http://devbox:3000/",
      "https://24x.xf.local/",
      "http://printer.home.arpa/",
      "http://192.168.1.20:3000/",
      "http://[::]/",
      "http://[::ffff:192.168.1.20]/",
      "http://100.65.180.100:3000/",
      "https://devbox.example.ts.net/",
      "http://192.0.2.1/",
      "http://198.51.100.1/",
      "http://203.0.113.1/",
      "http://224.0.0.1/",
      "http://240.0.0.1/",
      "http://[2001:db8::1]/",
      "http://[ff02::1]/",
      "http://app.test../",
      "https://24x.xf.local../",
      "http://printer.home.arpa../",
      "https://devbox.example.ts.net../",
      "http://127.0.0.1../",
      "http://127.1../",
      "http://10.1../",
      "http://172.16.1../",
      "http://192.168.1../",
    ]) {
      expect(publicFaviconUrlForOrigin(url)).toBeNull();
    }
    expect(publicFaviconUrlForOrigin("https://example.com/path", 32)).toBe(
      "https://www.google.com/s2/favicons?domain=example.com&sz=32",
    );
  });
});
