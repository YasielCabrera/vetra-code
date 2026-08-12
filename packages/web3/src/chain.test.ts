import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientError } from "effect/unstable/http";

import {
  DEFAULT_LOCAL_RPC_URL,
  describeChain,
  parseAddEthereumChain,
  probeChainId,
  resolveInitialChain,
  web3RpcRequest,
} from "./chain.ts";
import { makeJsonRpcClientLayer, type RecordedJsonRpcCall } from "./testJsonRpc.ts";

/** How a real refused connection arrives: a typed error in the error channel. */
const refusedLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.fail(
      new HttpClientError.HttpClientError({
        reason: new HttpClientError.TransportError({
          request,
          cause: new Error("connect ECONNREFUSED 127.0.0.1:8545"),
        }),
      }),
    ),
  ),
);

/** A transport that throws rather than failing — a bug, but survivable. */
const defectiveLayer = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.die(new Error("transport blew up"))),
);

describe("describeChain", () => {
  it("names well-known chains without inventing an RPC endpoint for them", () => {
    const mainnet = describeChain(1, null);
    expect(mainnet.name).toBe("Ethereum Mainnet");
    expect(mainnet.rpcUrl).toBeNull();
    expect(mainnet.nativeCurrency.symbol).toBe("ETH");

    expect(describeChain(31337, DEFAULT_LOCAL_RPC_URL).name).toBe("Anvil / Hardhat");
  });

  it("falls back to a generic name for unknown chains", () => {
    expect(describeChain(424242, null).name).toBe("Chain 424242");
  });
});

describe("parseAddEthereumChain", () => {
  it("adopts the chain id, name and first http endpoint the page supplies", () => {
    const chain = parseAddEthereumChain([
      {
        chainId: "0x7a69",
        chainName: "Local Anvil",
        rpcUrls: ["ws://127.0.0.1:8545", "http://127.0.0.1:8545"],
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      },
    ]);

    expect(chain).not.toBeNull();
    expect(chain?.chainId).toBe(31337);
    expect(chain?.name).toBe("Local Anvil");
    // The ws:// entry is skipped: the wallet speaks HTTP JSON-RPC.
    expect(chain?.rpcUrl).toBe("http://127.0.0.1:8545");
  });

  it("accepts a bare object as well as the spec's single-element array", () => {
    expect(parseAddEthereumChain({ chainId: "0x1" })?.chainId).toBe(1);
  });

  it("fills a sensible name and currency when the page omits them", () => {
    const chain = parseAddEthereumChain([{ chainId: "0x1" }]);
    expect(chain?.name).toBe("Ethereum Mainnet");
    expect(chain?.nativeCurrency.decimals).toBe(18);
    expect(chain?.rpcUrl).toBeNull();
  });

  it("returns null for a malformed request so the caller can answer 4902", () => {
    expect(parseAddEthereumChain(null)).toBeNull();
    expect(parseAddEthereumChain([{ chainId: "not-a-chain" }])).toBeNull();
    expect(parseAddEthereumChain([{}])).toBeNull();
  });
});

describe("web3RpcRequest", () => {
  it.effect("returns the JSON-RPC result", () =>
    Effect.gen(function* () {
      const result = yield* web3RpcRequest({
        rpcUrl: DEFAULT_LOCAL_RPC_URL,
        method: "eth_blockNumber",
      });
      expect(result).toBe("0x10");
    }).pipe(Effect.provide(makeJsonRpcClientLayer({ eth_blockNumber: "0x10" }))),
  );

  it.effect("turns a JSON-RPC error body into a typed failure, not a success", () =>
    Effect.gen(function* () {
      // A JSON-RPC error arrives with HTTP 200, so a status check alone would
      // hand the caller `undefined` and call it a win.
      const exit = yield* web3RpcRequest({
        rpcUrl: DEFAULT_LOCAL_RPC_URL,
        method: "eth_unknownMethod",
      }).pipe(Effect.result);

      expect(exit._tag).toBe("Failure");
      if (exit._tag === "Failure") {
        expect(exit.failure._tag).toBe("PreviewWalletRpcError");
        expect(exit.failure.code).toBe(-32601);
      }
    }).pipe(Effect.provide(makeJsonRpcClientLayer({}))),
  );
});

describe("probeChainId", () => {
  it.effect("reads the chain id from a reachable endpoint", () =>
    Effect.gen(function* () {
      expect(yield* probeChainId(DEFAULT_LOCAL_RPC_URL)).toBe(31337);
    }).pipe(Effect.provide(makeJsonRpcClientLayer({ eth_chainId: "0x7a69" }))),
  );

  it.effect("reports null for a refused connection rather than failing", () =>
    Effect.gen(function* () {
      expect(yield* probeChainId(DEFAULT_LOCAL_RPC_URL)).toBeNull();
    }).pipe(Effect.provide(refusedLayer)),
  );

  it.effect("absorbs a defective transport too, so wallet startup cannot die", () =>
    Effect.gen(function* () {
      expect(yield* probeChainId(DEFAULT_LOCAL_RPC_URL)).toBeNull();
    }).pipe(Effect.provide(defectiveLayer)),
  );

  it.effect("reports null when the endpoint answers something that is not a chain id", () =>
    Effect.gen(function* () {
      expect(yield* probeChainId(DEFAULT_LOCAL_RPC_URL)).toBeNull();
    }).pipe(Effect.provide(makeJsonRpcClientLayer({ eth_chainId: "not-a-chain-id" }))),
  );
});

describe("resolveInitialChain", () => {
  it.effect("prefers an explicit settings chain id and does not probe at all", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedJsonRpcCall> = [];
      const chain = yield* resolveInitialChain({
        settingsChainId: 11155111,
        settingsRpcUrl: "https://rpc.example.test",
      }).pipe(Effect.provide(makeJsonRpcClientLayer({ eth_chainId: "0x7a69" }, calls)));

      expect(chain?.chainId).toBe(11155111);
      expect(chain?.rpcUrl).toBe("https://rpc.example.test");
      expect(calls).toHaveLength(0);
    }),
  );

  it.effect("probes a settings RPC URL when no chain id is pinned", () =>
    Effect.gen(function* () {
      const chain = yield* resolveInitialChain({
        settingsChainId: null,
        settingsRpcUrl: "https://rpc.example.test",
      });
      expect(chain?.chainId).toBe(1);
      expect(chain?.rpcUrl).toBe("https://rpc.example.test");
    }).pipe(Effect.provide(makeJsonRpcClientLayer({ eth_chainId: "0x1" }))),
  );

  it.effect("adopts a local node when one is actually listening", () =>
    Effect.gen(function* () {
      const calls: Array<RecordedJsonRpcCall> = [];
      const chain = yield* resolveInitialChain({
        settingsChainId: null,
        settingsRpcUrl: null,
      }).pipe(Effect.provide(makeJsonRpcClientLayer({ eth_chainId: "0x7a69" }, calls)));

      expect(chain?.chainId).toBe(31337);
      expect(chain?.rpcUrl).toBe(DEFAULT_LOCAL_RPC_URL);
      expect(calls[0]?.url).toBe(DEFAULT_LOCAL_RPC_URL);
    }),
  );

  it.effect("resolves no chain rather than guessing a public endpoint", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveInitialChain({ settingsChainId: null, settingsRpcUrl: null }),
      ).toBeNull();
    }).pipe(Effect.provide(refusedLayer)),
  );

  it.effect("resolves no chain when a configured RPC URL is unreachable", () =>
    Effect.gen(function* () {
      expect(
        yield* resolveInitialChain({
          settingsChainId: null,
          settingsRpcUrl: "https://rpc.example.test",
        }),
      ).toBeNull();
    }).pipe(Effect.provide(refusedLayer)),
  );
});
