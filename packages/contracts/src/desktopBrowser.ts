import * as Schema from "effect/Schema";
import { Web3GuestReply, Web3KeystoreFile, Web3PageState } from "@t3tools/web3/schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const TabKey = {
  threadId: TrimmedNonEmptyString,
  tabId: TrimmedNonEmptyString,
};

/** The page's own request id, so the server's reply finds the waiting guest. */
const WalletRequestId = TrimmedNonEmptyString.check(Schema.isMaxLength(128));

/** Desktop -> server. */
export const DesktopBrowserEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("attached"), ...TabKey }),
  /** Its `<webview>` went away: closed, crashed, swapped, or devtools took the debugger. */
  Schema.Struct({ type: Schema.Literal("detached"), ...TabKey }),
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
  /**
   * A page in this tab called its preview wallet. The server's wallet signs for
   * every tab, so the desktop forwards what its preload received, with the
   * origin it read from the page's `webContents`.
   */
  Schema.Struct({
    type: Schema.Literal("walletRequest"),
    requestId: WalletRequestId,
    ...TabKey,
    /** Changes with each document in the tab, so a reload drops its old prompts. */
    documentId: WalletRequestId,
    origin: TrimmedNonEmptyString.check(Schema.isMaxLength(2048)),
    method: TrimmedNonEmptyString.check(Schema.isMaxLength(120)),
    params: Schema.Unknown,
  }),
  /**
   * Once per run: the keystore from when the desktop signed itself, or null.
   * The server adopts it only while it has no wallet of its own.
   */
  Schema.Struct({
    type: Schema.Literal("walletKeystoreOffer"),
    keystore: Schema.NullOr(Web3KeystoreFile),
  }),
]);
export type DesktopBrowserEvent = typeof DesktopBrowserEvent.Type;

export const DesktopBrowserCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("cdp"), ...TabKey, message: Schema.String }),
  Schema.Struct({ type: Schema.Literal("release"), ...TabKey }),
  Schema.Struct({
    type: Schema.Literal("pointer"),
    ...TabKey,
    phase: Schema.Literals(["move", "click"]),
    x: Schema.Finite,
    y: Schema.Finite,
  }),
  /** The wallet's answer to a `walletRequest`. */
  Schema.Struct({
    type: Schema.Literal("walletReply"),
    requestId: WalletRequestId,
    reply: Web3GuestReply,
  }),
  /** What pages may know of the wallet, on connect and whenever it changes. */
  Schema.Struct({ type: Schema.Literal("walletState"), state: Web3PageState }),
  /** The server stored the offered keystore, so the desktop retires its copy. */
  Schema.Struct({ type: Schema.Literal("walletKeystoreAccepted") }),
  /** Whether an agent turn runs on the thread, so the tabs it uses stay focused between steps. */
  Schema.Struct({
    type: Schema.Literal("turn"),
    threadId: TrimmedNonEmptyString,
    active: Schema.Boolean,
  }),
]);
export type DesktopBrowserCommand = typeof DesktopBrowserCommand.Type;
