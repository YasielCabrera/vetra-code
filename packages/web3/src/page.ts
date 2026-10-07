/**
 * What one page's provider should see of the wallet, and the events that move
 * it there. Each host (the desktop's preview preload, the server's headless
 * tabs) keeps the last view it gave a document and replays only the difference
 * when the wallet changes, so pages never receive raw wallet state.
 *
 * Dependency-free at runtime: the desktop main process imports it without the
 * signer.
 *
 * @module Web3Page
 */
import type { Web3ProviderEvent } from "./inpage.ts";
import type { Web3PageState } from "./schema.ts";

export interface Web3PageView {
  readonly enabled: boolean;
  readonly chainId: string | null;
  readonly accounts: ReadonlyArray<string>;
}

/** What a page has seen before the wallet told it anything. */
export const EMPTY_PAGE_VIEW: Web3PageView = { enabled: false, chainId: null, accounts: [] };

/** Account visibility is an origin grant: an ungranted origin sees no accounts. */
export const pageViewFor = (state: Web3PageState, origin: string): Web3PageView =>
  state.enabled
    ? {
        enabled: true,
        chainId: state.chainId,
        accounts: state.connectedOrigins.includes(origin) ? state.accounts : [],
      }
    : EMPTY_PAGE_VIEW;

const sameAccounts = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((address, index) => address === right[index]);

/** The EIP-1193 events that take a page from `previous` to `next`, in delivery order. */
export const pageEventsBetween = (
  previous: Web3PageView,
  next: Web3PageView,
): ReadonlyArray<Web3ProviderEvent> => {
  if (!next.enabled) {
    return previous.enabled
      ? [{ event: "disconnect", payload: { code: 4900, message: "The preview wallet is off." } }]
      : [];
  }
  const events: Array<Web3ProviderEvent> = [];
  if (!previous.enabled && next.chainId !== null) {
    events.push({ event: "connect", payload: { chainId: next.chainId } });
  } else if (next.chainId !== null && next.chainId !== previous.chainId) {
    events.push({ event: "chainChanged", payload: next.chainId });
  }
  if (!sameAccounts(previous.accounts, next.accounts)) {
    events.push({ event: "accountsChanged", payload: [...next.accounts] });
  }
  return events;
};
