import { describe, expect, it, vi } from "vite-plus/test";

import {
  installWeb3InpageProvider,
  WEB3_PROVIDER_ICON,
  WEB3_PROVIDER_INFO,
  type Eip1193RequestArgs,
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
