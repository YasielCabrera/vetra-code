import { describe, expect, it } from "vite-plus/test";

import { canAutoLoadNextPage, cursorPageKey } from "./powerhouseQuery";

describe("cursorPageKey", () => {
  it("keeps the initial page distinct from every reactor-issued cursor", () => {
    expect(cursorPageKey(null)).toBe("initial");
    expect(cursorPageKey("initial")).toBe("cursor:initial");
    expect(cursorPageKey("first")).toBe("cursor:first");
  });
});

describe("canAutoLoadNextPage", () => {
  const ready = { pending: false, error: null };

  it("pulls the next page once the current one has settled", () => {
    expect(canAutoLoadNextPage("cursor-2", ready)).toBe(true);
  });

  it("stops when the reactor has no further cursor", () => {
    expect(canAutoLoadNextPage(null, ready)).toBe(false);
  });

  it("does not queue the same cursor twice while a page is in flight", () => {
    expect(canAutoLoadNextPage("cursor-2", { pending: true, error: null })).toBe(false);
  });

  it("stops after a failure instead of hammering a reactor that refused", () => {
    expect(canAutoLoadNextPage("cursor-2", { pending: false, error: "boom" })).toBe(false);
  });
});
