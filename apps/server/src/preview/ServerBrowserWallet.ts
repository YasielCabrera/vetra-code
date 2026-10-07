/**
 * The preview wallet in the server's own headless tabs.
 *
 * Each headless browser context gets a page binding and an init script built
 * from the same provider the desktop preload installs, so `window.ethereum`
 * exists before a dapp's first script. Identity comes from Playwright's view of
 * the calling page and frame, never from the payload: only the top frame of a
 * page registered to a preview tab may use the wallet, with the origin of the
 * page's current URL. Desktop-rendered tabs keep the desktop preload and never
 * pass through here.
 */
import { web3ServerPageScript, WEB3_PROVIDER_ICON } from "@t3tools/web3/inpage";
import {
  EMPTY_PAGE_VIEW,
  pageEventsBetween,
  pageViewFor,
  type Web3PageView,
} from "@t3tools/web3/page";
import type { Web3GuestReply, Web3PageState } from "@t3tools/web3/schema";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type { BrowserContext, Disposable, Frame, Page } from "playwright-core";

import * as ServerPreviewWallet from "../web3/ServerPreviewWallet.ts";

const BINDING = "__vetraPreviewWallet";
const EMIT_HOOK = "__vetraPreviewWalletEmit";

const BoundedId = Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(128));
const PageCall = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("bootstrap"),
    documentId: BoundedId,
    chainId: Schema.optional(Schema.NullOr(Schema.String.check(Schema.isMaxLength(66)))),
  }),
  Schema.Struct({
    kind: Schema.Literal("request"),
    documentId: BoundedId,
    method: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(120)),
    params: Schema.optional(Schema.Unknown),
  }),
]);
const decodePageCall = Schema.decodeUnknownOption(PageCall);

const refused = (message: string): Web3GuestReply => ({ ok: false, code: 4100, message });

/** Where Playwright says a binding call came from. */
interface BindingSource {
  readonly page: Page;
  readonly frame: Frame;
}

/** A web page's origin; anything else (about:blank, data:, files) cannot use the wallet. */
const webOriginOf = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

interface PreparedContext {
  script: Disposable | null;
  scriptFor: string | null;
}

interface PageGuest {
  readonly key: ServerPreviewWallet.WalletTabKey;
  /** The document the page last bootstrapped; events go only to a bootstrapped document. */
  documentId: string | null;
  delivered: Web3PageView;
}

export const make = Effect.gen(function* () {
  const wallet = yield* ServerPreviewWallet.ServerPreviewWallet;
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const contexts = new Map<BrowserContext, Promise<PreparedContext>>();
  const bound = new WeakSet<BrowserContext>();
  const guests = new Map<Page, PageGuest>();
  /** Popups whose page script called before the popup became a tab. */
  const adopting = new Map<Page, (guest: PageGuest | undefined) => void>();
  const adopted = new Map<Page, Promise<PageGuest | undefined>>();
  let state: Web3PageState = yield* wallet.pageState;

  /** The init script for the current state: none while the wallet is off. */
  const syncScript = async (context: BrowserContext, prepared: PreparedContext) => {
    const scriptFor = state.enabled ? `${state.uuid}:${state.chainId}` : null;
    if (prepared.scriptFor === scriptFor) return;
    const previous = prepared.script;
    prepared.script = null;
    prepared.scriptFor = scriptFor;
    await previous?.dispose().catch(() => undefined);
    if (scriptFor === null) return;
    prepared.script = await context.addInitScript({
      content: web3ServerPageScript({
        uuid: state.uuid,
        icon: WEB3_PROVIDER_ICON,
        chainId: state.chainId,
        binding: BINDING,
        emitHook: EMIT_HOOK,
      }),
    });
  };

  /**
   * The page's tab. A popup's page runs the script before it becomes a tab,
   * so its first calls wait for that, or for it to close.
   */
  const guestOf = async (page: Page): Promise<PageGuest | undefined> => {
    const guest = guests.get(page);
    if (guest) return guest;
    const opener = await page.opener().catch(() => null);
    const registered = guests.get(page);
    if (registered) return registered;
    if (opener === null || !guests.has(opener)) return undefined;
    const waiting = adopted.get(page);
    if (waiting) return waiting;
    const registration = new Promise<PageGuest | undefined>((resolve) => {
      adopting.set(page, resolve);
      page.once("close", () => resolve(undefined));
    });
    adopted.set(page, registration);
    return registration;
  };

  const answer = async (source: BindingSource, payload: unknown): Promise<unknown> => {
    const guest = await guestOf(source.page);
    if (!guest || source.frame !== source.page.mainFrame()) {
      return refused("The preview wallet only answers a preview tab's top-level page.");
    }
    const origin = webOriginOf(source.page.mainFrame().url());
    const call = decodePageCall(payload);
    if (origin === null || call._tag === "None")
      return refused("The preview wallet is not available here.");
    if (call.value.kind === "request") {
      return runPromise(
        wallet.request(guest.key, {
          documentId: call.value.documentId,
          origin,
          method: call.value.method,
          params: call.value.params,
        }),
      );
    }
    await runPromise(wallet.openDocument(guest.key, call.value.documentId));
    const view = pageViewFor(state, origin);
    guest.documentId = call.value.documentId;
    guest.delivered = view;
    // The script already set the chain it was built with; only a newer one is news.
    const start = { enabled: true, chainId: call.value.chainId ?? null, accounts: view.accounts };
    return { accounts: view.accounts, events: pageEventsBetween(start, view) };
  };

  const deliver = async (page: Page, guest: PageGuest) => {
    if (guest.documentId === null || page.isClosed()) return;
    const origin = webOriginOf(page.mainFrame().url());
    const view = origin === null ? EMPTY_PAGE_VIEW : pageViewFor(state, origin);
    const events = pageEventsBetween(guest.delivered, view);
    guest.delivered = view;
    if (events.length === 0) return;
    await page
      .mainFrame()
      .evaluate(
        ([hook, payload]) =>
          (globalThis as unknown as Record<string, ((events: unknown) => void) | undefined>)[
            hook
          ]?.(payload),
        [EMIT_HOOK, events] as const,
      )
      .catch(() => undefined);
  };

  yield* wallet.page.pipe(
    Stream.runForEach((next) =>
      Effect.promise(async () => {
        state = next;
        for (const [context, preparing] of contexts) {
          await preparing.then((prepared) => syncScript(context, prepared)).catch(() => undefined);
        }
        await Promise.all([...guests].map(([page, guest]) => deliver(page, guest)));
      }),
    ),
    Effect.forkScoped,
  );

  return {
    /**
     * Installs the binding and script on a headless context before any of its
     * pages exist. Concurrent opens share one preparation; a failed one is
     * forgotten so the next open retries.
     */
    prepare: (context: BrowserContext): Promise<void> => {
      const existing = contexts.get(context);
      if (existing) return existing.then(() => undefined);
      const preparing = (async () => {
        await runPromise(wallet.ready);
        if (!bound.has(context)) {
          await context.exposeBinding(BINDING, (source, payload) => answer(source, payload));
          bound.add(context);
        }
        const prepared: PreparedContext = { script: null, scriptFor: null };
        await syncScript(context, prepared);
        return prepared;
      })();
      contexts.set(context, preparing);
      context.once("close", () => contexts.delete(context));
      return preparing.then(
        () => undefined,
        (cause: unknown) => {
          if (contexts.get(context) === preparing) contexts.delete(context);
          throw cause;
        },
      );
    },
    /** Ties a headless page to its preview tab before its first navigation. */
    register: (page: Page, key: ServerPreviewWallet.WalletTabKey) => {
      const guest: PageGuest = { key, documentId: null, delivered: EMPTY_PAGE_VIEW };
      guests.set(page, guest);
      adopting.get(page)?.(guest);
      adopting.delete(page);
      adopted.delete(page);
      page.once("close", () => guests.delete(page));
    },
  };
});
