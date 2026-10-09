// @effect-diagnostics nodeBuiltinImport:off - The channel reads real file descriptors.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as DesktopBrowserChannel from "./DesktopBrowserChannel.ts";

const key = { threadId: "thread-1", tabId: "tab-1" };

it("receives desktop messages and exits while the parent keeps both input pipes open", async () => {
  const child = NodeChildProcess.spawn(
    process.execPath,
    [NodeURL.fileURLToPath(new URL("./testing/DesktopPipeLifecycle.fixture.ts", import.meta.url))],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"] },
  );
  // A failed exit must not leave a test process running. This never fires on success.
  // @effect-diagnostics-next-line globalTimers:off -- Bounds the native subprocess on failure; success waits for process exit.
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 8_000);
  let output = "";
  let errors = "";
  let verified = false;
  child.stderr?.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const write = (fd: number, value: Record<string, unknown>) => {
    const stream = child.stdio[fd];
    if (!stream || !("write" in stream)) throw new Error(`Missing pipe ${fd}`);
    stream.write(`${JSON.stringify(value)}\n`);
  };
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    let end: number;
    while ((end = output.indexOf("\n")) >= 0) {
      const line = output.slice(0, end);
      output = output.slice(end + 1);
      if (line === "ready") {
        write(3, { type: "attached", ...key });
        write(5, { version: 1, type: "desktopTelemetryHello", electronPid: process.pid });
      } else if (line === "attached") {
        write(3, { type: "detached", ...key });
      } else if (line === "verified") {
        verified = true;
      }
    }
  });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    expect(errors).not.toContain("Error");
    expect(verified).toBe(true);
    expect(result).toEqual({ code: 0, signal: null });
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const stream of child.stdio) stream?.destroy();
  }
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
    /** Writes events as the desktop would; each is far below the pipe's atomic write size. */
    send: (events: ReadonlyArray<Record<string, unknown>>) =>
      Effect.sync(() =>
        NodeFS.writeSync(eventsOut, events.map((event) => `${JSON.stringify(event)}\n`).join("")),
      ),
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
      const desktop = yield* channelWithDesktop;
      yield* desktop.send([
        { type: "walletKeystoreOffer", keystore: null },
        { type: "attached", ...key },
        request,
      ]);
      const events = yield* desktop.channel.walletEvents.pipe(Stream.take(2), Stream.runCollect);
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
