import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DesktopEnvironmentBootstrapSchema,
  DesktopPreviewWalletConfigureInputSchema,
} from "./ipc.ts";

describe("DesktopPreviewWalletConfigureInputSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopPreviewWalletConfigureInputSchema);

  it("accepts an empty tab id so Settings can add an account without a preview tab", () => {
    const decoded = decode({
      tabId: "",
      input: { generateAccount: true },
    });
    expect(decoded.tabId).toBe("");
    expect(decoded.input.generateAccount).toBe(true);
  });

  it("accepts an account address to remove", () => {
    const decoded = decode({
      tabId: "",
      input: { removeAccount: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
    });
    expect(decoded.input.removeAccount).toBe("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
  });

  it("accepts a renamed account label", () => {
    const decoded = decode({
      tabId: "",
      input: {
        accountLabel: {
          address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
          label: "  Treasury  ",
        },
      },
    });
    expect(decoded.input.accountLabel).toEqual({
      address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      label: "Treasury",
    });
  });

  it("rejects an empty account label", () => {
    expect(() =>
      decode({
        tabId: "",
        input: {
          accountLabel: {
            address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
            label: "   ",
          },
        },
      }),
    ).toThrow();
  });
});

describe("DesktopEnvironmentBootstrapSchema", () => {
  const decode = Schema.decodeUnknownSync(DesktopEnvironmentBootstrapSchema);

  it("preserves the concrete running distro separately from the backend id", () => {
    expect(
      decode({
        id: "wsl:default",
        label: "WSL (Ubuntu)",
        runningDistro: "Ubuntu",
        httpBaseUrl: "http://127.0.0.1:3774/",
        wsBaseUrl: "ws://127.0.0.1:3774/",
      }),
    ).toEqual({
      id: "wsl:default",
      label: "WSL (Ubuntu)",
      runningDistro: "Ubuntu",
      httpBaseUrl: "http://127.0.0.1:3774/",
      wsBaseUrl: "ws://127.0.0.1:3774/",
    });
  });

  it("allows non-running and non-WSL bootstraps to report no running distro", () => {
    expect(
      decode({
        id: "primary",
        label: "Windows",
        runningDistro: null,
        httpBaseUrl: null,
        wsBaseUrl: null,
      }).runningDistro,
    ).toBeNull();
  });
});
