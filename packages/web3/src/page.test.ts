import { describe, expect, it } from "vite-plus/test";

import { EMPTY_PAGE_VIEW, pageEventsBetween, pageViewFor } from "./page.ts";
import type { Web3PageState } from "./schema.ts";

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const OTHER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const state = (patch: Partial<Web3PageState> = {}): Web3PageState => ({
  enabled: true,
  uuid: "wallet-uuid",
  chainId: "0x7a69",
  accounts: [ACCOUNT, OTHER],
  connectedOrigins: ["http://localhost:5173"],
  ...patch,
});

describe("pageViewFor", () => {
  it("shows accounts only to an origin with a grant", () => {
    expect(pageViewFor(state(), "http://localhost:5173")).toEqual({
      enabled: true,
      chainId: "0x7a69",
      accounts: [ACCOUNT, OTHER],
    });
    expect(pageViewFor(state(), "https://other.example.test").accounts).toEqual([]);
  });

  it("shows nothing while the wallet is off", () => {
    expect(pageViewFor(state({ enabled: false }), "http://localhost:5173")).toEqual(
      EMPTY_PAGE_VIEW,
    );
  });
});

describe("pageEventsBetween", () => {
  const granted = pageViewFor(state(), "http://localhost:5173");

  it("connects a page when the wallet turns on, with the accounts it may see", () => {
    expect(pageEventsBetween(EMPTY_PAGE_VIEW, granted)).toEqual([
      { event: "connect", payload: { chainId: "0x7a69" } },
      { event: "accountsChanged", payload: [ACCOUNT, OTHER] },
    ]);
  });

  it("reports a chain switch and an account reorder", () => {
    expect(
      pageEventsBetween(granted, { ...granted, chainId: "0x1", accounts: [OTHER, ACCOUNT] }),
    ).toEqual([
      { event: "chainChanged", payload: "0x1" },
      { event: "accountsChanged", payload: [OTHER, ACCOUNT] },
    ]);
  });

  it("reports a revoked grant as no accounts", () => {
    expect(pageEventsBetween(granted, { ...granted, accounts: [] })).toEqual([
      { event: "accountsChanged", payload: [] },
    ]);
  });

  it("disconnects a page when the wallet turns off", () => {
    expect(pageEventsBetween(granted, EMPTY_PAGE_VIEW)).toEqual([
      { event: "disconnect", payload: { code: 4900, message: "The preview wallet is off." } },
    ]);
  });

  it("says nothing when nothing the page sees changed", () => {
    expect(pageEventsBetween(granted, { ...granted, accounts: [ACCOUNT, OTHER] })).toEqual([]);
    expect(pageEventsBetween(EMPTY_PAGE_VIEW, EMPTY_PAGE_VIEW)).toEqual([]);
  });
});
