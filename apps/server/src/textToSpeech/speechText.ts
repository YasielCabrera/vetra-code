const SEGMENT = String.raw`(?:\.{1,2}|\.?[\w@+-]+(?:\.[\w@+-]+)*)`;
// A URL is matched first so its path is left alone; anything else with a separator is a candidate path.
const URL_OR_PATH = new RegExp(
  String.raw`\b[a-z][a-z\d+.-]*:\/\/\S+|(?:\b[a-z]:|~|\.{1,2})?[\/\\]?(?:${SEGMENT}[\/\\])+${SEGMENT}?(?::\d+(?:[,:-]\d+)*)?`,
  "gi",
);
const FILE_WITH_LINES = /\b([\w.-]+\.[a-z][a-z\d]{0,7}):\d+(?:[,:-]\d+)*/gi;
const LINE_SUFFIX = /:\d+(?:[,:-]\d+)*$/;
const FILE_EXTENSION = /\.[a-z][a-z\d]{0,7}$/i;
// Every pattern above matches inside one run of non-space characters, and backtracks
// quadratically over a long one (a hash, base64, minified code). No path is this long.
const MAX_TOKEN = 256;

function speakPath(match: string) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(match) || !/[a-z]/i.test(match)) return match;
  const path = match.replace(LINE_SUFFIX, "");
  const segments = path.split(/[/\\]/).filter(Boolean);
  const name = segments.at(-1);
  if (!name) return match;
  const rooted = /^(?:[a-z]:|~|\.{1,2})?[/\\]/i.test(path);
  const directory = /[/\\]$/.test(path);
  // `@tanstack/react-table` and `origin/main` are names and `input/output/error` is prose;
  // a file extension, a root, a trailing separator, or real depth is what marks a path.
  if (!FILE_EXTENSION.test(name) && !rooted && !directory && segments.length < 4) return match;
  return name;
}

/**
 * Rewrites text into what a listener should hear. File paths read as just the file
 * name, without line numbers: nobody wants every directory of
 * `apps/web/src/state/threads.ts:42` spelled out, only "threads.ts".
 */
export function speechText(text: string): string {
  return text.replace(/\S+/g, (token) =>
    token.length > MAX_TOKEN
      ? token
      : token.replace(URL_OR_PATH, speakPath).replace(FILE_WITH_LINES, "$1"),
  );
}
