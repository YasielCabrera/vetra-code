import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it, vi } from "@effect/vitest";
import { DEFAULT_SERVER_SETTINGS, type TextToSpeechModelState } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/http";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeCrypto from "node:crypto";
import * as NodeModule from "node:module";

import { ServerSettingsService } from "../serverSettings.ts";
import { KOKORO_PLATFORMS } from "./KokoroEngine.ts";
import { makeEngineHost, makeTextToSpeech, type ModelSource } from "./TextToSpeech.ts";

const MODEL = "kokoro-82m";
const encoder = new TextEncoder();
const files = {
  "tokenizer.json": encoder.encode('{"model":{"vocab":{}}}'),
  "voices/af_heart.bin": new Uint8Array(64),
};
const sha256 = (bytes: Uint8Array) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");
const pinned = (corrupt = false): ModelSource => ({
  baseUrl: "https://models.test/kokoro",
  files: Object.entries(files).map(([path, bytes]) => ({
    path,
    bytes: bytes.byteLength,
    sha256: corrupt ? "0".repeat(64) : sha256(bytes),
  })),
});

const makeHarness = Effect.fn("test.makeTextToSpeech")(function* (options: {
  readonly corrupt?: boolean;
  readonly hangDownloads?: boolean;
  readonly crashedDownload?: boolean;
  readonly failLoad?: boolean;
  readonly intelMac?: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const modelsDir = yield* fs.makeTempDirectoryScoped({ prefix: "vetra-tts-test-" });
  if (options.crashedDownload) {
    const staged = path.join(modelsDir, `.install-${MODEL}-crashed`, MODEL);
    yield* fs.makeDirectory(staged, { recursive: true });
    yield* fs.writeFileString(path.join(staged, "tokenizer.json"), "{");
  }
  const synthesized: string[] = [];
  const downloadHung = yield* Deferred.make<void>();
  const tts = yield* makeTextToSpeech({
    modelsDir,
    sources: { [MODEL]: pinned(options.corrupt) },
    loadEngine: async () => {
      if (options.failLoad) throw new Error("onnxruntime could not open the model");
      return {
        synthesize: async (text, _voice, speed) => {
          synthesized.push(`${text} @${speed}`);
          return Float32Array.from([0, 0.5, -1]);
        },
        release: async () => {},
      };
    },
  }).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          const file = request.url.slice(
            "https://models.test/kokoro/".length,
          ) as keyof typeof files;
          const response = HttpClientResponse.fromWeb(request, new Response(null));
          return Object.defineProperty(response, "stream", {
            value: options.hangDownloads
              ? Stream.make(files[file].subarray(0, 1)).pipe(
                  Stream.concat(
                    Stream.fromEffect(Deferred.succeed(downloadHung, undefined)).pipe(Stream.drain),
                  ),
                  Stream.concat(Stream.never),
                )
              : Stream.make(files[file]),
          });
        }),
      ),
    ),
    Effect.provideService(HostProcessPlatform, options.intelMac ? "darwin" : "linux"),
    Effect.provideService(HostProcessArchitecture, "x64"),
    Effect.provide(
      Layer.mock(ServerSettingsService)({
        getSettings: Effect.succeed({
          ...DEFAULT_SERVER_SETTINGS,
          textToSpeech: { enabled: true, model: MODEL, voice: "af_heart", speed: 1.2 },
        }),
      }),
    ),
  );
  return { tts, fs, path, modelsDir, synthesized, downloadHung };
});

const settled = (changes: Stream.Stream<ReadonlyArray<TextToSpeechModelState>>) =>
  changes.pipe(
    Stream.map((all) => all[0]!),
    Stream.filter((state) => state.phase !== "downloading"),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

it.layer(NodeServices.layer)("TextToSpeech", (it) => {
  it.effect("installs a model only after every file matches its pinned hash", () =>
    Effect.gen(function* () {
      const { tts, fs, path, modelsDir } = yield* makeHarness({});
      expect((yield* tts.install(MODEL)).phase).toBe("downloading");
      expect(yield* settled(tts.changes)).toMatchObject({
        phase: "installed",
        downloadedBytes: 86,
      });
      expect(yield* fs.readFileString(path.join(modelsDir, MODEL, "tokenizer.json"))).toBe(
        '{"model":{"vocab":{}}}',
      );
      expect((yield* fs.readDirectory(modelsDir)).filter((entry) => entry.startsWith("."))).toEqual(
        [],
      );

      expect(yield* tts.remove(MODEL)).toMatchObject({ phase: "missing", downloadedBytes: 0 });
      expect(yield* fs.exists(path.join(modelsDir, MODEL))).toBe(false);
    }),
  );

  it.effect("keeps nothing from a download that fails verification", () =>
    Effect.gen(function* () {
      const { tts, fs, path, modelsDir } = yield* makeHarness({ corrupt: true });
      yield* tts.install(MODEL);
      expect(yield* settled(tts.changes)).toMatchObject({
        phase: "failed",
        message: "tokenizer.json failed its size or SHA-256 check. Nothing was installed.",
      });
      expect(yield* fs.exists(path.join(modelsDir, MODEL))).toBe(false);
    }),
  );

  it.effect("clears what a download killed with the process left behind", () =>
    Effect.gen(function* () {
      const { tts, fs, modelsDir } = yield* makeHarness({ crashedDownload: true });
      expect(yield* fs.readDirectory(modelsDir)).toEqual([]);
      expect((yield* settled(tts.changes)).phase).toBe("missing");
    }),
  );

  it.effect("fails a download that stops making progress", () =>
    Effect.gen(function* () {
      const { tts, downloadHung } = yield* makeHarness({ hangDownloads: true });
      yield* tts.install(MODEL);
      yield* Deferred.await(downloadHung);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1 minute");
      expect(yield* settled(tts.changes)).toMatchObject({
        phase: "failed",
        message: "The download stopped making progress. Check your connection, then try again.",
      });
    }),
  );

  it.effect("offers no download on a platform without a runtime", () =>
    Effect.gen(function* () {
      const { tts } = yield* makeHarness({ intelMac: true });
      expect((yield* tts.install(MODEL)).phase).toBe("unsupported");
      const refused = yield* Effect.flip(tts.speak({ text: "Hello." }));
      expect(refused.detail).toBe("Read aloud is not available on this environment's platform.");
    }),
  );

  it.effect("returns to missing when a download is cancelled", () =>
    Effect.gen(function* () {
      const { tts, fs, path, modelsDir } = yield* makeHarness({ hangDownloads: true });
      yield* tts.install(MODEL);
      yield* tts.cancelInstall(MODEL);
      expect(yield* settled(tts.changes)).toMatchObject({
        phase: "missing",
        message: "Download cancelled.",
      });
      expect(yield* fs.exists(path.join(modelsDir, MODEL))).toBe(false);
    }),
  );

  it.effect("streams queued speech once per token and refuses before the model is installed", () =>
    Effect.gen(function* () {
      const { tts, synthesized } = yield* makeHarness({});
      const refused = yield* Effect.exit(tts.speak({ text: "Hello." }));
      expect(Exit.isFailure(refused)).toBe(true);

      yield* tts.install(MODEL);
      yield* settled(tts.changes);
      const speech = yield* tts.speak({
        text: "Done. The build passed and every focused test is green.",
      });
      expect(speech.sampleRate).toBe(24_000);
      const token = speech.url.split("/").at(-1)!;

      const stream = yield* tts.takeSpeech(token);
      const chunks = yield* Stream.runCollect(stream!);
      expect(synthesized).toEqual([
        "Done. @1.2",
        "The build passed and every focused test is green. @1.2",
      ]);
      // Three float samples per chunk become three little-endian 16-bit samples.
      expect(chunks.map((pcm) => [...new Int16Array(pcm.buffer)])).toEqual([
        [0, 16384, -32767],
        [0, 16384, -32767],
      ]);
      expect(yield* tts.takeSpeech(token)).toBeUndefined();
    }),
  );

  it.effect("lists every platform the installed onnxruntime-node ships a runtime for", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const binaries = path.join(
        path.dirname(NodeModule.createRequire(import.meta.url).resolve("onnxruntime-node")),
        "../bin/napi-v6",
      );
      const shipped = yield* Effect.forEach(yield* fs.readDirectory(binaries), (platform) =>
        fs
          .readDirectory(path.join(binaries, platform))
          .pipe(Effect.map((archs) => archs.map((arch) => `${platform}-${arch}`))),
      );
      expect([...KOKORO_PLATFORMS].toSorted()).toEqual(shipped.flat().toSorted());
    }),
  );

  it.effect("reports a model that cannot load instead of starting the stream", () =>
    Effect.gen(function* () {
      const { tts } = yield* makeHarness({ failLoad: true });
      yield* tts.install(MODEL);
      yield* settled(tts.changes);
      const speech = yield* tts.speak({ text: "Hello." });
      const failure = yield* Effect.flip(tts.takeSpeech(speech.url.split("/").at(-1)!));
      expect(failure.detail).toBe("Speech synthesis failed.");
    }),
  );

  it.effect("stops speech that is playing when its model is removed", () =>
    Effect.gen(function* () {
      const { tts, synthesized } = yield* makeHarness({});
      yield* tts.install(MODEL);
      yield* settled(tts.changes);
      const speech = yield* tts.speak({
        text: "Done. The build passed and every focused test is green.",
      });
      const stream = yield* tts.takeSpeech(speech.url.split("/").at(-1)!);
      yield* tts.remove(MODEL);
      const failure = yield* Effect.flip(Stream.runCollect(stream!));
      expect(failure.detail).toBe("The voice model was removed.");
      expect(synthesized).toEqual(["Done. @1.2"]);
    }),
  );
});

describe("makeEngineHost", () => {
  it("keeps the engine loaded until no chunk has been synthesized for the idle window", async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const host = makeEngineHost(async () => {
        events.push("load");
        return {
          synthesize: async () => Float32Array.from([0]),
          release: async () => void events.push("release"),
        };
      }, 1_000);
      await host.synthesize(MODEL, "One.", "af_heart", 1);
      await vi.advanceTimersByTimeAsync(900);
      // A later reply starts just before the previous one's idle window closes.
      await host.synthesize(MODEL, "Two.", "af_heart", 1);
      await vi.advanceTimersByTimeAsync(900);
      await host.synthesize(MODEL, "Three.", "af_heart", 1);
      expect(events).toEqual(["load"]);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(events).toEqual(["load", "release"]);
    } finally {
      vi.useRealTimers();
    }
  });
});
