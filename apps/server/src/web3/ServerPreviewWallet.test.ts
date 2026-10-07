// @effect-diagnostics nodeBuiltinImport:off - The test desktop holds the far ends of real pipes.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeStream from "@effect/platform-node/NodeStream";
import { describe, expect, it } from "@effect/vitest";
import {
  DesktopBrowserCommand,
  DesktopBrowserEvent,
  ThreadId,
  type PreviewWalletStatus,
  type ServerSettings,
} from "@t3tools/contracts";
import { deriveMnemonicAccounts, generateWalletMnemonic } from "@t3tools/web3/signer";
import { EMPTY_KEYSTORE } from "@t3tools/web3/keystore";
import type { Web3KeystoreFile } from "@t3tools/web3/schema";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as Ndjson from "effect/encoding/Ndjson";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as DesktopBrowserChannel from "../preview/DesktopBrowserChannel.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as ServerSettingsModule from "../serverSettings.ts";
import * as ServerPreviewWallet from "./ServerPreviewWallet.ts";

const THREAD = ThreadId.make("thread-wallet");
const ORIGIN = "http://localhost:5173";

const decodeCall = Schema.decodeSync(
  Schema.fromJsonString(Schema.Struct({ method: Schema.String })),
);
const readBody = (body: HttpBody.HttpBody) =>
  body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "{}";

/** A local node on the chain whose `eth_chainId` is `chainId`. */
const localNode = (chainId: string) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const call = decodeCall(readBody(request.body));
        const result = call.method === "eth_chainId" ? chainId : null;
        return HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result })),
        );
      }),
    ),
  );

/** Test settings that announce their changes, as the real service does. */
const announcingSettings = (enabled: boolean) =>
  Layer.effect(
    ServerSettingsModule.ServerSettingsService,
    Effect.gen(function* () {
      const base = yield* ServerSettingsModule.ServerSettingsService;
      const changes = yield* PubSub.unbounded<ServerSettings>();
      return ServerSettingsModule.ServerSettingsService.of({
        ...base,
        updateSettings: (patch) =>
          base.updateSettings(patch).pipe(Effect.tap((next) => PubSub.publish(changes, next))),
        subscribeChanges: PubSub.subscribe(changes).pipe(Effect.map(Stream.fromSubscription)),
      });
    }),
  ).pipe(Layer.provide(ServerSettingsModule.layerTest({ web3Wallet: { enabled } })));

const encodeEvent = Schema.encodeSync(Schema.fromJsonString(DesktopBrowserEvent));
const decodeCommand = Schema.decodeUnknownEffect(DesktopBrowserCommand);

/**
 * The desktop app at the far end of the two pipes it hands the server it
 * starts, so every message crosses the real channel and the contract.
 */
interface Desktop {
  readonly fds: {
    readonly desktopBrowserFd: number;
    readonly desktopBrowserControlFd: number;
  };
  readonly send: (event: DesktopBrowserChannel.DesktopWalletEvent) => Effect.Effect<void>;
  /** Each line the server wrote, decoded as the desktop decodes it. */
  readonly commands: Queue.Queue<DesktopBrowserCommand>;
}

const openFd = (path: string, flags: string) =>
  new Promise<number>((resolve, reject) =>
    NodeFS.open(path, flags, (error, fd) => (error ? reject(error) : resolve(fd))),
  );

/** A pipe's two blocking ends; each end's open waits for the other. */
const pipe = (path: string) =>
  Effect.promise(() => {
    NodeChildProcess.execFileSync("mkfifo", [path]);
    return Promise.all([openFd(path, "r"), openFd(path, "w")]);
  });

/** Made before the server it serves, so the server's finalizers run first. */
const makeDesktop = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-wallet-pipes-" });
  const [eventsIn, eventsOut] = yield* pipe(path.join(directory, "events"));
  const [commandsIn, commandsOut] = yield* pipe(path.join(directory, "commands"));
  // Closing the desktop's ends is what ends the server's read and this one.
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      NodeFS.closeSync(eventsOut);
      NodeFS.closeSync(commandsOut);
    }),
  );
  const commands = yield* Queue.unbounded<DesktopBrowserCommand>();
  yield* NodeStream.fromReadable<Uint8Array, Error>({
    // A socket over the pipe waits without holding one of libuv's file threads.
    evaluate: () => new NodeNet.Socket({ fd: commandsIn, readable: true, writable: false }),
    onError: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  }).pipe(
    Stream.pipeThroughChannel(Ndjson.decode({ ignoreEmptyLines: true })),
    Stream.mapEffect((line) => decodeCommand(line)),
    Stream.runForEach((command) => Queue.offer(commands, command)),
    Effect.forkScoped,
  );
  return {
    fds: { desktopBrowserFd: eventsIn, desktopBrowserControlFd: commandsOut },
    send: (event) => Effect.sync(() => NodeFS.writeSync(eventsOut, `${encodeEvent(event)}\n`)),
    commands,
  } satisfies Desktop;
});

/** One server run over `stateDir`; a second call over the same directory is a restart. */
const startWallet = (input: {
  readonly stateDir: string;
  readonly enabled: boolean;
  readonly desktop?: Desktop;
  readonly chainId?: string;
}) =>
  Effect.gen(function* () {
    const desktopFds = input.desktop?.fds;
    const config = ServerConfig.layerTest(process.cwd(), input.stateDir);
    const context = yield* Layer.build(
      ServerPreviewWallet.layer.pipe(
        Layer.provideMerge(
          Layer.mergeAll(
            ServerSecretStore.layer,
            announcingSettings(input.enabled),
            DesktopBrowserChannel.layer,
            PreviewManager.layer,
            localNode(input.chainId ?? "0x7a69"),
          ),
        ),
        Layer.provideMerge(
          desktopFds === undefined
            ? config
            : Layer.effect(
                ServerConfig.ServerConfig,
                ServerConfig.ServerConfig.pipe(Effect.map((base) => ({ ...base, ...desktopFds }))),
              ).pipe(Layer.provide(config)),
        ),
      ),
    );
    return {
      wallet: Context.get(context, ServerPreviewWallet.ServerPreviewWallet),
      manager: Context.get(context, PreviewManager.PreviewManager),
      settings: Context.get(context, ServerSettingsModule.ServerSettingsService),
      config: Context.get(context, ServerConfig.ServerConfig),
    };
  });

const untilStatus = (
  wallet: ServerPreviewWallet.ServerPreviewWallet["Service"],
  matches: (status: PreviewWalletStatus) => boolean,
) =>
  wallet.changes.pipe(
    Stream.filter(matches),
    Stream.runHead,
    Effect.map((status) => Option.getOrThrow(status)),
  );

const freshKeystore = Effect.gen(function* () {
  const mnemonic = generateWalletMnemonic();
  const accounts = yield* deriveMnemonicAccounts(mnemonic, 2);
  return {
    ...EMPTY_KEYSTORE,
    mnemonic,
    accounts,
    selectedAddress: accounts[0]!.address,
    connectedOrigins: [ORIGIN],
  } satisfies Web3KeystoreFile;
});

/** The next command of a type, skipping state pushes the test is not about. */
const nextCommand = <T extends DesktopBrowserCommand["type"]>(desktop: Desktop, type: T) =>
  Stream.fromQueue(desktop.commands).pipe(
    Stream.filter(
      (command): command is Extract<DesktopBrowserCommand, { type: T }> => command.type === type,
    ),
    Stream.runHead,
    Effect.map((command) => Option.getOrThrow(command)),
  );

describe("ServerPreviewWallet", () => {
  it.effect("stays off and keyless until enabled, then keeps its keys in one secret", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-wallet-custody-" });
      const first = yield* startWallet({ stateDir, enabled: false });
      const secretPath = path.join(first.config.secretsDir, "preview-wallet-v1.bin");

      yield* first.wallet.ready;
      expect((yield* untilStatus(first.wallet, () => true)).enabled).toBe(false);
      expect(yield* fs.exists(secretPath)).toBe(false);

      yield* first.settings.updateSettings({ web3Wallet: { enabled: true } });
      const enabled = yield* untilStatus(first.wallet, (status) => status.accounts.length > 0);
      expect(enabled.accounts).toHaveLength(3);
      expect(enabled.chain?.chainId).toBe(31337);
      expect(((yield* fs.stat(secretPath)).mode & 0o777).toString(8)).toBe("600");
      const stored = yield* fs.readFileString(secretPath);
      const mnemonic = (JSON.parse(stored) as Web3KeystoreFile).mnemonic!;
      // Clients and pages see addresses, never the keys behind them.
      expect(JSON.stringify(enabled)).not.toContain(mnemonic);
      expect(JSON.stringify(yield* first.wallet.pageState)).not.toContain(mnemonic);

      const restarted = yield* startWallet({ stateDir, enabled: true });
      const again = yield* untilStatus(restarted.wallet, (status) => status.accounts.length > 0);
      expect(again.accounts).toEqual(enabled.accounts);
      expect(yield* fs.readFileString(secretPath)).toBe(stored);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("never replaces a stored wallet it cannot read", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-wallet-corrupt-" });
      const { config } = yield* startWallet({ stateDir, enabled: false });
      const secretPath = path.join(config.secretsDir, "preview-wallet-v1.bin");
      yield* fs.writeFileString(secretPath, "not a keystore");

      const restarted = yield* startWallet({ stateDir, enabled: true });
      yield* restarted.wallet.ready;
      const status = yield* untilStatus(restarted.wallet, (current) => current.enabled);
      expect(status.accounts).toEqual([]);
      const failure = yield* restarted.wallet
        .configure({ generateAccount: true })
        .pipe(Effect.flip);
      expect(failure._tag).toBe("PreviewWalletKeystoreError");
      expect(yield* fs.readFileString(secretPath)).toBe("not a keystore");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("answers a tab's prompts when its preview session closes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-wallet-close-" });
      const { wallet, manager } = yield* startWallet({ stateDir, enabled: true });
      yield* wallet.ready;
      const tab = yield* manager.open({ threadId: THREAD, runtime: "server" });
      // No agent acts on this tab, so the signature waits for a person.
      const page = yield* wallet
        .request(
          { threadId: THREAD, tabId: tab.tabId },
          { documentId: "d", origin: ORIGIN, method: "personal_sign", params: ["0x68656c6c6f"] },
        )
        .pipe(Effect.forkScoped);
      yield* untilStatus(wallet, (status) => status.pendingRequests.length === 1);
      yield* manager.close({ threadId: THREAD, tabId: tab.tabId });
      expect(yield* Fiber.join(page)).toMatchObject({ ok: false, code: 4900 });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("signs for the desktop's pages and refuses tabs that are not this server's", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-wallet-desktop-" });
      const desktop = yield* makeDesktop;
      yield* desktop.send({ type: "walletKeystoreOffer", keystore: null });
      // Mainnet, whose id is odd-length hex: `0x1`, as `eth_chainId` writes it.
      const { wallet, manager } = yield* startWallet({
        stateDir,
        enabled: true,
        desktop,
        chainId: "0x1",
      });
      yield* wallet.ready;

      // The preload answers its synchronous bootstrap from this push.
      const state = yield* Stream.fromQueue(desktop.commands).pipe(
        Stream.filter((command) => command.type === "walletState" && command.state.enabled),
        Stream.runHead,
        Effect.map(Option.getOrThrow),
      );
      expect(state).toMatchObject({ state: { enabled: true, chainId: "0x1" } });

      const tab = yield* manager.open({ threadId: THREAD, runtime: "server" });
      const ask = (requestId: string, tabId: string) =>
        desktop.send({
          type: "walletRequest",
          requestId,
          threadId: THREAD,
          tabId,
          documentId: "document-1",
          origin: ORIGIN,
          method: "eth_chainId",
          params: [],
        });
      yield* ask("known", tab.tabId);
      expect(yield* nextCommand(desktop, "walletReply")).toEqual({
        type: "walletReply",
        requestId: "known",
        reply: { ok: true, result: "0x1" },
      });
      yield* ask("stranger", "not-a-tab");
      expect(yield* nextCommand(desktop, "walletReply")).toMatchObject({
        requestId: "stranger",
        reply: { ok: false, code: 4100 },
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("adopts the desktop's earlier keys before making its own, and only once", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const stateDir = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-wallet-migrate-" });
      const desktop = yield* makeDesktop;
      const { wallet } = yield* startWallet({ stateDir, enabled: true, desktop });
      // Enabled and keyless, the wallet waits for the desktop instead of generating.
      const waiting = yield* wallet.ready.pipe(Effect.forkScoped);
      const keystore = yield* freshKeystore;
      yield* desktop.send({ type: "walletKeystoreOffer", keystore });
      expect(yield* nextCommand(desktop, "walletKeystoreAccepted")).toEqual({
        type: "walletKeystoreAccepted",
      });
      yield* Fiber.join(waiting);
      const adopted = yield* untilStatus(wallet, (status) => status.accounts.length > 0);
      expect(adopted.accounts).toEqual(keystore.accounts);
      expect(adopted.connectedOrigins).toEqual([ORIGIN]);

      // A later run offers again; the server already has a wallet and keeps it.
      const nextRun = yield* makeDesktop;
      const restarted = yield* startWallet({ stateDir, enabled: true, desktop: nextRun });
      yield* nextRun.send({ type: "walletKeystoreOffer", keystore: yield* freshKeystore });
      yield* nextRun.send({
        type: "walletRequest",
        requestId: "after-offer",
        threadId: THREAD,
        tabId: "no-tab",
        documentId: "d",
        origin: ORIGIN,
        method: "eth_chainId",
        params: [],
      });
      // Events are handled in order, so the offer is settled once this reply arrives.
      const answered = yield* Stream.fromQueue(nextRun.commands).pipe(
        Stream.takeUntil((command) => command.type === "walletReply"),
        Stream.runCollect,
      );
      expect(answered.map((command) => command.type)).not.toContain("walletKeystoreAccepted");
      const kept = yield* untilStatus(restarted.wallet, (status) => status.accounts.length > 0);
      expect(kept.accounts).toEqual(keystore.accounts);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
