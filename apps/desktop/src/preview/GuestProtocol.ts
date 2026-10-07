export const START_PICK_CHANNEL = "preview:start-pick";
export const CANCEL_PICK_CHANNEL = "preview:cancel-pick";
export const ELEMENT_PICKED_CHANNEL = "preview:element-picked";
export const ANNOTATION_CAPTURED_CHANNEL = "preview:annotation-captured";
export const ANNOTATION_THEME_CHANNEL = "preview:annotation-theme";
export const ANNOTATION_SEND_ENABLED_CHANNEL = "preview:annotation-send-enabled";
export const HUMAN_INPUT_CHANNEL = "preview:human-input";
export const MOUSE_NAVIGATE_CHANNEL = "preview:mouse-navigate";
export const RECORDING_CURSOR_CHANNEL = "preview:recording-cursor";
export const RECORDING_POINTER_CHANNEL = "preview:recording-pointer";
export const RECORDING_KEY_CHANNEL = "preview:recording-key";
export const RECORDING_INPUT_CHANNEL = "preview:recording-input";
export const RECORDING_CONTROLLER_CHANNEL = "preview:recording-controller";

/**
 * Wallet channels used by the preview guest preload.
 *
 * These are reached by *untrusted page content* via the preload, so their
 * `ipcMain` handlers live in `Wallet.ts` where `event.sender` can be checked,
 * rather than going through the typed `DesktopIpc` helpers that discard it.
 * Requests are answered with a `Web3GuestReply` envelope.
 */
export const PREVIEW_WALLET_BOOTSTRAP_CHANNEL = "preview:wallet-bootstrap";
export const PREVIEW_WALLET_REQUEST_CHANNEL = "preview:wallet-request";
export const PREVIEW_WALLET_PROVIDER_EVENT_CHANNEL = "preview:wallet-provider-event";

/**
 * What a document learns about the wallet as it starts. Each document gets its
 * own `documentId` and sends it with every request, so the server can drop a
 * reloaded page's old prompts.
 */
export type PreviewWalletBootstrap =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly uuid: string;
      readonly chainId: string | null;
      readonly selectedAddress: string | null;
      readonly documentId: string;
    };
