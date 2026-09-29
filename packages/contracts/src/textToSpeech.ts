import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

export const TextToSpeechModelId = Schema.Literals(["kokoro-82m"]);
export type TextToSpeechModelId = typeof TextToSpeechModelId.Type;

export interface TextToSpeechVoice {
  readonly id: string;
  readonly name: string;
  readonly accent: "American" | "British";
  readonly gender: "Female" | "Male";
}

export interface TextToSpeechModel {
  readonly id: TextToSpeechModelId;
  readonly label: string;
  readonly description: string;
  /** Best-sounding first, so the first entry is the default. */
  readonly voices: ReadonlyArray<TextToSpeechVoice>;
}

/** Kokoro's voices by published grade. The server pins one file per id. */
export const KOKORO_VOICES = [
  ["af_heart", "Heart"],
  ["af_bella", "Bella"],
  ["af_nicole", "Nicole"],
  ["bf_emma", "Emma"],
  ["af_aoede", "Aoede"],
  ["af_kore", "Kore"],
  ["af_sarah", "Sarah"],
  ["am_fenrir", "Fenrir"],
  ["am_michael", "Michael"],
  ["am_puck", "Puck"],
  ["af_alloy", "Alloy"],
  ["af_nova", "Nova"],
  ["bf_isabella", "Isabella"],
  ["bm_fable", "Fable"],
  ["bm_george", "George"],
  ["af_sky", "Sky"],
  ["bm_lewis", "Lewis"],
  ["af_jessica", "Jessica"],
  ["af_river", "River"],
  ["am_echo", "Echo"],
  ["am_eric", "Eric"],
  ["am_liam", "Liam"],
  ["am_onyx", "Onyx"],
  ["bf_alice", "Alice"],
  ["bf_lily", "Lily"],
  ["bm_daniel", "Daniel"],
  ["am_santa", "Santa"],
  ["am_adam", "Adam"],
] as const;
export type KokoroVoiceId = (typeof KOKORO_VOICES)[number][0];

/** Models a server can download and run locally. */
export const TEXT_TO_SPEECH_MODELS: Readonly<Record<TextToSpeechModelId, TextToSpeechModel>> = {
  "kokoro-82m": {
    id: "kokoro-82m",
    label: "Kokoro 82M",
    description: "Fast, natural English speech that runs on this machine's CPU.",
    voices: KOKORO_VOICES.map(([id, name]) => ({
      id,
      name,
      accent: id.startsWith("b") ? "British" : "American",
      gender: id[1] === "f" ? "Female" : "Male",
    })),
  },
};

export const DEFAULT_TEXT_TO_SPEECH_MODEL: TextToSpeechModelId = "kokoro-82m";

/** Playback rate relative to the voice's natural pace; 1.2 speaks 20% faster. */
export const TextToSpeechSpeed = Schema.Number.check(
  Schema.isGreaterThanOrEqualTo(0.5),
  Schema.isLessThanOrEqualTo(2),
);
export const TEXT_TO_SPEECH_SPEEDS = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2] as const;

/** Resolves a stored voice against a model, falling back to its best voice when it no longer exists. */
export function resolveTextToSpeechVoice(model: TextToSpeechModelId, voice: string) {
  const voices = TEXT_TO_SPEECH_MODELS[model].voices;
  return voices.find((candidate) => candidate.id === voice) ?? voices[0]!;
}

/**
 * Read-aloud settings. Server-scoped because the model runs, and its weights live,
 * on the environment's machine rather than on whichever client is looking at it.
 */
export const TextToSpeechSettings = Schema.Struct({
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  model: TextToSpeechModelId.pipe(
    Schema.withDecodingDefault(Effect.succeed(DEFAULT_TEXT_TO_SPEECH_MODEL)),
  ),
  voice: TrimmedNonEmptyString.pipe(
    Schema.withDecodingDefault(
      Effect.succeed(TEXT_TO_SPEECH_MODELS[DEFAULT_TEXT_TO_SPEECH_MODEL].voices[0]!.id),
    ),
  ),
  speed: TextToSpeechSpeed.pipe(Schema.withDecodingDefault(Effect.succeed(1))),
}).pipe(Schema.withDecodingDefault(Effect.succeed({})));
export type TextToSpeechSettings = typeof TextToSpeechSettings.Type;

export const TextToSpeechSettingsPatch = Schema.Struct({
  enabled: Schema.optionalKey(Schema.Boolean),
  model: Schema.optionalKey(TextToSpeechModelId),
  voice: Schema.optionalKey(TrimmedNonEmptyString),
  speed: Schema.optionalKey(TextToSpeechSpeed),
});

const ByteCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const TextToSpeechModelState = Schema.Struct({
  model: TextToSpeechModelId,
  /** `unsupported` when the environment's platform has no runtime for the model. */
  phase: Schema.Literals(["unsupported", "missing", "downloading", "installed", "failed"]),
  downloadedBytes: ByteCount,
  totalBytes: ByteCount,
  /** Why the last download stopped: a failure, or a cancellation. */
  message: Schema.NullOr(Schema.String),
});
export type TextToSpeechModelState = typeof TextToSpeechModelState.Type;

export const TextToSpeechModelInput = Schema.Struct({ model: TextToSpeechModelId });
export type TextToSpeechModelInput = typeof TextToSpeechModelInput.Type;

export const TEXT_TO_SPEECH_MAX_TEXT = 50_000;

export const TextToSpeechSpeakInput = Schema.Struct({
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(TEXT_TO_SPEECH_MAX_TEXT)),
  /** Overrides the configured voice, e.g. to preview one before choosing it. */
  voice: Schema.optionalKey(TrimmedNonEmptyString),
});
export type TextToSpeechSpeakInput = typeof TextToSpeechSpeakInput.Type;

export const TextToSpeechSpeech = Schema.Struct({
  /** Relative, single-use URL streaming little-endian 16-bit mono PCM. */
  url: TrimmedNonEmptyString,
  sampleRate: Schema.Int,
});
export type TextToSpeechSpeech = typeof TextToSpeechSpeech.Type;

export class TextToSpeechError extends Schema.TaggedError<TextToSpeechError>()(
  "TextToSpeechError",
  {
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
