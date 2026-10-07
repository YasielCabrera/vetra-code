// @effect-diagnostics nodeBuiltinImport:off - The channel reads real file descriptors.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as DesktopBrowserChannel from "./DesktopBrowserChannel.ts";

const key = { threadId: "thread-1", tabId: "tab-1" };

/** The channel over two files: what the desktop sent, and where commands go. */
const channelOver = (events: ReadonlyArray<Record<string, unknown>>) =>
  Effect.gen(function* () {
    const directory = yield* Effect.acquireRelease(
      Effect.sync(() =>
        NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-browser-channel-")),
      ),
      (directory) => Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
    );
    const inbound = NodePath.join(directory, "events.ndjson");
    NodeFS.writeFileSync(inbound, events.map((event) => `${JSON.stringify(event)}\n`).join(""));
    const control = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.openSync(NodePath.join(directory, "commands.ndjson"), "w")),
      (fd) => Effect.sync(() => NodeFS.closeSync(fd)),
    );
    const base = yield* ServerConfig.ServerConfig.pipe(
      Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-desktop-browser-" })),
    );
    const config = Layer.succeed(ServerConfig.ServerConfig, {
      ...base,
      desktopBrowserFd: NodeFS.openSync(inbound, "r"),
      desktopBrowserControlFd: control,
    });
    // Built in the caller's scope, so the channel outlives this setup.
    const context = yield* Layer.build(DesktopBrowserChannel.layer.pipe(Layer.provide(config)));
    return Context.get(context, DesktopBrowserChannel.DesktopBrowserChannel);
  });

const openFd = (path: string, flags: string) =>
  new Promise<number>((resolve, reject) =>
    NodeFS.open(path, flags, (error, fd) => (error ? reject(error) : resolve(fd))),
  );

/** A pipe's two blocking ends, like the descriptors the desktop hands the server it starts. */
const pipe = (path: string) =>
  Effect.promise(() => {
    NodeChildProcess.execFileSync("mkfifo", [path]);
    // Each end's open waits for the other.
    return Promise.all([openFd(path, "r"), openFd(path, "w")]);
  });

/** The channel over two live pipes, with the test playing the desktop at their other ends. */
const channelWithDesktop = Effect.gen(function* () {
  const directory = yield* Effect.acquireRelease(
    Effect.sync(() =>
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-desktop-browser-channel-")),
    ),
    (directory) => Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
  );
  const [eventsIn, eventsOut] = yield* pipe(NodePath.join(directory, "events"));
  const [commandsIn, commandsOut] = yield* pipe(NodePath.join(directory, "commands"));
  // Closing the desktop's end is what ends the server's read, so it closes last.
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      NodeFS.closeSync(eventsOut);
      NodeFS.closeSync(commandsIn);
      NodeFS.closeSync(commandsOut);
    }),
  );
  const base = yield* ServerConfig.ServerConfig.pipe(
    Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-desktop-browser-" })),
  );
  const config = Layer.succeed(ServerConfig.ServerConfig, {
    ...base,
    desktopBrowserFd: eventsIn,
    desktopBrowserControlFd: commandsOut,
  });
  const context = yield* Layer.build(DesktopBrowserChannel.layer.pipe(Layer.provide(config)));
  return {
    channel: Context.get(context, DesktopBrowserChannel.DesktopBrowserChannel),
    /** The next command the server wrote; each is far below the pipe's atomic write size. */
    nextCommand: Effect.promise(
      () =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const buffer = Buffer.alloc(64 * 1024);
          NodeFS.read(commandsIn, buffer, 0, buffer.length, null, (error, bytes) =>
            error ? reject(error) : resolve(JSON.parse(buffer.subarray(0, bytes).toString())),
          );
        }),
    ),
  };
});

it.layer(NodeServices.layer)("DesktopBrowserChannel", (it) => {
  it.effect("refuses an endpoint for a tab that is no longer attached", () =>
    Effect.gen(function* () {
      const channel = yield* channelOver([
        { type: "attached", ...key },
        { type: "detached", ...key },
      ]);
      // Whether or not the reader has reached these lines yet, the tab is not attached.
      const exit = yield* Effect.exit(Effect.scoped(channel.endpoint(key)));
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.scoped),
  );

  it.effect("keeps the desktop's wallet messages from before anything reads them", () =>
    Effect.gen(function* () {
      const request = {
        type: "walletRequest",
        requestId: "request-1",
        ...key,
        documentId: "document-1",
        origin: "http://localhost:5173",
        method: "eth_chainId",
        params: [],
      };
      const channel = yield* channelOver([
        { type: "walletKeystoreOffer", keystore: null },
        { type: "attached", ...key },
        request,
      ]);
      const events = yield* channel.walletEvents.pipe(Stream.take(2), Stream.runCollect);
      expect(Array.from(events)).toEqual([
        { type: "walletKeystoreOffer", keystore: null },
        request,
      ]);
    }).pipe(Effect.scoped),
  );

  it.effect("writes the wallet's answers to the desktop", () =>
    Effect.gen(function* () {
      const desktop = yield* channelWithDesktop;
      yield* desktop.channel.walletCommand({
        type: "walletReply",
        requestId: "request-1",
        reply: { ok: false, code: 4001, message: "User rejected the request." },
      });
      expect(yield* desktop.nextCommand).toEqual({
        type: "walletReply",
        requestId: "request-1",
        reply: { ok: false, code: 4001, message: "User rejected the request." },
      });
    }).pipe(Effect.scoped),
  );
});
