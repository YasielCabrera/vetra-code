import { expect, it } from "@effect/vitest";
import type { Web3PageState } from "@t3tools/web3/schema";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { BrowserContext, Page } from "playwright-core";

import * as ServerPreviewWallet from "../web3/ServerPreviewWallet.ts";
import * as ServerBrowserWallet from "./ServerBrowserWallet.ts";

const ACCOUNT = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ORIGIN = "http://localhost:5173";
const KEY = { threadId: "thread-1", tabId: "tab-1" };

const enabledState: Web3PageState = {
  enabled: true,
  uuid: "wallet-uuid",
  chainId: "0x7a69",
  accounts: [ACCOUNT],
  connectedOrigins: [ORIGIN],
};

type Binding = (source: unknown, payload: unknown) => Promise<unknown>;

/** A fake headless context: what the adapter installs, and the binding it exposes. */
const makeContext = (failFirstBinding = false) => {
  let failures = failFirstBinding ? 1 : 0;
  const scripts: Array<{ content: string; disposed: Promise<void> }> = [];
  let scriptAdded = Promise.withResolvers<void>();
  const context = {
    binding: null as Binding | null,
    bindings: 0,
    scripts,
    nextScript: () => scriptAdded.promise,
    exposeBinding: async (_name: string, binding: Binding) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error("binding failed");
      }
      context.bindings += 1;
      context.binding = binding;
    },
    addInitScript: async (script: { content: string }) => {
      const disposed = Promise.withResolvers<void>();
      scripts.push({ content: script.content, disposed: disposed.promise });
      scriptAdded.resolve();
      scriptAdded = Promise.withResolvers<void>();
      return { dispose: async () => disposed.resolve() };
    },
    once: () => context,
  };
  return context;
};

/** A fake page whose top frame records what the host pushes to it. */
const makePage = (url: string, opener: unknown = null) => {
  let pushed = Promise.withResolvers<unknown>();
  const closeListeners: Array<() => void> = [];
  const listening = Promise.withResolvers<void>();
  const frame = {
    url: () => url,
    evaluate: async (_fn: unknown, argument: readonly [string, unknown]) => {
      pushed.resolve(argument);
      pushed = Promise.withResolvers<unknown>();
    },
  };
  const page = {
    frame,
    iframe: { url: () => url, evaluate: async () => undefined },
    nextPush: () => pushed.promise,
    /** Settles once something waits for the page to close. */
    closeWatched: listening.promise,
    mainFrame: () => frame,
    isClosed: () => false,
    opener: async () => opener,
    once: (event: string, listener: () => void) => {
      if (event === "close") {
        closeListeners.push(listener);
        listening.resolve();
      }
      return page;
    },
    close: () => {
      for (const listener of closeListeners) listener();
    },
  };
  return page;
};

const asContext = (context: ReturnType<typeof makeContext>) => context as unknown as BrowserContext;
const asPage = (page: ReturnType<typeof makePage>) => page as unknown as Page;

/** The adapter over a wallet whose page state the test controls. */
const withAdapter = (initial: Web3PageState) =>
  Effect.gen(function* () {
    const state = yield* SubscriptionRef.make(initial);
    const requests: Array<{ key: ServerPreviewWallet.WalletTabKey; input: unknown }> = [];
    const documents: Array<string> = [];
    const wallet = ServerPreviewWallet.ServerPreviewWallet.of({
      ready: Effect.void,
      changes: Stream.empty,
      statusFor: () => Effect.die("unused"),
      configure: () => Effect.die("unused"),
      approve: () => Effect.die("unused"),
      reject: () => Effect.die("unused"),
      page: SubscriptionRef.changes(state),
      pageState: SubscriptionRef.get(state),
      request: (key, input) =>
        Effect.sync(() => {
          requests.push({ key, input });
          return { ok: true as const, result: "answered" };
        }),
      openDocument: (_key, documentId) => Effect.sync(() => void documents.push(documentId)),
      noteAgentActivity: () => Effect.void,
      clearAgentActivity: () => Effect.void,
    });
    const adapter = yield* ServerBrowserWallet.make.pipe(
      Effect.provideService(ServerPreviewWallet.ServerPreviewWallet, wallet),
    );
    return {
      adapter,
      requests,
      documents,
      setState: (next: Web3PageState) => SubscriptionRef.set(state, next),
    };
  });

it.effect("prepares a context once, and only gives it the provider while the wallet is on", () =>
  Effect.gen(function* () {
    const { adapter, setState } = yield* withAdapter(enabledState);
    const context = makeContext();
    yield* Effect.promise(() =>
      Promise.all([adapter.prepare(asContext(context)), adapter.prepare(asContext(context))]),
    );
    expect(context.bindings).toBe(1);
    expect(context.scripts).toHaveLength(1);
    expect(context.scripts[0]!.content).toContain('"chainId":"0x7a69"');
    // The script carries no account; a page gets those for its own origin.
    expect(context.scripts[0]!.content).not.toContain(ACCOUNT);

    yield* setState({ ...enabledState, enabled: false });
    yield* Effect.promise(() => context.scripts[0]!.disposed);
    const added = context.nextScript();
    yield* setState({ ...enabledState, chainId: "0x1" });
    yield* Effect.promise(() => added);
    expect(context.scripts.at(-1)!.content).toContain('"chainId":"0x1"');
  }).pipe(Effect.scoped),
);

it.effect("retries a preparation that failed", () =>
  Effect.gen(function* () {
    const { adapter } = yield* withAdapter(enabledState);
    const context = makeContext(true);
    const failed = yield* Effect.promise(() =>
      adapter.prepare(asContext(context)).then(
        () => "prepared",
        () => "failed",
      ),
    );
    expect(failed).toBe("failed");
    yield* Effect.promise(() => adapter.prepare(asContext(context)));
    expect(context.bindings).toBe(1);
  }).pipe(Effect.scoped),
);

it.effect("answers only a registered tab's top frame, with the origin the browser reports", () =>
  Effect.gen(function* () {
    const { adapter, requests } = yield* withAdapter(enabledState);
    const context = makeContext();
    yield* Effect.promise(() => adapter.prepare(asContext(context)));
    const page = makePage(`${ORIGIN}/swap`);
    const stranger = makePage(`${ORIGIN}/other`);
    adapter.register(asPage(page), KEY);
    const call = (source: unknown, payload: unknown) =>
      Effect.promise(() => context.binding!(source, payload));
    const payload = {
      kind: "request",
      documentId: "document-1",
      method: "personal_sign",
      params: ["0x68656c6c6f"],
      origin: "https://spoofed.example",
    };

    expect(yield* call({ page: stranger, frame: stranger.frame }, payload)).toMatchObject({
      ok: false,
      code: 4100,
    });
    expect(yield* call({ page, frame: page.iframe }, payload)).toMatchObject({
      ok: false,
      code: 4100,
    });
    expect(yield* call({ page, frame: page.frame }, payload)).toEqual({
      ok: true,
      result: "answered",
    });
    expect(requests).toEqual([
      {
        key: KEY,
        input: {
          documentId: "document-1",
          origin: ORIGIN,
          method: "personal_sign",
          params: ["0x68656c6c6f"],
        },
      },
    ]);
    const blank = makePage("about:blank");
    adapter.register(asPage(blank), { threadId: "thread-1", tabId: "tab-2" });
    expect(yield* call({ page: blank, frame: blank.frame }, payload)).toMatchObject({
      ok: false,
      code: 4100,
    });
  }).pipe(Effect.scoped),
);

it.effect("starts a granted page connected, then sends it only what changed", () =>
  Effect.gen(function* () {
    const { adapter, documents, setState } = yield* withAdapter(enabledState);
    const context = makeContext();
    yield* Effect.promise(() => adapter.prepare(asContext(context)));
    const page = makePage(`${ORIGIN}/app`);
    adapter.register(asPage(page), KEY);

    const bootstrap = yield* Effect.promise(() =>
      context.binding!(
        { page, frame: page.frame },
        { kind: "bootstrap", documentId: "document-1", chainId: "0x7a69" },
      ),
    );
    expect(bootstrap).toEqual({ accounts: [ACCOUNT], events: [] });
    expect(documents).toEqual(["document-1"]);

    const pushed = page.nextPush();
    yield* setState({ ...enabledState, connectedOrigins: [] });
    expect(yield* Effect.promise(() => pushed)).toEqual([
      "__vetraPreviewWalletEmit",
      [{ event: "accountsChanged", payload: [] }],
    ]);
  }).pipe(Effect.scoped),
);

it.effect("holds a popup's first call until the popup becomes a tab", () =>
  Effect.gen(function* () {
    const { adapter, requests } = yield* withAdapter(enabledState);
    const context = makeContext();
    yield* Effect.promise(() => adapter.prepare(asContext(context)));
    const opener = makePage(`${ORIGIN}/app`);
    adapter.register(asPage(opener), KEY);
    const callFrom = (page: ReturnType<typeof makePage>) =>
      context.binding!(
        { page, frame: page.frame },
        { kind: "request", documentId: "popup-doc", method: "eth_accounts" },
      );
    for (const [name, registerWhileWaiting] of [
      ["popup-waiting", true],
      ["popup-quick", false],
    ] as const) {
      const popup = makePage(`${ORIGIN}/${name}`, opener);
      const answered = callFrom(popup);
      if (registerWhileWaiting) yield* Effect.promise(() => popup.closeWatched);
      const popupKey = { threadId: "thread-1", tabId: name };
      adapter.register(asPage(popup), popupKey);
      expect(yield* Effect.promise(() => answered)).toEqual({ ok: true, result: "answered" });
      expect(requests.at(-1)?.key).toEqual(popupKey);
    }

    // A popup that closes before it becomes a tab is refused.
    const closing = makePage(`${ORIGIN}/closing`, opener);
    const refused = callFrom(closing);
    yield* Effect.promise(() => closing.closeWatched);
    closing.close();
    expect(yield* Effect.promise(() => refused)).toMatchObject({ ok: false, code: 4100 });
  }).pipe(Effect.scoped),
);
