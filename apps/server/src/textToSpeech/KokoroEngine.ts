// @effect-diagnostics nodeBuiltinImport:off
/**
 * Kokoro-82M on onnxruntime-node: text normalization and phonemization ported
 * from kokoro-js (Apache-2.0), tokenized with the model's phoneme vocabulary.
 * transformers.js would do the same work for this one model but brings sharp
 * and a second ONNX runtime along with it.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export const KOKORO_SAMPLE_RATE = 24_000;
/** `${platform}-${arch}` pairs onnxruntime-node ships a runtime for; Intel Macs have none. */
export const KOKORO_PLATFORMS: ReadonlySet<string> = new Set([
  "darwin-arm64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
]);

// Both stay external to the CLI bundle; `require` reads the real filesystem in
// every runtime, including a Node single executable (see NodePtyAdapter).
const requireExternal = NodeModule.createRequire(import.meta.url);
type Ort = typeof import("onnxruntime-node");
type Phonemizer = typeof import("phonemizer");

const PUNCTUATION = ';:,.!?¡¿—…"«»“”(){}[]';
const PUNCTUATION_RUN = new RegExp(
  `(\\s*[${PUNCTUATION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}]+\\s*)+`,
  "g",
);
// Style vectors are indexed by token count and the model accepts at most 510 phonemes.
const MAX_PHONEMES = 510;
const STYLE_SIZE = 256;

function speakNumber(match: string) {
  if (match.includes(".")) return match;
  if (match.includes(":")) {
    const [hours, minutes] = match.split(":").map(Number);
    if (minutes === 0) return `${hours} o'clock`;
    return minutes! < 10 ? `${hours} oh ${minutes}` : `${hours} ${minutes}`;
  }
  const year = parseInt(match.slice(0, 4), 10);
  if (year < 1100 || year % 1000 < 10) return match;
  const left = match.slice(0, 2);
  const right = parseInt(match.slice(2, 4), 10);
  const suffix = match.endsWith("s") ? "s" : "";
  if (year % 1000 >= 100 && year % 1000 <= 999) {
    if (right === 0) return `${left} hundred${suffix}`;
    if (right < 10) return `${left} oh ${right}${suffix}`;
  }
  return `${left} ${right}${suffix}`;
}

function speakMoney(match: string) {
  const bill = match[0] === "$" ? "dollar" : "pound";
  const amount = match.slice(1);
  if (isNaN(Number(amount))) return `${amount} ${bill}s`;
  if (!match.includes(".")) return `${amount} ${bill}${amount === "1" ? "" : "s"}`;
  const [whole, fraction] = amount.split(".");
  const cents = parseInt(fraction!.padEnd(2, "0"), 10);
  const coin =
    match[0] === "$" ? (cents === 1 ? "cent" : "cents") : cents === 1 ? "penny" : "pence";
  return `${whole} ${bill}${whole === "1" ? "" : "s"} and ${cents} ${coin}`;
}

function speakDecimal(match: string) {
  const [whole, fraction] = match.split(".");
  return `${whole} point ${fraction!.split("").join(" ")}`;
}

export function normalizeKokoroText(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/«/g, "“")
    .replace(/»/g, "”")
    .replace(/[“”]/g, '"')
    .replace(/\(/g, "«")
    .replace(/\)/g, "»")
    .replace(/[^\S \n]/g, " ")
    .replace(/  +/, " ")
    .replace(/(?<=\n) +(?=\n)/g, "")
    .replace(/\bD[Rr]\.(?= [A-Z])/g, "Doctor")
    .replace(/\b(?:Mr\.|MR\.(?= [A-Z]))/g, "Mister")
    .replace(/\b(?:Ms\.|MS\.(?= [A-Z]))/g, "Miss")
    .replace(/\b(?:Mrs\.|MRS\.(?= [A-Z]))/g, "Mrs")
    .replace(/\betc\.(?! [A-Z])/gi, "etc")
    .replace(/\b(y)eah?\b/gi, "$1e'a")
    .replace(/\d*\.\d+|\b\d{4}s?\b|(?<!:)\b(?:[1-9]|1[0-2]):[0-5]\d\b(?!:)/g, speakNumber)
    .replace(/(?<=\d),(?=\d)/g, "")
    .replace(
      /[$£]\d+(?:\.\d+)?(?: hundred| thousand| (?:[bm]|tr)illion)*\b|[$£]\d+\.\d\d?\b/gi,
      speakMoney,
    )
    .replace(/\d*\.\d+/g, speakDecimal)
    .replace(/(?<=\d)-(?=\d)/g, " to ")
    .replace(/(?<=\d)S/g, " S")
    .replace(/(?<=[BCDFGHJ-NP-TV-Z])'?s\b/g, "'S")
    .replace(/(?<=X')S\b/g, "s")
    .replace(/(?:[A-Za-z]\.){2,} [a-z]/g, (match) => match.replace(/\./g, "-"))
    .replace(/(?<=[A-Z])\.(?=[A-Z])/gi, "-")
    .trim();
}

async function toPhonemes(phonemizer: Phonemizer, text: string, british: boolean) {
  const normalized = normalizeKokoroText(text);
  const pieces: Array<{ readonly punctuation: boolean; readonly text: string }> = [];
  let last = 0;
  for (const match of normalized.matchAll(PUNCTUATION_RUN)) {
    if (last < match.index)
      pieces.push({ punctuation: false, text: normalized.slice(last, match.index) });
    if (match[0].length > 0) pieces.push({ punctuation: true, text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < normalized.length) pieces.push({ punctuation: false, text: normalized.slice(last) });

  const language = british ? "en" : "en-us";
  const spoken = await Promise.all(
    pieces.map(async (piece) =>
      piece.punctuation ? piece.text : (await phonemizer.phonemize(piece.text, language)).join(" "),
    ),
  );
  let phonemes = spoken
    .join("")
    .replace(/kəkˈoːɹoʊ/g, "kˈoʊkəɹoʊ")
    .replace(/kəkˈɔːɹəʊ/g, "kˈəʊkəɹəʊ")
    .replace(/ʲ/g, "j")
    .replace(/r/g, "ɹ")
    .replace(/x/g, "k")
    .replace(/ɬ/g, "l")
    .replace(/(?<=[a-zɹː])(?=hˈʌndɹɪd)/g, " ")
    .replace(/ z(?=[;:,.!?¡¿—…"«»“” ]|$)/g, "z");
  if (!british) phonemes = phonemes.replace(/(?<=nˈaɪn)ti(?!ː)/g, "di");
  return phonemes.trim();
}

export interface KokoroEngine {
  /** Synthesizes one sentence-sized chunk; longer input is truncated at 510 phonemes. */
  readonly synthesize: (text: string, voice: string, speed: number) => Promise<Float32Array>;
  readonly release: () => Promise<void>;
}

/** Loads the model from a directory laid out like the onnx-community Kokoro repository. */
export async function loadKokoroEngine(directory: string): Promise<KokoroEngine> {
  const ort = requireExternal("onnxruntime-node") as Ort;
  const phonemizer = requireExternal("phonemizer") as Phonemizer;
  const tokenizer = JSON.parse(
    await NodeFSP.readFile(NodePath.join(directory, "tokenizer.json"), "utf8"),
  ) as {
    readonly model: { readonly vocab: Readonly<Record<string, number>> };
  };
  const vocab = tokenizer.model.vocab;
  // onnxruntime defaults to every core; half leaves room for the agents on the same machine.
  const session = await ort.InferenceSession.create(
    NodePath.join(directory, "onnx", "model.onnx"),
    {
      intraOpNumThreads: Math.max(1, Math.floor(NodeOS.availableParallelism() / 2)),
      interOpNumThreads: 1,
    },
  );
  const voices = new Map<string, Float32Array>();

  const loadVoice = async (voice: string) => {
    const cached = voices.get(voice);
    if (cached) return cached;
    if (!/^[a-z]{2}_[a-z]+$/.test(voice)) throw new Error(`Unknown Kokoro voice ${voice}.`);
    const bytes = await NodeFSP.readFile(NodePath.join(directory, "voices", `${voice}.bin`));
    const styles = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    voices.set(voice, styles);
    return styles;
  };

  return {
    synthesize: async (text, voice, speed) => {
      const styles = await loadVoice(voice);
      const phonemes = await toPhonemes(phonemizer, text, voice.startsWith("b"));
      const ids = [...phonemes]
        .map((symbol) => vocab[symbol])
        .filter((id) => id !== undefined)
        .slice(0, MAX_PHONEMES);
      if (ids.length === 0) return new Float32Array(0);
      const inputIds = BigInt64Array.from([0, ...ids, 0].map(BigInt));
      const styleOffset = STYLE_SIZE * Math.min(ids.length, MAX_PHONEMES - 1);
      const output = await session.run({
        input_ids: new ort.Tensor("int64", inputIds, [1, inputIds.length]),
        style: new ort.Tensor("float32", styles.slice(styleOffset, styleOffset + STYLE_SIZE), [
          1,
          STYLE_SIZE,
        ]),
        speed: new ort.Tensor("float32", Float32Array.from([speed]), [1]),
      });
      return output.waveform!.data as Float32Array;
    },
    release: () => session.release(),
  };
}
