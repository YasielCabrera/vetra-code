export const START_PICK_CHANNEL = "preview:start-pick";
export const CANCEL_PICK_CHANNEL = "preview:cancel-pick";
export const ELEMENT_PICKED_CHANNEL = "preview:element-picked";
export const ANNOTATION_CAPTURED_CHANNEL = "preview:annotation-captured";
export const ANNOTATION_THEME_CHANNEL = "preview:annotation-theme";
export const HUMAN_INPUT_CHANNEL = "preview:human-input";
export const MOUSE_NAVIGATE_CHANNEL = "preview:mouse-navigate";

/**
 * Wallet channels used by the preview guest preload.
 *
 * These are reached by *untrusted page content* via the preload, so their
 * `ipcMain` handlers live in `Wallet.ts` where `event.sender` can be checked,
 * rather than going through the typed `DesktopIpc` helpers that discard it.
 */
export const PREVIEW_WALLET_BOOTSTRAP_CHANNEL = "preview:wallet-bootstrap";
export const PREVIEW_WALLET_REQUEST_CHANNEL = "preview:wallet-request";
export const PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL = "preview:wallet-provider-event";

/**
 * Wallet replies travel as a discriminated envelope rather than a rejected
 * promise.
 *
 * `ipcRenderer.invoke` rejections arrive in the guest as a bare `Error` whose
 * message has been reworded by Electron — every own property, including the
 * `code`, is lost. Dapps branch on `error.code === 4001` to tell "user
 * rejected" from "something broke", so throwing across IPC would make every
 * rejection look like a crash. The preload rebuilds a proper
 * `ProviderRpcError` from this envelope instead.
 */
export type PreviewWalletReply =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: number; readonly message: string };
