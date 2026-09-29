const SENTENCE_END = /(?<=[.!?…:;])\s+/;
// Fragments shorter than this ("Done.", "Follow-through:") sound clipped on their own.
const MIN_CHUNK = 40;
// Kokoro reads at most 510 phonemes per call, roughly 400 characters of English.
const MAX_CHUNK = 280;

function splitLong(sentence: string): string[] {
  const parts: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_CHUNK) {
    const window = rest.slice(0, MAX_CHUNK);
    const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "));
    const at = cut > MIN_CHUNK ? cut + 1 : Math.max(window.lastIndexOf(" "), MIN_CHUNK);
    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  return rest ? [...parts, rest] : parts;
}

/**
 * Splits text into the pieces synthesized one after another while audio streams.
 * The first piece goes out alone however short it is, because its length is the
 * wait before the listener hears anything; later fragments join the next sentence.
 */
export function speechChunks(text: string): string[] {
  const sentences = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => /[\p{L}\p{N}]/u.test(line))
    // A list item or heading has no closing punctuation; without one it runs into the next line.
    .map((line) => (/[.!?…:;,]$/.test(line) ? line : `${line}.`))
    .flatMap((line) => line.split(SENTENCE_END))
    .flatMap(splitLong);

  const chunks: string[] = [];
  let pending = "";
  for (const sentence of sentences) {
    const joined = pending ? `${pending} ${sentence}` : sentence;
    if (chunks.length > 0 && joined.length < MIN_CHUNK) {
      pending = joined;
    } else if (joined.length > MAX_CHUNK) {
      // Only reachable with a pending fragment: splitLong already capped the sentence.
      chunks.push(pending);
      pending = sentence;
    } else {
      chunks.push(joined);
      pending = "";
    }
  }
  if (pending) chunks.push(pending);
  return chunks;
}
