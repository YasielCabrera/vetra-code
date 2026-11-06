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

// Untrusted pages reach these channels, so Wallet.ts checks event.sender;
// DesktopIpc helpers discard it. Replies use a Web3GuestReply envelope.
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
export const PASSKEY_CREATE_CHANNEL = "preview:passkey-create";
export const PASSKEY_GET_CHANNEL = "preview:passkey-get";
export const PASSKEY_BRIDGE_ARGUMENT = "--vetra-code-preview-passkey-bridge";
export const ANNOTATION_VOICE_EVENT_CHANNEL = "preview:annotation-voice-event";
export const ANNOTATION_VOICE_STATE_CHANNEL = "preview:annotation-voice-state";
