// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Runs the server tab script in a fresh realm and lets its promise callbacks finish.
import * as NodeVM from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  installWeb3InpageProvider,
  web3ServerPageScript,
  WEB3_PROVIDER_ICON,
  WEB3_PROVIDER_INFO,
  type Eip1193RequestArgs,
  type Web3InpageProvider,
  type Web3InpageWindow,
} from "./inpage.ts";

class FakeCustomEvent {
  readonly type: string;
  readonly detail: unknown;

  constructor(type: string, init?: { detail?: unknown }) {
    this.type = type;
    this.detail = init?.detail;
  }
}

interface FakeWindow extends Web3InpageWindow {
  readonly dispatched: Array<FakeCustomEvent>;
  readonly listeners: Map<string, Set<(event: unknown) => void>>;
  fire(type: string): void;
}

function makeWindow(): FakeWindow {
  const dispatched: Array<FakeCustomEvent> = [];
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    ethereum: undefined,
    dispatched,
    listeners,
    CustomEvent: FakeCustomEvent as unknown as Web3InpageWindow["CustomEvent"],
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? new Set();
      bucket.add(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      dispatched.push(event as FakeCustomEvent);
      return true;
    },
    fire(type) {
      for (const listener of Array.from(listeners.get(type) ?? [])) listener({ type });
    },
  };
}

const options = (transport: (args: Eip1193RequestArgs) => Promise<unknown>) => ({
  transport,
  uuid: "11111111-2222-3333-4444-555555555555",
  icon: WEB3_PROVIDER_ICON,
});

const announcements = (window: FakeWindow) =>
  window.dispatched.filter((event) => event.type === "eip6963:announceProvider");

describe("installWeb3InpageProvider", () => {
  it("exposes the provider on window.ethereum and flags itself as MetaMask", () => {
    const window = makeWindow();
    const handle = installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );

    expect(window.ethereum).toBe(handle.provider);
    expect(handle.provider.isMetaMask).toBe(true);
    // The honest marker, so our own code can tell the difference.
    expect(handle.provider.isVetraPreviewWallet).toBe(true);
  });

  it("announces over EIP-6963 on install with a frozen io.metamask detail", () => {
    const window = makeWindow();
    const handle = installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );

    const announced = announcements(window);
    expect(announced).toHaveLength(1);
    const detail = announced[0]?.detail as {
      info: { rdns: string; name: string; uuid: string; icon: string };
      provider: unknown;
    };
    expect(detail.info.rdns).toBe(WEB3_PROVIDER_INFO.rdns);
    expect(detail.info.rdns).toBe("io.metamask");
    expect(detail.info.uuid).toBe("11111111-2222-3333-4444-555555555555");
    expect(detail.info.icon.startsWith("data:image/")).toBe(true);
    expect(detail.provider).toBe(handle.provider);
    expect(Object.isFrozen(detail)).toBe(true);
    expect(Object.isFrozen(detail.info)).toBe(true);
  });

  it("re-announces on eip6963:requestProvider, which is what makes late install safe", () => {
    const window = makeWindow();
    installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );
    expect(announcements(window)).toHaveLength(1);

    window.fire("eip6963:requestProvider");
    window.fire("eip6963:requestProvider");

    expect(announcements(window)).toHaveLength(3);
  });

  it("forwards request() to the transport verbatim", async () => {
    const transport = vi.fn(() => Promise.resolve(["0xabc"]));
    const window = makeWindow();
    const handle = installWeb3InpageProvider(window, options(transport));

    const result = await handle.provider.request({
      method: "eth_requestAccounts",
      params: [{ eth_accounts: {} }],
    });

    expect(result).toEqual(["0xabc"]);
    expect(transport).toHaveBeenCalledWith({
      method: "eth_requestAccounts",
      params: [{ eth_accounts: {} }],
    });
  });

  it("synchronizes selectedAddress from account request results", async () => {
    const responses = new Map<string, unknown>([
      ["eth_requestAccounts", ["0xAbC"]],
      ["eth_accounts", []],
      ["wallet_revokePermissions", null],
    ]);
    const handle = installWeb3InpageProvider(
      makeWindow(),
      options(({ method }) => Promise.resolve(responses.get(method))),
    );

    expect(handle.provider.selectedAddress).toBeNull();
    await handle.provider.request({ method: "eth_requestAccounts" });
    expect(handle.provider.selectedAddress).toBe("0xAbC");

    await handle.provider.request({ method: "eth_accounts" });
    expect(handle.provider.selectedAddress).toBeNull();

    responses.set("eth_requestAccounts", ["0xDeF"]);
    await handle.provider.request({ method: "eth_requestAccounts" });
    await handle.provider.request({ method: "wallet_revokePermissions" });
    expect(handle.provider.selectedAddress).toBeNull();
  });

  it("rejects a request with no method instead of forwarding it", async () => {
    const transport = vi.fn(() => Promise.resolve(null));
    const window = makeWindow();
    const handle = installWeb3InpageProvider(window, options(transport));

    await expect(
      handle.provider.request({ method: "" } as Eip1193RequestArgs),
    ).rejects.toMatchObject({ code: -32600 });
    expect(transport).not.toHaveBeenCalled();
  });

  it("keeps chainId, networkVersion and selectedAddress in step with host events", () => {
    const window = makeWindow();
    const handle = installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );

    handle.emit({ event: "chainChanged", payload: "0x7a69" });
    expect(handle.provider.chainId).toBe("0x7a69");
    expect(handle.provider.networkVersion).toBe("31337");

    handle.emit({ event: "accountsChanged", payload: ["0xAbC", "0xDeF"] });
    expect(handle.provider.selectedAddress).toBe("0xAbC");

    handle.emit({ event: "accountsChanged", payload: [] });
    expect(handle.provider.selectedAddress).toBeNull();
  });

  it("delivers events to listeners registered with on and addListener", () => {
    const window = makeWindow();
    const handle = installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );
    const viaOn = vi.fn();
    const viaAddListener = vi.fn();

    handle.provider.on("chainChanged", viaOn);
    handle.provider.addListener("chainChanged", viaAddListener);
    handle.emit({ event: "chainChanged", payload: "0x1" });

    expect(viaOn).toHaveBeenCalledWith("0x1");
    expect(viaAddListener).toHaveBeenCalledWith("0x1");
  });

  it("still notifies later listeners when an earlier one removes itself mid-dispatch", () => {
    const window = makeWindow();
    const handle = installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );
    const second = vi.fn();
    const first = vi.fn(() => {
      handle.provider.removeListener("accountsChanged", first);
    });

    handle.provider.on("accountsChanged", first);
    handle.provider.on("accountsChanged", second);
    handle.emit({ event: "accountsChanged", payload: [] });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("does not let a throwing dapp listener break its siblings", () => {
    const window = makeWindow();
    const handle = installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );
    const healthy = vi.fn();

    handle.provider.on("chainChanged", () => {
      throw new Error("dapp bug");
    });
    handle.provider.on("chainChanged", healthy);

    expect(() => handle.emit({ event: "chainChanged", payload: "0x1" })).not.toThrow();
    expect(healthy).toHaveBeenCalledTimes(1);
  });

  it("stops delivering after removeListener and removeAllListeners", () => {
    const window = makeWindow();
    const handle = installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );
    const listener = vi.fn();

    handle.provider.on("chainChanged", listener);
    handle.provider.removeListener("chainChanged", listener);
    handle.emit({ event: "chainChanged", payload: "0x1" });
    expect(listener).not.toHaveBeenCalled();

    handle.provider.on("chainChanged", listener);
    handle.provider.removeAllListeners();
    handle.emit({ event: "chainChanged", payload: "0x2" });
    expect(listener).not.toHaveBeenCalled();
  });

  describe("legacy shims", () => {
    it("maps enable() to eth_requestAccounts", async () => {
      const transport = vi.fn(() => Promise.resolve(["0xabc"]));
      const handle = installWeb3InpageProvider(makeWindow(), options(transport));

      await handle.provider.enable();

      expect(transport).toHaveBeenCalledWith({ method: "eth_requestAccounts", params: undefined });
    });

    it("supports send(method, params)", async () => {
      const transport = vi.fn(() => Promise.resolve("0x1"));
      const handle = installWeb3InpageProvider(makeWindow(), options(transport));

      await handle.provider.send("eth_chainId", []);

      expect(transport).toHaveBeenCalledWith({ method: "eth_chainId", params: [] });
    });

    it("supports send(payload, callback)", async () => {
      const transport = vi.fn(() => Promise.resolve("0x1"));
      const handle = installWeb3InpageProvider(makeWindow(), options(transport));

      const response = await new Promise<unknown>((resolve, reject) => {
        handle.provider.send({ id: 7, method: "eth_chainId" }, (error: unknown, value?: unknown) =>
          error ? reject(error) : resolve(value),
        );
      });

      expect(response).toEqual({ id: 7, jsonrpc: "2.0", result: "0x1" });
    });

    it("surfaces transport failures through sendAsync's error argument", async () => {
      const failure = Object.assign(new Error("User rejected the request."), { code: 4001 });
      const handle = installWeb3InpageProvider(
        makeWindow(),
        options(() => Promise.reject(failure)),
      );

      const error = await new Promise<unknown>((resolve) => {
        handle.provider.sendAsync({ id: 1, method: "personal_sign" }, (cause: unknown) =>
          resolve(cause),
        );
      });

      expect(error).toMatchObject({ code: 4001 });
    });
  });

  it("uninstall detaches window.ethereum and the discovery listener", () => {
    const window = makeWindow();
    const handle = installWeb3InpageProvider(
      window,
      options(() => Promise.resolve(null)),
    );

    handle.uninstall();

    expect(window.ethereum).toBeUndefined();
    window.fire("eip6963:requestProvider");
    expect(announcements(window)).toHaveLength(1);
  });
});

describe("web3ServerPageScript", () => {
  const BINDING = "__walletBinding";
  const EMIT = "__walletEmit";
  const ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

  /**
   * A fresh realm with only the browser globals the script may use, so a
   * reference to anything from this module would throw.
   */
  const runInPage = (answer: (call: Record<string, unknown>) => unknown, withBinding = true) => {
    const calls: Array<Record<string, unknown>> = [];
    const window = makeWindow();
    const page = Object.assign(window, {
      crypto: {
        getRandomValues: (bytes: Uint8Array) => {
          for (let index = 0; index < bytes.length; index += 1) bytes[index] = index * 7;
          return bytes;
        },
      },
    });
    const globals = page as unknown as Record<string, unknown>;
    if (withBinding) {
      globals[BINDING] = (call: Record<string, unknown>) => {
        calls.push(call);
        return Promise.resolve(answer(call));
      };
    }
    const context = NodeVM.createContext(page);
    NodeVM.runInContext(
      web3ServerPageScript({
        uuid: "wallet-uuid",
        icon: WEB3_PROVIDER_ICON,
        chainId: "0x7a69",
        binding: BINDING,
        emitHook: EMIT,
      }),
      context,
    );
    return {
      window,
      calls,
      provider: () => window.ethereum as Web3InpageProvider,
      emit: (events: unknown) => (globals[EMIT] as (events: unknown) => void)(events),
    };
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("installs the provider before page scripts and announces it", () => {
    const page = runInPage(() => ({ accounts: [], events: [] }));
    expect(page.provider().isMetaMask).toBe(true);
    expect(page.provider().isVetraPreviewWallet).toBe(true);
    expect(page.provider().chainId).toBe("0x7a69");
    expect(announcements(page.window)).toHaveLength(1);
  });

  it("does nothing without the host binding", () => {
    const page = runInPage(() => null, false);
    expect(page.window.ethereum).toBeUndefined();
  });

  it("fills in a granted page's account from the bootstrap without an event", async () => {
    const page = runInPage(() => ({ accounts: [ADDRESS], events: [] }));
    const changed = vi.fn();
    page.provider().on("accountsChanged", changed);
    await settle();
    expect(page.calls[0]).toMatchObject({ kind: "bootstrap", chainId: "0x7a69" });
    expect(page.provider().selectedAddress).toBe(ADDRESS);
    expect(changed).not.toHaveBeenCalled();
  });

  it("sends requests with one document id and rebuilds the EIP-1193 error", async () => {
    const page = runInPage((call) =>
      call.kind === "bootstrap"
        ? { accounts: [], events: [] }
        : call.method === "personal_sign"
          ? { ok: false, code: 4001, message: "User rejected the request." }
          : { ok: true, result: [ADDRESS] },
    );
    expect(await page.provider().request({ method: "eth_requestAccounts" })).toEqual([ADDRESS]);
    await expect(
      page.provider().request({ method: "personal_sign", params: ["0x68656c6c6f", ADDRESS] }),
    ).rejects.toMatchObject({ code: 4001, message: "User rejected the request." });

    const requests = page.calls.filter((call) => call.kind === "request");
    expect(requests[0]).toMatchObject({ method: "eth_requestAccounts" });
    expect(requests[1]).toMatchObject({
      method: "personal_sign",
      params: ["0x68656c6c6f", ADDRESS],
    });
    expect(new Set(page.calls.map((call) => call.documentId)).size).toBe(1);
    expect(page.calls[0]?.documentId).toMatch(/^[0-9a-f]{32}$/);
  });

  it("delivers host events to the page's listeners", () => {
    const page = runInPage(() => ({ accounts: [], events: [] }));
    const chainChanged = vi.fn();
    page.provider().on("chainChanged", chainChanged);
    page.emit([{ event: "chainChanged", payload: "0x1" }]);
    expect(page.provider().chainId).toBe("0x1");
    expect(page.provider().networkVersion).toBe("1");
    expect(chainChanged).toHaveBeenCalledWith("0x1");
  });
});
