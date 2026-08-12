import type { Web3WalletStatus } from "@vetra-code/web3/schema";
import { describe, expect, it } from "vite-plus/test";

import {
  APPROVAL_MODE_OPTIONS,
  describeWalletChain,
  formatWalletChip,
  parseChainIdInput,
  parseRpcUrlInput,
  shortenAddress,
} from "./web3Settings.logic";

const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

const status = (overrides: Partial<Web3WalletStatus> = {}): Web3WalletStatus => ({
  enabled: true,
  accounts: [],
  selectedAddress: ADDRESS,
  chain: {
    chainId: 31337,
    name: "Anvil / Hardhat",
    rpcUrl: "http://127.0.0.1:8545",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  },
  rpcReachable: true,
  approvalMode: "auto-for-agents",
  pendingRequests: [],
  connectedOrigins: [],
  ...overrides,
});

describe("APPROVAL_MODE_OPTIONS", () => {
  it("covers every approval mode so the select cannot show a raw value", () => {
    expect(APPROVAL_MODE_OPTIONS.map((option) => option.value)).toEqual([
      "auto-for-agents",
      "always-ask",
      "always-auto",
    ]);
  });
});

describe("shortenAddress", () => {
  it("keeps the ends, which is what makes an address recognisable", () => {
    expect(shortenAddress(ADDRESS)).toBe("0xf39F…2266");
  });

  it("leaves short values alone", () => {
    expect(shortenAddress("0x1234")).toBe("0x1234");
  });
});

describe("parseChainIdInput", () => {
  it("treats empty as clearing the override", () => {
    expect(parseChainIdInput("")).toEqual({ valid: true, value: null });
    expect(parseChainIdInput("   ")).toEqual({ valid: true, value: null });
  });

  it("accepts a positive decimal chain id", () => {
    expect(parseChainIdInput("31337")).toEqual({ valid: true, value: 31337 });
    expect(parseChainIdInput(" 1 ")).toEqual({ valid: true, value: 1 });
  });

  it("rejects values that cannot be a chain id, so a typo does not get persisted", () => {
    expect(parseChainIdInput("0").valid).toBe(false);
    expect(parseChainIdInput("-1").valid).toBe(false);
    expect(parseChainIdInput("0x7a69").valid).toBe(false);
    expect(parseChainIdInput("1.5").valid).toBe(false);
    expect(parseChainIdInput("nonsense").valid).toBe(false);
    expect(parseChainIdInput("99999999999999999999").valid).toBe(false);
  });
});

describe("parseRpcUrlInput", () => {
  it("treats empty as clearing the override", () => {
    expect(parseRpcUrlInput("")).toEqual({ valid: true, value: null });
  });

  it("accepts http and https endpoints", () => {
    expect(parseRpcUrlInput("http://127.0.0.1:8545")).toEqual({
      valid: true,
      value: "http://127.0.0.1:8545",
    });
    expect(parseRpcUrlInput(" https://rpc.example.test/v1 ")).toEqual({
      valid: true,
      value: "https://rpc.example.test/v1",
    });
  });

  it("rejects schemes the wallet cannot speak", () => {
    // The wallet does HTTP JSON-RPC; a ws:// endpoint would silently never work.
    expect(parseRpcUrlInput("ws://127.0.0.1:8545").valid).toBe(false);
    expect(parseRpcUrlInput("127.0.0.1:8545").valid).toBe(false);
    expect(parseRpcUrlInput("not a url").valid).toBe(false);
  });

  it("rejects an over-long value rather than persisting it", () => {
    expect(parseRpcUrlInput(`https://example.test/${"a".repeat(2100)}`).valid).toBe(false);
  });
});

describe("describeWalletChain", () => {
  it("says nothing before status has loaded", () => {
    expect(describeWalletChain(null)).toBe("");
  });

  it("reports the chain and endpoint when reachable", () => {
    expect(describeWalletChain(status())).toBe(
      "Currently on Anvil / Hardhat (31337) via http://127.0.0.1:8545.",
    );
  });

  it("calls out an unreachable endpoint, the most confusing failure here", () => {
    const summary = describeWalletChain(status({ rpcReachable: false }));
    expect(summary).toContain("did not answer");
    expect(summary).toContain("will fail");
  });

  it("explains how to resolve a chain when none is set", () => {
    const summary = describeWalletChain(status({ chain: null }));
    expect(summary).toContain("start a local node");
  });

  it("says the wallet is off when it is off", () => {
    expect(describeWalletChain(status({ enabled: false }))).toBe("The wallet is off.");
  });
});

describe("formatWalletChip", () => {
  it("renders nothing when there is no wallet to show", () => {
    expect(formatWalletChip(null)).toBeNull();
    expect(formatWalletChip(status({ enabled: false }))).toBeNull();
  });

  it("pairs the network with the active account", () => {
    expect(formatWalletChip(status())).toBe("Anvil / Hardhat · 0xf39F…2266");
  });

  it("is explicit about missing pieces rather than rendering blanks", () => {
    expect(formatWalletChip(status({ chain: null, selectedAddress: null }))).toBe(
      "No network · No account",
    );
  });
});
