// @effect-diagnostics nodeBuiltinImport:off - Stands in for an Electron debugger.
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, expect, it } from "@effect/vitest";
import { DesktopBrowserEvent } from "@t3tools/contracts";
import { EMPTY_KEYSTORE, readKeystore, writeKeystore } from "@t3tools/web3/keystore";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as NodeEvents from "node:events";

import * as DesktopConfig from "../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";

const decodeEvent = Schema.decodeUnknownSync(Schema.fromJsonString(DesktopBrowserEvent));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeCdpReply = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ id: Schema.Number })),
);
const key = { threadId: "thread-1", tabId: "tab-1" };
const NO_KEYSTORE = { type: "walletKeystoreOffer", keystore: null };
const NOT_CONNECTED = { ok: false, code: 4900, message: "The preview wallet is not connected." };
const pageRequest = {
  ...key,
  documentId: "document-1",
  origin: "http://localhost:5173",
  method: "eth_accounts",
  params: [],
};

/** A tab's webContents and debugger, with the debugger's commands left pending until released. */
const makeDebuggee = () => {
  const emitter = new NodeEvents.EventEmitter();
  const pending: Array<() => void> = [];
  const debuggee = Object.assign(emitter, {
    sendCommand: (method: string) =>
      new Promise((resolve) => {
        if (method === "Target.getTargetInfo") {
          resolve({ targetInfo: { targetId: "GUEST" } });
          return;
        }
        pending.push(() => resolve({ method }));
      }),
  });
  const webContents = {
    getURL: () => "http://localhost/",
    getTitle: () => "Page",
    getUserAgent: () => "Electron",
  };
  return {
    tab: {
      webContents: webContents as unknown as Electron.WebContents,
      debugger: debuggee as unknown as Electron.Debugger,
    },
    emit: (method: string, params: unknown) => emitter.emit("message", {}, method, params, ""),
    release: () => pending.splice(0).forEach((resolve) => resolve()),
  };
};

/** Reads `count` events from one backend's subscription. */
const takeEvents = (host: DesktopBrowserHost.DesktopBrowserHost["Service"], count: number) =>
  host.events.pipe(
    Stream.take(count),
    Stream.runCollect,
    Effect.map((lines) => lines.map((line) => decodeEvent(new TextDecoder().decode(line)))),
  );

/** Runs one backend's subscription in the background, its events queued as they arrive. */
const startRun = (events: Stream.Stream<Uint8Array>) =>
  Effect.gen(function* () {
    const received = yield* Queue.unbounded<DesktopBrowserEvent>();
    yield* events.pipe(
      Stream.runForEach((line) =>
        Queue.offer(received, decodeEvent(new TextDecoder().decode(line))),
      ),
      Effect.forkScoped,
    );
    return received;
  });

/** A host whose desktop state lives in a fresh temp directory, never the developer's. */
const withHost = <A, E>(
  use: (
    host: DesktopBrowserHost.DesktopBrowserHost["Service"],
    previewWalletsDir: string,
  ) => Effect.Effect<A, E, NodeServices.NodeServices | Scope.Scope>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const home = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vetra-browser-host-" });
    const layerEnvironment = DesktopEnvironment.layer({
      dirname: "/repo/apps/desktop/src",
      homeDirectory: home,
      platform: "darwin",
      processArch: "x64",
      appVersion: "0.0.0",
      appPath: "/repo",
      isPackaged: true,
      resourcesPath: "/missing/resources",
      runningUnderArm64Translation: false,
    }).pipe(
      Layer.provide(
        Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest({ VETRA_HOME: home })),
      ),
    );
    return yield* Effect.gen(function* () {
      const environment = yield* DesktopEnvironment.DesktopEnvironment;
      const host = yield* DesktopBrowserHost.make;
      return yield* use(host, environment.previewWalletsDir);
    }).pipe(Effect.provide(layerEnvironment));
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("DesktopBrowserHost", () => {
  it.effect("announces tabs already attached to a backend that starts later", () =>
    withHost((host) =>
      Effect.gen(function* () {
        host.attach(key, makeDebuggee().tab);
        // A restarted backend subscribes after the attach and still hears it.
        expect(yield* takeEvents(host, 2)).toEqual([NO_KEYSTORE, { type: "attached", ...key }]);
        expect(yield* takeEvents(host, 2)).toEqual([NO_KEYSTORE, { type: "attached", ...key }]);
      }),
    ),
  );

  it.effect("drops replies from a relay the server released", () =>
    withHost((host) =>
      Effect.gen(function* () {
        const debuggee = makeDebuggee();
        host.attach(key, debuggee.tab);
        const reader = yield* takeEvents(host, 3).pipe(Effect.forkScoped);
        // Wait until the reader has received the announcement.
        yield* Effect.yieldNow;
        const command = (id: number, method: string) =>
          host.handleCommandLine(
            encodeJson({
              type: "cdp",
              ...key,
              message: encodeJson({ id, method, sessionId: "t3-preview-page" }),
            }),
          );
        yield* command(1, "Page.captureScreenshot");
        yield* host.handleCommandLine(encodeJson({ type: "release", ...key }));
        yield* command(2, "DOM.enable");
        debuggee.release();
        yield* Effect.promise(() => new Promise((resolve) => setImmediate(resolve)));
        const [, , reply] = yield* Fiber.join(reader);
        // Only the new connection's reply arrives; the old one's id could collide.
        expect(reply).toMatchObject({ type: "cdp" });
        expect(decodeCdpReply((reply as { message: string }).message).id).toBe(2);
      }),
    ),
  );

  it.effect("saves a server tab's download under its CDP guid where the server asked", () =>
    withHost((host) =>
      Effect.gen(function* () {
        const debuggee = makeDebuggee();
        host.attach(key, debuggee.tab);
        const paths: Array<string> = [];
        const item = {
          setSavePath: (path: string) => void paths.push(path),
        } as unknown as Electron.DownloadItem;
        // Before the server sets a directory, Electron keeps its own handling.
        expect(host.placeDownload(debuggee.tab.webContents, item)).toBe(false);
        yield* host.handleCommandLine(
          encodeJson({
            type: "cdp",
            ...key,
            message: encodeJson({
              id: 1,
              method: "Browser.setDownloadBehavior",
              params: { behavior: "allowAndName", downloadPath: "/srv/downloads" },
            }),
          }),
        );
        debuggee.emit("Browser.downloadWillBegin", { guid: "guid-1", suggestedFilename: "r.csv" });
        expect(host.placeDownload(debuggee.tab.webContents, item)).toBe(true);
        expect(paths).toEqual(["/srv/downloads/guid-1"]);
      }),
    ),
  );

  it.effect("forwards a page's wallet call to the server and hands back its reply", () =>
    withHost((host) =>
      Effect.gen(function* () {
        const received = yield* startRun(host.events);
        expect(yield* Queue.take(received)).toEqual(NO_KEYSTORE);

        const reply = yield* host.walletRequest(pageRequest).pipe(Effect.forkScoped);
        const request = yield* Queue.take(received);
        assert(request.type === "walletRequest");
        expect(request).toMatchObject({ type: "walletRequest", ...pageRequest });
        yield* host.handleCommandLine(
          encodeJson({
            type: "walletReply",
            requestId: request.requestId,
            reply: { ok: true, result: ["0x00000000000000000000000000000000000000aa"] },
          }),
        );

        expect(yield* Fiber.join(reply)).toEqual({
          ok: true,
          result: ["0x00000000000000000000000000000000000000aa"],
        });
      }),
    ),
  );

  it.effect("answers 4900 for a wallet call no run is left to answer", () =>
    withHost((host) =>
      Effect.gen(function* () {
        expect(yield* host.walletRequest(pageRequest)).toEqual(NOT_CONNECTED);

        // This run ends right after it hands the server the request.
        const received = yield* startRun(host.events.pipe(Stream.take(2)));
        expect(yield* Queue.take(received)).toEqual(NO_KEYSTORE);
        const state = {
          enabled: true,
          uuid: "wallet-1",
          chainId: "0x7a69",
          accounts: [],
          connectedOrigins: [],
        };
        yield* host.handleCommandLine(encodeJson({ type: "walletState", state }));
        expect(host.walletState()).toEqual(state);

        const reply = yield* host.walletRequest(pageRequest).pipe(Effect.forkScoped);
        expect((yield* Queue.take(received)).type).toBe("walletRequest");
        expect(yield* Fiber.join(reply)).toEqual(NOT_CONNECTED);
        // Pages see the wallet gone until the next run says otherwise.
        expect(host.walletState()).toBeNull();
      }),
    ),
  );

  it.effect("offers the desktop's old keystore each run until the server takes it", () =>
    withHost((host, previewWalletsDir) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const keystorePath = path.join(previewWalletsDir, "shared.json");
        const keystore = {
          ...EMPTY_KEYSTORE,
          mnemonic: "test test test test test test test test test test test junk",
        };
        yield* writeKeystore({ keystorePath, keystore });
        yield* fileSystem.writeFileString(`${keystorePath}.migrated`, "an earlier copy");
        const offer = { type: "walletKeystoreOffer", keystore };
        host.attach(key, makeDebuggee().tab);

        expect(yield* takeEvents(host, 2)).toEqual([offer, { type: "attached", ...key }]);
        // Unclaimed, it stays where it was for the next run.
        expect(yield* takeEvents(host, 1)).toEqual([offer]);

        yield* host.handleCommandLine(encodeJson({ type: "walletKeystoreAccepted" }));
        expect(yield* fileSystem.exists(keystorePath)).toBe(false);
        expect(yield* fileSystem.readFileString(`${keystorePath}.migrated`)).toBe(
          "an earlier copy",
        );
        expect(yield* readKeystore(`${keystorePath}.migrated.1`)).toEqual(keystore);
        expect(yield* takeEvents(host, 1)).toEqual([NO_KEYSTORE]);
      }),
    ),
  );

  it.effect("offers nothing from a keystore it cannot read, and leaves it in place", () =>
    withHost((host, previewWalletsDir) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const keystorePath = path.join(previewWalletsDir, "shared.json");
        yield* fileSystem.makeDirectory(previewWalletsDir, { recursive: true });
        yield* fileSystem.writeFileString(keystorePath, "{ not a keystore");

        expect(yield* takeEvents(host, 1)).toEqual([NO_KEYSTORE]);
        expect(yield* fileSystem.readFileString(keystorePath)).toBe("{ not a keystore");
      }),
    ),
  );

  it.effect("tells a download the person clicked from one the agent's input started", () =>
    withHost((host) =>
      Effect.gen(function* () {
        const debuggee = makeDebuggee();
        host.attach(key, debuggee.tab);
        // Reading the page is not acting on it.
        yield* host.handleCommandLine(
          encodeJson({
            type: "cdp",
            ...key,
            message: encodeJson({ id: 1, method: "DOM.getDocument", params: {} }),
          }),
        );
        expect(host.humanStartedDownload(debuggee.tab.webContents)).toBe(true);
        yield* host.handleCommandLine(
          encodeJson({
            type: "cdp",
            ...key,
            message: encodeJson({
              id: 2,
              method: "Input.dispatchMouseEvent",
              params: { type: "mousePressed", x: 1, y: 1 },
            }),
          }),
        );
        expect(host.humanStartedDownload(debuggee.tab.webContents)).toBe(false);
      }),
    ),
  );
});
