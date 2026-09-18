import type { Web3WalletStatus } from "@t3tools/web3/schema";
import { describe, expect, it } from "vite-plus/test";

import {
  APPROVAL_MODE_OPTIONS,
  describeWalletChain,
  formatWalletChip,
  identiconPattern,
  networkSwatchClass,
  originHostname,
  parseChainIdInput,
  parseCustomNetworkDraft,
  parseRpcUrlInput,
  pendingRequestTitle,
  removeAccountConfirmationMessage,
  removeCustomNetworkConfirmationMessage,
  resolveAccountLabelCommit,
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

describe("removeAccountConfirmationMessage", () => {
  it("asks a question so the confirm dialog can split title from body", () => {
    expect(removeAccountConfirmationMessage({ label: "Preview account 4", address: ADDRESS })).toBe(
      "Remove Preview account 4?\n0xf39F…2266 will be dropped from this test wallet. You can add another account later.",
    );
  });
});

describe("resolveAccountLabelCommit", () => {
  it("commits a trimmed name that actually changed", () => {
    expect(
      resolveAccountLabelCommit({ label: "  Treasury  ", originalLabel: "Preview account 1" }),
    ).toEqual({
      action: "commit",
      label: "Treasury",
    });
  });

  it("rejects empty so the previous name stays", () => {
    expect(resolveAccountLabelCommit({ label: "   ", originalLabel: "Preview account 1" })).toEqual(
      {
        action: "reject-empty",
      },
    );
  });

  it("skips a no-op so we do not write the keystore for a click-and-blur", () => {
    expect(resolveAccountLabelCommit({ label: "Treasury", originalLabel: "Treasury" })).toEqual({
      action: "noop",
    });
  });

  it("rejects a name longer than the wallet will store", () => {
    expect(
      resolveAccountLabelCommit({
        label: "T".repeat(121),
        originalLabel: "Preview account 1",
      }),
    ).toEqual({ action: "reject-too-long" });
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

describe("parseCustomNetworkDraft", () => {
  const validDraft = {
    name: "Anvil",
    chainId: "31337",
    rpcUrl: "http://127.0.0.1:8545",
    currencySymbol: "ETH",
  };

  it("accepts a complete custom network", () => {
    expect(parseCustomNetworkDraft(validDraft, [])).toEqual({
      valid: true,
      network: {
        chainId: 31337,
        name: "Anvil",
        rpcUrl: "http://127.0.0.1:8545",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    });
  });

  it("rejects a built-in chain id so the user enables that row instead", () => {
    const parsed = parseCustomNetworkDraft({ ...validDraft, chainId: "1" }, []);
    expect(parsed.valid).toBe(false);
    if (!parsed.valid) expect(parsed.error).toContain("built-in");
  });

  it("rejects a duplicate custom chain id", () => {
    const parsed = parseCustomNetworkDraft(validDraft, [
      {
        chainId: 31337,
        name: "Existing",
        rpcUrl: "http://127.0.0.1:8545",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    ]);
    expect(parsed.valid).toBe(false);
    if (!parsed.valid) expect(parsed.error).toContain("already exists");
  });

  it("rejects an empty name or a non-http RPC", () => {
    expect(parseCustomNetworkDraft({ ...validDraft, name: "  " }, []).valid).toBe(false);
    expect(
      parseCustomNetworkDraft({ ...validDraft, rpcUrl: "ws://127.0.0.1:8545" }, []).valid,
    ).toBe(false);
  });

  it("allows keeping the same chain id when editing an existing custom network", () => {
    const existing = {
      chainId: 31337,
      name: "Anvil",
      rpcUrl: "http://127.0.0.1:8545",
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    };
    const parsed = parseCustomNetworkDraft(
      { ...validDraft, name: "Local Anvil" },
      [existing],
      31337,
    );
    expect(parsed).toEqual({
      valid: true,
      network: {
        chainId: 31337,
        name: "Local Anvil",
        rpcUrl: "http://127.0.0.1:8545",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    });
  });

  it("still rejects colliding with a different custom network while editing", () => {
    const parsed = parseCustomNetworkDraft(
      { ...validDraft, chainId: "4242" },
      [
        {
          chainId: 31337,
          name: "Anvil",
          rpcUrl: "http://127.0.0.1:8545",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
        {
          chainId: 4242,
          name: "Other",
          rpcUrl: "http://127.0.0.1:8546",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        },
      ],
      31337,
    );
    expect(parsed.valid).toBe(false);
    if (!parsed.valid) expect(parsed.error).toContain("already exists");
  });
});

describe("removeCustomNetworkConfirmationMessage", () => {
  it("asks a question so the confirm dialog can split title from body", () => {
    expect(removeCustomNetworkConfirmationMessage({ name: "Anvil", chainId: 31337 })).toBe(
      "Remove Anvil?\nChain 31337 will be dropped from this test wallet. You can add it again later.",
    );
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
    expect(summary).toContain("enable a built-in network");
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

describe("identiconPattern", () => {
  it("is stable for a given address, including checksum case", () => {
    const first = identiconPattern(ADDRESS);
    const second = identiconPattern(ADDRESS.toLowerCase());
    expect(first).toEqual(second);
    expect(first.hue).toBeGreaterThanOrEqual(0);
    expect(first.hue).toBeLessThan(360);
  });

  it("mirrors each row so the mark stays recognisable at small sizes", () => {
    const filled = new Set(identiconPattern(ADDRESS).cells.map((cell) => `${cell.x},${cell.y}`));
    for (const key of filled) {
      const [x, y] = key.split(",");
      expect(filled.has(`${4 - Number(x)},${y}`)).toBe(true);
    }
  });

  it("changes when the address changes", () => {
    expect(identiconPattern(ADDRESS)).not.toEqual(
      identiconPattern("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
    );
  });
});

describe("networkSwatchClass", () => {
  it("gives bundled networks a distinct color and a fallback for unknown chains", () => {
    expect(networkSwatchClass(1)).toBe("bg-indigo-500");
    expect(networkSwatchClass(8453)).toBe("bg-blue-600");
    expect(networkSwatchClass(31337)).toBe("bg-emerald-500");
    expect(networkSwatchClass(999999)).toBe("bg-muted-foreground");
  });
});

describe("pendingRequestTitle", () => {
  it("names the consequence rather than echoing the JSON-RPC method", () => {
    expect(pendingRequestTitle("eth_requestAccounts")).toBe("Connection request");
    expect(pendingRequestTitle("personal_sign")).toBe("Signature request");
    expect(pendingRequestTitle("eth_sendTransaction")).toBe("Transaction request");
    expect(pendingRequestTitle("wallet_switchEthereumChain")).toBe("Switch network");
  });

  it("falls back to the method name for anything unrecognised", () => {
    expect(pendingRequestTitle("anvil_setBalance")).toBe("anvil_setBalance");
  });
});

describe("originHostname", () => {
  it("strips the scheme so the origin badge stays short", () => {
    expect(originHostname("https://app.uniswap.org")).toBe("app.uniswap.org");
    expect(originHostname("http://127.0.0.1:3000")).toBe("127.0.0.1:3000");
  });

  it("returns the raw value when it is not a URL", () => {
    expect(originHostname("not a url")).toBe("not a url");
  });
});
