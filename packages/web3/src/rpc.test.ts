import { describe, expect, it } from "vite-plus/test";

import {
  classifyWeb3Method,
  decodeSignableMessage,
  fromQuantityHex,
  parseChainId,
  summarizeWeb3Request,
  toQuantityHex,
  web3MethodNeedsAccountGrant,
  web3MethodRequiresApproval,
} from "./rpc.ts";

describe("classifyWeb3Method", () => {
  it("answers read-only wallet state locally", () => {
    expect(classifyWeb3Method("eth_accounts")).toBe("local");
    expect(classifyWeb3Method("eth_chainId")).toBe("local");
    expect(classifyWeb3Method("wallet_getPermissions")).toBe("local");
  });

  it("routes signing and broadcasting through approval", () => {
    for (const method of [
      "personal_sign",
      "eth_sign",
      "eth_signTypedData_v4",
      "eth_sendTransaction",
      "eth_signTransaction",
    ]) {
      expect(classifyWeb3Method(method)).toBe("signature");
      expect(web3MethodRequiresApproval(classifyWeb3Method(method))).toBe(true);
      expect(web3MethodNeedsAccountGrant(method)).toBe(true);
    }
  });

  it("separates connect, chain and asset requests from signing", () => {
    expect(classifyWeb3Method("eth_requestAccounts")).toBe("connect");
    expect(classifyWeb3Method("wallet_switchEthereumChain")).toBe("chain");
    expect(classifyWeb3Method("wallet_addEthereumChain")).toBe("chain");
    expect(classifyWeb3Method("wallet_watchAsset")).toBe("asset");
  });

  it("forwards anything unrecognised to the chain, which is what makes anvil cheat codes work", () => {
    expect(classifyWeb3Method("eth_getBalance")).toBe("passthrough");
    expect(classifyWeb3Method("anvil_setBalance")).toBe("passthrough");
    expect(classifyWeb3Method("evm_mine")).toBe("passthrough");
    expect(web3MethodRequiresApproval("passthrough")).toBe(false);
  });

  it("does not require an account grant for plain reads", () => {
    expect(web3MethodNeedsAccountGrant("eth_accounts")).toBe(false);
    expect(web3MethodNeedsAccountGrant("eth_getBalance")).toBe(false);
  });
});

describe("quantity hex", () => {
  it("round-trips bigints", () => {
    expect(toQuantityHex(0n)).toBe("0x0");
    expect(toQuantityHex(31337)).toBe("0x7a69");
    expect(fromQuantityHex("0x7a69")).toBe(31337n);
  });

  it("accepts the decimal strings and numbers pages actually send", () => {
    expect(fromQuantityHex(31337)).toBe(31337n);
    expect(fromQuantityHex("31337")).toBe(31337n);
    expect(fromQuantityHex(10n)).toBe(10n);
  });

  it("returns null instead of throwing on junk", () => {
    expect(fromQuantityHex("not-hex")).toBeNull();
    expect(fromQuantityHex(null)).toBeNull();
    expect(fromQuantityHex(undefined)).toBeNull();
    expect(fromQuantityHex({})).toBeNull();
  });
});

describe("parseChainId", () => {
  it("parses hex and decimal chain ids", () => {
    expect(parseChainId("0x1")).toBe(1);
    expect(parseChainId("0x7a69")).toBe(31337);
    expect(parseChainId(11155111)).toBe(11155111);
  });

  it("rejects values that cannot be a chain id so callers can answer 4902", () => {
    expect(parseChainId("0x0")).toBeNull();
    expect(parseChainId("-1")).toBeNull();
    expect(parseChainId("0xffffffffffffffffffff")).toBeNull();
    expect(parseChainId(undefined)).toBeNull();
  });
});

describe("decodeSignableMessage", () => {
  it("decodes hex to utf-8 for display", () => {
    expect(decodeSignableMessage("0x68656c6c6f")).toBe("hello");
  });

  it("passes plain strings through, which pages send despite the spec", () => {
    expect(decodeSignableMessage("Sign in to Example")).toBe("Sign in to Example");
  });

  it("keeps non-utf8 hex as hex rather than rendering replacement characters", () => {
    expect(decodeSignableMessage("0xfffefd")).toBe("0xfffefd");
  });

  it("treats the empty hex payload as an empty string", () => {
    expect(decodeSignableMessage("0x")).toBe("");
  });
});

describe("summarizeWeb3Request", () => {
  const origin = "http://localhost:5173";

  it("names the consequence for a connect request", () => {
    expect(summarizeWeb3Request({ method: "eth_requestAccounts", params: [], origin })).toBe(
      `Connect wallet accounts to ${origin}.`,
    );
  });

  it("decodes personal_sign message-first parameter order", () => {
    const summary = summarizeWeb3Request({
      method: "personal_sign",
      params: ["0x68656c6c6f", "0x1111111111111111111111111111111111111111"],
      origin,
    });
    expect(summary).toContain('"hello"');
  });

  it("decodes eth_sign reversed parameter order", () => {
    const summary = summarizeWeb3Request({
      method: "eth_sign",
      params: ["0x1111111111111111111111111111111111111111", "0x68656c6c6f"],
      origin,
    });
    expect(summary).toContain('"hello"');
  });

  it("pulls domain and primaryType out of a typed-data JSON string", () => {
    const typedData = JSON.stringify({
      domain: { name: "Seaport", chainId: 1 },
      primaryType: "OrderComponents",
      types: {},
      message: {},
    });
    const summary = summarizeWeb3Request({
      method: "eth_signTypedData_v4",
      params: ["0x1111111111111111111111111111111111111111", typedData],
      origin,
    });
    expect(summary).toContain("OrderComponents");
    expect(summary).toContain("Seaport");
  });

  it("uses the chain when typed data has no domain name", () => {
    const summary = summarizeWeb3Request({
      method: "eth_signTypedData_v4",
      params: [
        "0x1111111111111111111111111111111111111111",
        JSON.stringify({
          domain: { version: "1", chainId: 1 },
          primaryType: "VerifiableCredential",
          types: {},
          message: {},
        }),
      ],
      origin,
    });
    expect(summary).toContain("VerifiableCredential");
    expect(summary).toContain("chain 1");
  });

  it("survives malformed typed data without throwing", () => {
    const summary = summarizeWeb3Request({
      method: "eth_signTypedData_v4",
      params: ["0x1111111111111111111111111111111111111111", "{not json"],
      origin,
    });
    expect(summary).toContain("unknown");
  });

  it("renders transaction value in native units and flags calldata", () => {
    const summary = summarizeWeb3Request({
      method: "eth_sendTransaction",
      params: [
        {
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
          value: "0x16345785d8a0000",
          data: "0xa9059cbb0000",
        },
      ],
      origin,
    });
    expect(summary).toContain("0.1 native");
    expect(summary).toContain("0x2222222222222222222222222222222222222222");
    expect(summary).toContain("6 bytes");
  });

  it("calls out contract deployment when there is no recipient", () => {
    const summary = summarizeWeb3Request({
      method: "eth_sendTransaction",
      params: [{ data: "0x6080" }],
      origin,
    });
    expect(summary).toContain("a new contract");
  });

  it("decodes chain switch and add requests", () => {
    expect(
      summarizeWeb3Request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x7a69" }],
        origin,
      }),
    ).toContain("chain 31337");

    const added = summarizeWeb3Request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: "0x7a69", chainName: "Anvil", rpcUrls: ["http://127.0.0.1:8545"] }],
      origin,
    });
    expect(added).toContain("Anvil");
    expect(added).toContain("http://127.0.0.1:8545");
  });

  it("falls back to the method name for anything it cannot decode", () => {
    expect(summarizeWeb3Request({ method: "eth_getBalance", params: [], origin })).toBe(
      `eth_getBalance from ${origin}.`,
    );
  });
});
