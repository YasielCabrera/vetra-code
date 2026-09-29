// @effect-diagnostics nodeBuiltinImport:off - Effect has no incremental digest for streamed downloads.
import {
  type KokoroVoiceId,
  resolveTextToSpeechVoice,
  TEXT_TO_SPEECH_MODELS,
  TextToSpeechError,
  type TextToSpeechModelId,
  type TextToSpeechModelState,
  type TextToSpeechSpeakInput,
  type TextToSpeechSpeech,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { HostProcessArchitecture, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import {
  KOKORO_PLATFORMS,
  KOKORO_SAMPLE_RATE,
  loadKokoroEngine,
  type KokoroEngine,
} from "./KokoroEngine.ts";
import { speechChunks } from "./speechChunks.ts";
import { speechText } from "./speechText.ts";

export const TEXT_TO_SPEECH_ROUTE_PREFIX = "/api/tts/speech";
const SPEECH_TOKEN_TTL_MS = 60_000;
// A loaded Kokoro session holds about 800 MB, so it is dropped between listening sessions.
const ENGINE_IDLE_MS = 5 * 60_000;
// A download fails when the server stops answering, not when a slow link takes long.
const DOWNLOAD_STALL_TIMEOUT = "1 minute";
const FREE_SPACE_MARGIN = 256 * 1_000_000;
const STAGING_PREFIX = ".install-";

export interface ModelFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

const KOKORO_REVISION = "1939ad2a8e416c0acfeecc08a694d14ef25f2231";

// Keyed by the contract's voice ids, so a voice cannot be offered without its file.
const KOKORO_VOICE_SHA256: Readonly<Record<KokoroVoiceId, string>> = {
  af_alloy: "c4a6b876047fd7fb472edf4ebd63cfac7c3b958a7cae7c106e8f038ca6308c45",
  af_aoede: "4a004c33430762e2461eedb2013fad808ef4ab3121f5300f554476caf58d8361",
  af_bella: "f69d836209b78eb8c66e75e3cda491e26ea838a3674257e9d4e5703cbaf55c8b",
  af_heart: "d583ccff3cdca2f7fae535cb998ac07e9fcb90f09737b9a41fa2734ec44a8f0b",
  af_jessica: "a240a5e3c15b43563d6e923bdca8ef5613a23471d9b77653694012435df23bd8",
  af_kore: "9be5221b6a941c04b561959b8ff0b06e809444dcc4ab7e75a7b23606f691819e",
  af_nicole: "cd2191ab31b914ed7b318416b0e4440fdf392ddad9106a060819aa600a64f59a",
  af_nova: "18778272caa0d0eebaea251c35fd635f038434f9eee5e691d02a174bd328414f",
  af_river: "00a2bcf82b1d86e8f19902ede58c65ccf6c0e43b44b7d74fad54e5d8933c9c30",
  af_sarah: "4409fbc125afabacc615d94db5398d847006a737b0247d6892b7a9a0007a2f0a",
  af_sky: "4435255c9744f3f31659e0d714ab7689bf65d9e77ec1cce060f083912614f0b9",
  am_adam: "162b035ed91cfc48b6046982184c645f72edcdd1b82843347f605d7bf7b15716",
  am_echo: "3968b92c3c4cd1c4416dbded36c13eaa388a90d5788d02a13e4d781f5f8cf3c3",
  am_eric: "e8b5be17edd1e3636901ce7598baafe2dc8dd8ff707a0c23bf9e461add7e2832",
  am_fenrir: "c27989f741f7ee34d273a39d8a595cc0837d35f5ced9a29b7cc162614616df43",
  am_liam: "52403be32fd047c6a44517cb0bcd6b134f2a18baa73e70ef41651e0eab921ade",
  am_michael: "1d1f21dd8da39c30705cd4c75d039d265e9bc4a2a93ed09bc9e1b1225eb95ba1",
  am_onyx: "da5d135b424164916d75a68ffb4c2abce3d7d5ccc82dd1ee6cf447ce286145e6",
  am_puck: "fcf73c989033e9233e0b98713eca600c8c74dcc1614b37009d5450ff4a2274a0",
  am_santa: "61150cf726ab6c5ed7a99f90a304f91f5a72c00c592e89ec94e5df11c319227a",
  bf_alice: "08afa6ba24da61ea5e8efa139e5aadc938d83f0a6da5a900adaf763ac1da5573",
  bf_emma: "669fe0647f9dd04fcab92f1439a40eeb4c8b4ab1f82e4996fe3d918ce4a63b73",
  bf_isabella: "3754352c4aaa46d17f27654ab7518d65b62ad6163a0f55a5f4330c2da2c4e94f",
  bf_lily: "5e0ee32ebe64a467124976b14e69590746f1c4ce41a12b587a50c862edfea335",
  bm_daniel: "6b3194bbceffb746733cbc22c8f593dd44e401a71d53895a2dca891bc595a1e8",
  bm_fable: "f889083196807b4adb15e9204252165f503b8d33d3982e681c52443c49d798f1",
  bm_george: "c4b235a4c1f2cd3b939fed08b899ce9385638b763f7b73a59616c4fc9bd6c9bc",
  bm_lewis: "b8f671cef828c30e66fdf0b0756a76bba58f6bb3398cbbf27058642acbcedb97",
};

export interface ModelSource {
  readonly baseUrl: string;
  readonly files: ReadonlyArray<ModelFile>;
}

/** Pinned to one repository revision; every file is checked against its size and SHA-256. */
const MODEL_SOURCES: Readonly<Record<TextToSpeechModelId, ModelSource>> = {
  "kokoro-82m": {
    baseUrl: `https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/${KOKORO_REVISION}`,
    files: [
      {
        path: "config.json",
        bytes: 44,
        sha256: "df34b4f930b23447cd4dc410fabfb42eb3f24e803e6c3f97d618fb359380a36f",
      },
      {
        path: "tokenizer.json",
        bytes: 3497,
        sha256: "77a02c8e164413299b4b4c403b14f8e0e1c1b727db4d46a09d6327b861060a34",
      },
      {
        path: "onnx/model.onnx",
        bytes: 325_532_232,
        sha256: "8fbea51ea711f2af382e88c833d9e288c6dc82ce5e98421ea61c058ce21a34cb",
      },
      ...Object.entries(KOKORO_VOICE_SHA256).map(([voice, sha256]) => ({
        path: `voices/${voice}.bin`,
        bytes: 522_240,
        sha256,
      })),
    ],
  },
};

const MODEL_IDS = Object.keys(MODEL_SOURCES) as ReadonlyArray<TextToSpeechModelId>;

const isTextToSpeechError = Schema.is(TextToSpeechError);
const ttsError = (detail: string) => (cause: unknown) => new TextToSpeechError({ detail, cause });

function toPcm16(samples: Float32Array): Uint8Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index]!));
    pcm[index] = Math.round(sample * 32767);
  }
  return new Uint8Array(pcm.buffer);
}

/**
 * Owns one loaded engine at a time and runs synthesis strictly in order, so two
 * listeners share the CPU instead of racing each other for it. The engine is released
 * once no chunk has been synthesized for `idleMs`.
 */
export function makeEngineHost(
  load: (model: TextToSpeechModelId) => Promise<KokoroEngine>,
  idleMs = ENGINE_IDLE_MS,
) {
  let current:
    | { readonly model: TextToSpeechModelId; readonly engine: Promise<KokoroEngine> }
    | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const unload = async () => {
    const loaded = current;
    current = undefined;
    if (loaded) await (await loaded.engine.catch(() => undefined))?.release();
  };
  const serialize = <A>(task: () => Promise<A>): Promise<A> => {
    const run = queue.then(task);
    queue = run.catch(() => undefined);
    return run;
  };

  return {
    synthesize: (model: TextToSpeechModelId, text: string, voice: string, speed: number) => {
      clearTimeout(idleTimer);
      return serialize(async () => {
        if (current?.model !== model) {
          await unload();
          current = { model, engine: load(model) };
        }
        const loading = current;
        try {
          return await (await loading.engine).synthesize(text, voice, speed);
        } catch (error) {
          if (current === loading) current = undefined;
          throw error;
        }
      }).finally(() => {
        clearTimeout(idleTimer);
        // @effect-diagnostics-next-line globalTimers:off -- the promise-based host owns its own idle deadline.
        idleTimer = setTimeout(() => void serialize(unload), idleMs);
        idleTimer.unref();
      });
    },
    unload: () => {
      clearTimeout(idleTimer);
      return serialize(unload);
    },
  };
}

export interface TextToSpeechService {
  /** Every model's install state, starting with the current one. */
  readonly changes: Stream.Stream<ReadonlyArray<TextToSpeechModelState>>;
  readonly install: (
    model: TextToSpeechModelId,
  ) => Effect.Effect<TextToSpeechModelState, TextToSpeechError>;
  readonly cancelInstall: (
    model: TextToSpeechModelId,
  ) => Effect.Effect<TextToSpeechModelState, TextToSpeechError>;
  readonly remove: (
    model: TextToSpeechModelId,
  ) => Effect.Effect<TextToSpeechModelState, TextToSpeechError>;
  /** Queues text with the configured model, voice and speed and returns a single-use URL that streams it. */
  readonly speak: (
    input: TextToSpeechSpeakInput,
  ) => Effect.Effect<TextToSpeechSpeech, TextToSpeechError>;
  /**
   * Redeems a speech URL token, synthesizing its first chunk before returning. Undefined
   * when the token is unknown, used, or expired.
   */
  readonly takeSpeech: (
    token: string,
  ) => Effect.Effect<Stream.Stream<Uint8Array, TextToSpeechError> | undefined, TextToSpeechError>;
}

export class TextToSpeech extends Context.Service<TextToSpeech, TextToSpeechService>()(
  "t3/textToSpeech/TextToSpeech",
) {
  static readonly layer = Layer.effect(
    TextToSpeech,
    Effect.gen(function* () {
      const config = yield* ServerConfig;
      return yield* makeTextToSpeech({
        modelsDir: (yield* Path.Path).join(config.stateDir, "tts-models"),
      });
    }),
  );
}

export const makeTextToSpeech = Effect.fn("TextToSpeech.make")(function* (options: {
  readonly modelsDir: string;
  readonly sources?: Readonly<Record<TextToSpeechModelId, ModelSource>>;
  readonly loadEngine?: (directory: string) => Promise<KokoroEngine>;
}) {
  const sources = options.sources ?? MODEL_SOURCES;
  const supported = KOKORO_PLATFORMS.has(
    `${yield* HostProcessPlatform}-${yield* HostProcessArchitecture}`,
  );
  const totalBytes = (model: TextToSpeechModelId) =>
    sources[model].files.reduce((sum, file) => sum + file.bytes, 0);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const settings = yield* ServerSettingsService;
  const serviceScope = yield* Effect.scope;
  const gate = yield* Semaphore.make(1);
  const modelDirectory = (model: TextToSpeechModelId) => path.join(options.modelsDir, model);
  const engines = makeEngineHost((model) =>
    (options.loadEngine ?? loadKokoroEngine)(modelDirectory(model)),
  );
  const running = new Map<TextToSpeechModelId, Fiber.Fiber<void>>();
  // Bumped when a model is removed, so speech queued against it stops.
  const removals = new Map<TextToSpeechModelId, number>();
  const removalsOf = (model: TextToSpeechModelId) => removals.get(model) ?? 0;
  const speeches = new Map<
    string,
    {
      readonly model: TextToSpeechModelId;
      readonly voice: string;
      readonly speed: number;
      readonly chunks: ReadonlyArray<string>;
      readonly removals: number;
      readonly expiresAt: number;
    }
  >();

  // Nothing is downloading yet, so any staging directory was left by a download that
  // died with the process.
  for (const entry of yield* fs
    .readDirectory(options.modelsDir)
    .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []))) {
    if (!entry.startsWith(STAGING_PREFIX)) continue;
    yield* fs
      .remove(path.join(options.modelsDir, entry), { recursive: true, force: true })
      .pipe(Effect.ignore);
  }
  // A model directory only ever appears by renaming a fully verified download into place.
  const initial = yield* Effect.forEach(MODEL_IDS, (model) =>
    fs.exists(modelDirectory(model)).pipe(
      Effect.orElseSucceed(() => false),
      Effect.map((installed): TextToSpeechModelState => ({
        model,
        phase: !supported ? "unsupported" : installed ? "installed" : "missing",
        downloadedBytes: installed ? totalBytes(model) : 0,
        totalBytes: totalBytes(model),
        message: null,
      })),
    ),
  );
  const state = yield* SubscriptionRef.make<ReadonlyArray<TextToSpeechModelState>>(initial);
  const modelState = (model: TextToSpeechModelId) =>
    SubscriptionRef.get(state).pipe(
      Effect.map((all) => all.find((entry) => entry.model === model)!),
    );
  const update = (model: TextToSpeechModelId, patch: Partial<TextToSpeechModelState>) =>
    SubscriptionRef.update(state, (all) =>
      all.map((entry) => (entry.model === model ? { ...entry, ...patch } : entry)),
    ).pipe(Effect.andThen(modelState(model)));

  const download = Effect.fn("TextToSpeech.download")(function* (model: TextToSpeechModelId) {
    const source = sources[model];
    yield* fs.makeDirectory(options.modelsDir, { recursive: true });
    const available = yield* Effect.tryPromise(() =>
      NodeFSP.statfs(options.modelsDir, { bigint: true }),
    ).pipe(Effect.option);
    const required = totalBytes(model) + FREE_SPACE_MARGIN;
    if (
      Option.isSome(available) &&
      available.value.bavail * available.value.bsize < BigInt(required)
    ) {
      return yield* new TextToSpeechError({
        detail: `${TEXT_TO_SPEECH_MODELS[model].label} needs at least ${Math.ceil(required / 1_000_000)} MB of free space.`,
      });
    }
    const staging = yield* fs.makeTempDirectoryScoped({
      directory: options.modelsDir,
      prefix: `${STAGING_PREFIX}${model}-`,
    });
    const stagedModel = path.join(staging, model);
    let downloadedBytes = 0;
    let lastProgressAt = 0;
    for (const file of source.files) {
      const target = path.join(stagedModel, file.path);
      yield* fs.makeDirectory(path.dirname(target), { recursive: true });
      const hash = NodeCrypto.createHash("sha256");
      let fileBytes = 0;
      const response = yield* http
        .execute(HttpClientRequest.get(`${source.baseUrl}/${file.path}`))
        .pipe(
          Effect.timeout(DOWNLOAD_STALL_TIMEOUT),
          Effect.flatMap(HttpClientResponse.filterStatusOk),
        );
      yield* response.stream.pipe(
        Stream.timeoutOrElse({
          duration: DOWNLOAD_STALL_TIMEOUT,
          orElse: () =>
            Stream.fail(
              new TextToSpeechError({
                detail:
                  "The download stopped making progress. Check your connection, then try again.",
              }),
            ),
        }),
        Stream.tap((chunk) =>
          Effect.gen(function* () {
            fileBytes += chunk.byteLength;
            downloadedBytes += chunk.byteLength;
            if (fileBytes > file.bytes) {
              return yield* new TextToSpeechError({
                detail: `${file.path} is larger than the pinned release.`,
              });
            }
            hash.update(chunk);
            const now = yield* Clock.currentTimeMillis;
            if (now - lastProgressAt >= 250) {
              lastProgressAt = now;
              yield* update(model, { downloadedBytes });
            }
          }),
        ),
        Stream.run(fs.sink(target, { flag: "wx" })),
      );
      if (fileBytes !== file.bytes || hash.digest("hex") !== file.sha256) {
        return yield* new TextToSpeechError({
          detail: `${file.path} failed its size or SHA-256 check. Nothing was installed.`,
        });
      }
    }
    yield* fs.rename(stagedModel, modelDirectory(model));
    yield* update(model, { phase: "installed", downloadedBytes: totalBytes(model), message: null });
  }, Effect.scoped);

  const install: TextToSpeechService["install"] = (model) =>
    gate.withPermit(
      Effect.gen(function* () {
        const current = yield* modelState(model);
        if (current.phase !== "missing" && current.phase !== "failed") return current;
        const next = yield* update(model, {
          phase: "downloading",
          downloadedBytes: 0,
          message: null,
        });
        const work = download(model).pipe(
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void;
            const failure = Cause.findErrorOption(exit.cause);
            return Effect.gen(function* () {
              if (Cause.hasInterruptsOnly(exit.cause)) {
                yield* update(model, {
                  phase: "missing",
                  downloadedBytes: 0,
                  message: "Download cancelled.",
                });
                return;
              }
              yield* Effect.logWarning("Text-to-speech model download failed.", {
                model,
                cause: exit.cause,
              });
              yield* update(model, {
                phase: "failed",
                message:
                  Option.isSome(failure) && isTextToSpeechError(failure.value)
                    ? failure.value.detail
                    : "The download failed. Check your connection and free disk space, then try again.",
              });
            });
          }),
          Effect.ignoreCause,
          Effect.ensuring(Effect.sync(() => running.delete(model))),
        );
        running.set(model, yield* Effect.forkIn(Effect.interruptible(work), serviceScope));
        return next;
      }).pipe(Effect.uninterruptible),
    );

  const cancelInstall: TextToSpeechService["cancelInstall"] = (model) =>
    gate.withPermit(
      Effect.gen(function* () {
        const fiber = running.get(model);
        if (!fiber) return yield* modelState(model);
        yield* Fiber.interrupt(fiber);
        // A fiber interrupted before its first step never runs its own exit handlers.
        running.delete(model);
        const current = yield* modelState(model);
        return current.phase === "downloading"
          ? yield* update(model, {
              phase: "missing",
              downloadedBytes: 0,
              message: "Download cancelled.",
            })
          : current;
      }),
    );

  const remove: TextToSpeechService["remove"] = (model) =>
    gate.withPermit(
      Effect.gen(function* () {
        // The state, not the fiber: a finished download reports installed a moment
        // before its fiber is gone.
        if ((yield* modelState(model)).phase === "downloading") {
          return yield* new TextToSpeechError({
            detail: "Cancel the download before removing the model.",
          });
        }
        // Before the unload is queued: any chunk asked for after it sees the removal
        // instead of reloading the engine from files being deleted.
        removals.set(model, removalsOf(model) + 1);
        yield* Effect.promise(() => engines.unload());
        yield* fs
          .remove(modelDirectory(model), { recursive: true, force: true })
          .pipe(
            Effect.mapError(ttsError("Could not delete the model files. Check directory access.")),
          );
        return yield* update(model, { phase: "missing", downloadedBytes: 0, message: null });
      }),
    );

  const speak: TextToSpeechService["speak"] = Effect.fn("TextToSpeech.speak")(function* (input) {
    const configured = (yield* settings.getSettings.pipe(
      Effect.mapError(ttsError("Could not read the read-aloud settings.")),
    )).textToSpeech;
    const { phase } = yield* modelState(configured.model);
    if (phase !== "installed") {
      return yield* new TextToSpeechError({
        detail:
          phase === "unsupported"
            ? "Read aloud is not available on this environment's platform."
            : `Download ${TEXT_TO_SPEECH_MODELS[configured.model].label} in Settings before using read aloud.`,
      });
    }
    const chunks = speechChunks(speechText(input.text));
    if (chunks.length === 0)
      return yield* new TextToSpeechError({ detail: "There is nothing to read aloud." });
    const now = yield* Clock.currentTimeMillis;
    for (const [token, speech] of speeches) if (speech.expiresAt <= now) speeches.delete(token);
    const token = NodeCrypto.randomBytes(24).toString("base64url");
    speeches.set(token, {
      model: configured.model,
      voice: resolveTextToSpeechVoice(configured.model, input.voice ?? configured.voice).id,
      speed: configured.speed,
      chunks,
      removals: removalsOf(configured.model),
      expiresAt: now + SPEECH_TOKEN_TTL_MS,
    });
    return { url: `${TEXT_TO_SPEECH_ROUTE_PREFIX}/${token}`, sampleRate: KOKORO_SAMPLE_RATE };
  });

  const takeSpeech: TextToSpeechService["takeSpeech"] = (token) =>
    Effect.gen(function* () {
      const speech = speeches.get(token);
      speeches.delete(token);
      if (!speech || speech.expiresAt <= (yield* Clock.currentTimeMillis)) return undefined;
      const synthesize = (chunk: string) =>
        removalsOf(speech.model) !== speech.removals
          ? Effect.fail(new TextToSpeechError({ detail: "The voice model was removed." }))
          : Effect.tryPromise({
              try: () => engines.synthesize(speech.model, chunk, speech.voice, speech.speed),
              catch: ttsError("Speech synthesis failed."),
            });
      // The first chunk is synthesized before the response starts, so a model that
      // cannot load is reported as an error rather than a stream cut off mid-way.
      const [first, ...rest] = speech.chunks;
      const firstAudio = yield* synthesize(first!);
      return Stream.make(firstAudio).pipe(
        Stream.concat(Stream.fromIterable(rest).pipe(Stream.mapEffect(synthesize))),
        Stream.map(toPcm16),
        Stream.filter((pcm) => pcm.byteLength > 0),
      );
    });

  yield* Effect.addFinalizer(() => Effect.promise(() => engines.unload()));

  return TextToSpeech.of({
    changes: SubscriptionRef.changes(state),
    install,
    cancelInstall,
    remove,
    speak,
    takeSpeech,
  });
});
