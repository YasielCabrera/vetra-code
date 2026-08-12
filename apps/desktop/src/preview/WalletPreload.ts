// @effect-diagnostics globalDate:off - This isolated Electron preload does not run inside an Effect runtime.
/**
 * Installs the preview wallet's EIP-1193 provider into a preview guest.
 *
 * Runs from `preview-pick-preload.cjs` at document start. `contextIsolation` is
 * off for preview guests (see `WebviewPreferences.ts`), so assigning
 * `window.ethereum` here lands it in the page's own world with no bridge — the
 * same property `react-grab` relies on.
 *
 * The bootstrap read is deliberately **synchronous**: a dapp can read
 * `window.ethereum` in its first inline script, and an async handshake would
 * lose that race on every page load. EIP-6963 discovery is still answered
 * asynchronously, so a late-arriving provider would be found too — but plenty
 * of dapps only check `window.ethereum`.
 */
import { installWeb3InpageProvider, WEB3_PROVIDER_ICON } from "@vetra-code/web3/inpage";
import type { Web3InpageWindow, Web3ProviderEvent } from "@vetra-code/web3/inpage";
import { ipcRenderer } from "electron";

import {
  PREVIEW_WALLET_BOOTSTRAP_CHANNEL,
  PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL,
  PREVIEW_WALLET_REQUEST_CHANNEL,
  type PreviewWalletReply,
} from "./GuestProtocol.ts";

interface WalletBootstrap {
  readonly enabled: boolean;
  readonly uuid: string;
  readonly chainId: string | null;
  readonly selectedAddress: string | null;
}

const isBootstrap = (value: unknown): value is WalletBootstrap =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { enabled?: unknown }).enabled === "boolean" &&
  typeof (value as { uuid?: unknown }).uuid === "string";

/** Rebuilds the EIP-1193 error the envelope describes, `code` included. */
const rejectionFrom = (reply: Extract<PreviewWalletReply, { ok: false }>): Error => {
  const error = new Error(reply.message) as Error & { code: number };
  error.code = reply.code;
  return error;
};

export function installPreviewWallet(): void {
  let bootstrap: unknown;
  try {
    bootstrap = ipcRenderer.sendSync(PREVIEW_WALLET_BOOTSTRAP_CHANNEL);
  } catch {
    // An older main process without the wallet bridge simply has no wallet.
    return;
  }
  if (!isBootstrap(bootstrap) || !bootstrap.enabled) return;

  const handle = installWeb3InpageProvider(window as unknown as Web3InpageWindow, {
    transport: async (args) => {
      const reply = (await ipcRenderer.invoke(PREVIEW_WALLET_REQUEST_CHANNEL, {
        method: args.method,
        params: args.params,
      })) as PreviewWalletReply | undefined;
      if (reply === undefined)
        throw rejectionFrom({ ok: false, code: -32603, message: "No reply." });
      if (reply.ok) return reply.result;
      throw rejectionFrom(reply);
    },
    uuid: bootstrap.uuid,
    icon: WEB3_PROVIDER_ICON,
    chainId: bootstrap.chainId,
    selectedAddress: bootstrap.selectedAddress,
  });

  ipcRenderer.on(PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL, (_event, payload: unknown) => {
    if (typeof payload !== "object" || payload === null) return;
    handle.emit(payload as Web3ProviderEvent);
  });
}
