import { describe, expect, it } from "@effect/vitest";

import type { Web3CustomNetwork } from "./schema.ts";
import {
  DEFAULT_PUBLIC_CHAIN_ID,
  DEFAULT_WEB3_NETWORKS,
  enabledBuiltInNetworks,
  findCustomNetwork,
  isBuiltInChainId,
  isBuiltInNetworkEnabled,
  nativeCurrencyFromSymbol,
  nextChainSelectionAfterCatalogChange,
  nextChainSelectionAfterCustomNetworkEdit,
  replaceCustomNetwork,
  setBuiltInNetworkEnabled,
} from "./networks.ts";

const ANVIL: Web3CustomNetwork = {
  chainId: 31337,
  name: "Anvil",
  rpcUrl: "http://127.0.0.1:8545",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
};

describe("built-in network enablement", () => {
  it("treats every bundled network as enabled when the disabled list is empty", () => {
    expect(enabledBuiltInNetworks([])).toEqual(DEFAULT_WEB3_NETWORKS);
    expect(isBuiltInNetworkEnabled(DEFAULT_PUBLIC_CHAIN_ID, [])).toBe(true);
  });

  it("hides only the chain ids that were turned off", () => {
    expect(isBuiltInNetworkEnabled(8453, [8453])).toBe(false);
    expect(enabledBuiltInNetworks([8453]).map((network) => network.chainId)).not.toContain(8453);
    expect(enabledBuiltInNetworks([8453]).map((network) => network.chainId)).toContain(1);
  });

  it("does not treat a custom or local chain id as a built-in", () => {
    expect(isBuiltInChainId(31337)).toBe(false);
    expect(isBuiltInNetworkEnabled(31337, [])).toBe(false);
  });

  it("records a disable in catalog order and ignores unknown ids", () => {
    expect(
      setBuiltInNetworkEnabled({ chainId: 8453, enabled: false, disabledBuiltInChainIds: [1] }),
    ).toEqual([1, 8453]);
    expect(
      setBuiltInNetworkEnabled({
        chainId: 31337,
        enabled: false,
        disabledBuiltInChainIds: [1],
      }),
    ).toEqual([1]);
  });

  it("re-enabling a built-in drops it from the disabled list", () => {
    expect(
      setBuiltInNetworkEnabled({
        chainId: 1,
        enabled: true,
        disabledBuiltInChainIds: [1, 8453],
      }),
    ).toEqual([8453]);
  });
});

describe("nextChainSelectionAfterCatalogChange", () => {
  it("leaves a different active chain alone", () => {
    expect(
      nextChainSelectionAfterCatalogChange({
        chainId: 8453,
        rpcUrl: null,
        removedOrDisabledChainId: 1,
        disabledBuiltInChainIds: [1],
        customNetworks: [],
      }),
    ).toEqual({ chainId: 8453, rpcUrl: null });
  });

  it("falls back to Mainnet when the active built-in is hidden and Mainnet is still on", () => {
    expect(
      nextChainSelectionAfterCatalogChange({
        chainId: 8453,
        rpcUrl: null,
        removedOrDisabledChainId: 8453,
        disabledBuiltInChainIds: [8453],
        customNetworks: [],
      }),
    ).toEqual({ chainId: 1, rpcUrl: null });
  });

  it("falls back to the first custom network when every built-in is off", () => {
    expect(
      nextChainSelectionAfterCatalogChange({
        chainId: 1,
        rpcUrl: null,
        removedOrDisabledChainId: 1,
        disabledBuiltInChainIds: DEFAULT_WEB3_NETWORKS.map((network) => network.chainId),
        customNetworks: [ANVIL],
      }),
    ).toEqual({ chainId: 31337, rpcUrl: ANVIL.rpcUrl });
  });

  it("clears the pin when nothing listed remains", () => {
    expect(
      nextChainSelectionAfterCatalogChange({
        chainId: 31337,
        rpcUrl: ANVIL.rpcUrl,
        removedOrDisabledChainId: 31337,
        disabledBuiltInChainIds: DEFAULT_WEB3_NETWORKS.map((network) => network.chainId),
        customNetworks: [],
      }),
    ).toEqual({ chainId: null, rpcUrl: null });
  });
});

describe("custom network helpers", () => {
  it("finds a custom network by chain id", () => {
    expect(findCustomNetwork([ANVIL], 31337)).toEqual(ANVIL);
    expect(findCustomNetwork([ANVIL], 1)).toBeNull();
  });

  it("defaults an empty or ETH symbol to Ether", () => {
    expect(nativeCurrencyFromSymbol("")).toEqual({ name: "Ether", symbol: "ETH", decimals: 18 });
    expect(nativeCurrencyFromSymbol("eth")).toEqual({ name: "Ether", symbol: "ETH", decimals: 18 });
    expect(nativeCurrencyFromSymbol("POL")).toEqual({ name: "POL", symbol: "POL", decimals: 18 });
  });

  it("replaces a custom network in place, including a chain-id change", () => {
    const next = { ...ANVIL, chainId: 31338, name: "Anvil 2" };
    expect(replaceCustomNetwork([ANVIL], 31337, next)).toEqual([next]);
  });

  it("keeps the wallet on an edited custom network when that chain was pinned", () => {
    const next = { ...ANVIL, rpcUrl: "http://127.0.0.1:8546" };
    expect(
      nextChainSelectionAfterCustomNetworkEdit({
        chainId: 31337,
        rpcUrl: ANVIL.rpcUrl,
        previousChainId: 31337,
        next,
      }),
    ).toEqual({ chainId: 31337, rpcUrl: next.rpcUrl });
  });

  it("leaves a different pin alone when some other custom network is edited", () => {
    expect(
      nextChainSelectionAfterCustomNetworkEdit({
        chainId: 1,
        rpcUrl: null,
        previousChainId: 31337,
        next: { ...ANVIL, name: "Local" },
      }),
    ).toEqual({ chainId: 1, rpcUrl: null });
  });
});
