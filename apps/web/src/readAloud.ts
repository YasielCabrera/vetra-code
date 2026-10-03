import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { type EnvironmentId, TEXT_TO_SPEECH_MAX_TEXT } from "@t3tools/contracts";
import { useCallback, useMemo, useSyncExternalStore } from "react";

import { toastManager } from "./components/ui/toast";
import { useEnvironmentSettings } from "./hooks/useSettings";
import { useEnvironmentHttpBaseUrl } from "./state/environments";
import { useEnvironmentQuery } from "./state/query";
import { serverEnvironment } from "./state/server";
import { useAtomCommand } from "./state/use-atom-command";

export interface SpeechPlayback {
  /** Caller-chosen identity of what is being read, e.g. one markdown block. */
  readonly key: string;
  readonly phase: "loading" | "playing" | "paused";
}

export interface PreparedSpeech {
  readonly url: string;
  readonly sampleRate: number;
}

let playback: SpeechPlayback | null = null;
const listeners = new Set<() => void>();
let audioContext: AudioContext | null = null;
interface SpeechRun {
  readonly key: string;
  readonly abort: AbortController;
  readonly sources: AudioBufferSourceNode[];
}
let active: SpeechRun | null = null;

function publish(next: SpeechPlayback | null) {
  playback = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSpeechPlayback(): SpeechPlayback | null {
  const snapshot = () => playback;
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The phase of `key` alone, so only the control reading it re-renders. */
export function useSpeechPhase(key: string): SpeechPlayback["phase"] | null {
  const snapshot = () => (playback?.key === key ? playback.phase : null);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function end(run: SpeechRun) {
  if (active !== run) return;
  active = null;
  // A running context holds the output device and its render thread between replies.
  void audioContext?.suspend();
  publish(null);
}

/** Stops whatever is being read, from any surface. */
export function stopSpeech() {
  if (!active) return;
  active.abort.abort();
  for (const source of active.sources) source.stop();
  end(active);
}

/**
 * Freezes the audio clock mid-word. Chunks still streaming in queue up behind it, and
 * `resumeSpeech` carries on from the same sample.
 */
export function pauseSpeech() {
  if (playback?.phase !== "playing") return;
  void audioContext?.suspend();
  publish({ key: playback.key, phase: "paused" });
}

export function resumeSpeech() {
  if (playback?.phase !== "paused") return;
  void audioContext?.resume();
  publish({ key: playback.key, phase: "playing" });
}

/**
 * Starts reading `key`, or stops it when it is already the one playing. Each PCM chunk
 * is scheduled right behind the previous one as it arrives, so the first sentence plays
 * while the rest is still being synthesized.
 */
export async function toggleSpeech(key: string, prepare: () => Promise<PreparedSpeech>) {
  if (active?.key === key) return stopSpeech();
  stopSpeech();
  // Created and resumed inside the click, before any await, so autoplay rules allow it.
  audioContext ??= new AudioContext();
  const context = audioContext;
  void context.resume();
  const run: SpeechRun = { key, abort: new AbortController(), sources: [] };
  active = run;
  publish({ key, phase: "loading" });
  // Done once the stream has ended and every chunk it produced has finished playing,
  // in whichever order those happen.
  let streaming = true;
  let playing = 0;
  const finishIfDone = () => {
    if (!streaming && playing === 0) end(run);
  };

  try {
    const { url, sampleRate } = await prepare();
    if (active !== run) return;
    const response = await fetch(url, { signal: run.abort.signal });
    if (!response.ok || !response.body) {
      // A 500 carries the server's reason, such as a model that could not load.
      const detail = response.status === 500 ? await response.text() : "";
      throw new Error(detail || "The server did not return any audio.");
    }
    const reader = response.body.getReader();
    let carry = new Uint8Array(0);
    let startAt = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const bytes = new Uint8Array(carry.length + value.length);
      bytes.set(carry);
      bytes.set(value, carry.length);
      const whole = bytes.length - (bytes.length % 2);
      carry = bytes.slice(whole);
      if (whole === 0) continue;
      const pcm = new Int16Array(bytes.buffer, 0, whole / 2);
      const buffer = context.createBuffer(1, pcm.length, sampleRate);
      const channel = buffer.getChannelData(0);
      for (let index = 0; index < pcm.length; index++) channel[index] = pcm[index]! / 32768;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      // A late chunk starts now rather than in the past, which would clip its first syllable.
      startAt = Math.max(startAt, context.currentTime + 0.05);
      source.addEventListener(
        "ended",
        () => {
          playing--;
          finishIfDone();
        },
        { once: true },
      );
      source.start(startAt);
      startAt += buffer.duration;
      playing++;
      run.sources.push(source);
      if (run.sources.length === 1) publish({ key, phase: "playing" });
    }
    streaming = false;
    finishIfDone();
  } catch (error) {
    if (run.abort.signal.aborted) return;
    end(run);
    throw error;
  }
}

export type ReadAloud = ReturnType<typeof useReadAloud>;

/**
 * Read-aloud for one environment: available once the user turned it on in Settings and
 * its model finished downloading there, because that environment's server does the speaking.
 */
export function useReadAloud(environmentId: EnvironmentId) {
  const settings = useEnvironmentSettings(environmentId, (all) => all.textToSpeech);
  const enabled = settings.enabled;
  const models = useEnvironmentQuery(
    enabled ? serverEnvironment.textToSpeechModels({ environmentId, input: {} }) : null,
  );
  const installed = models.data?.some(
    (model) => model.model === settings.model && model.phase === "installed",
  );
  const httpBaseUrl = useEnvironmentHttpBaseUrl(environmentId);
  const speak = useAtomCommand(serverEnvironment.speakText, {
    reportFailure: false,
    reportDefect: false,
  });

  const toggle = useCallback(
    (key: string, fullText: string, voice?: string) => {
      if (httpBaseUrl === null) return;
      // Past the limit is well over an hour of speech; the start is what anyone listens to.
      const text = fullText.slice(0, TEXT_TO_SPEECH_MAX_TEXT).trim();
      if (text.length === 0 && playback?.key !== key) {
        toastManager.add({ type: "info", title: "There is nothing to read aloud" });
        return;
      }
      toggleSpeech(key, async () => {
        const result = await speak({ environmentId, input: { text, ...(voice ? { voice } : {}) } });
        if (result._tag === "Failure") {
          if (isAtomCommandInterrupted(result)) throw new DOMException("Cancelled", "AbortError");
          const failure = squashAtomCommandFailure(result);
          throw failure instanceof Error ? failure : new Error("Read aloud failed.");
        }
        const url = resolveAssetUrl(httpBaseUrl, result.value.url);
        if (url === null) throw new Error("Could not reach this environment.");
        return { url, sampleRate: result.value.sampleRate };
      }).catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        toastManager.add({
          type: "error",
          title: "Could not read aloud",
          description: error instanceof Error ? error.message : "Read aloud failed.",
        });
      });
    },
    [environmentId, httpBaseUrl, speak],
  );

  const available = enabled && installed === true && httpBaseUrl !== null;
  return useMemo(() => ({ available, toggle }), [available, toggle]);
}
