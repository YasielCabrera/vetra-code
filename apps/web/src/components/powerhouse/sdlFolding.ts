export interface SdlFoldRange {
  readonly id: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly label: string;
}

interface PendingDefinition {
  readonly keyword: string;
  name: string | null;
}

interface ActiveDefinition extends PendingDefinition {
  readonly openOffset: number;
  readonly startLine: number;
}

const FOLDABLE_DEFINITION_KEYWORDS = new Set(["enum", "input", "interface", "schema", "type"]);
const TOP_LEVEL_DEFINITION_KEYWORDS = new Set([
  ...FOLDABLE_DEFINITION_KEYWORDS,
  "directive",
  "fragment",
  "mutation",
  "query",
  "scalar",
  "subscription",
  "union",
]);

function isNameStart(character: string): boolean {
  const code = character.charCodeAt(0);
  return character === "_" || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isNameContinue(character: string): boolean {
  const code = character.charCodeAt(0);
  return isNameStart(character) || (code >= 48 && code <= 57);
}

function foldLabel(definition: PendingDefinition): string {
  return definition.name === null ? definition.keyword : `${definition.keyword} ${definition.name}`;
}

/**
 * Find brace-delimited SDL declarations without adding another editor grammar.
 * Strings, block strings, comments, directive arguments, and nested value
 * objects are skipped so only a declaration's outer body becomes foldable.
 */
export function sdlFoldRanges(source: string): ReadonlyArray<SdlFoldRange> {
  const ranges: Array<SdlFoldRange> = [];
  let active: ActiveDefinition | null = null;
  let pending: PendingDefinition | null = null;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let line = 1;
  let index = 0;
  let mode: "normal" | "comment" | "string" | "block-string" = "normal";

  while (index < source.length) {
    const character = source[index] ?? "";

    if (mode === "comment") {
      if (character === "\n") {
        line += 1;
        mode = "normal";
      }
      index += 1;
      continue;
    }

    if (mode === "string") {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === '"') mode = "normal";
      if (character === "\n") line += 1;
      index += 1;
      continue;
    }

    if (mode === "block-string") {
      if (source.startsWith('"""', index)) {
        mode = "normal";
        index += 3;
        continue;
      }
      if (character === "\n") line += 1;
      index += 1;
      continue;
    }

    if (character === "#") {
      mode = "comment";
      index += 1;
      continue;
    }
    if (source.startsWith('"""', index)) {
      mode = "block-string";
      index += 3;
      continue;
    }
    if (character === '"') {
      mode = "string";
      index += 1;
      continue;
    }
    if (character === "\n") {
      line += 1;
      index += 1;
      continue;
    }

    if (isNameStart(character)) {
      const start = index;
      index += 1;
      while (index < source.length && isNameContinue(source[index] ?? "")) index += 1;
      const word = source.slice(start, index);
      if (braceDepth === 0 && bracketDepth === 0 && parenthesisDepth === 0) {
        if (FOLDABLE_DEFINITION_KEYWORDS.has(word)) {
          pending = { keyword: word, name: null };
        } else if (TOP_LEVEL_DEFINITION_KEYWORDS.has(word)) {
          pending = null;
        } else if (pending !== null && pending.keyword !== "schema" && pending.name === null) {
          pending.name = word;
        }
      }
      continue;
    }

    if (character === "(") parenthesisDepth += 1;
    if (character === ")" && parenthesisDepth > 0) parenthesisDepth -= 1;
    if (character === "[") bracketDepth += 1;
    if (character === "]" && bracketDepth > 0) bracketDepth -= 1;

    if (character === "{") {
      const startsDefinition =
        braceDepth === 0 &&
        bracketDepth === 0 &&
        parenthesisDepth === 0 &&
        pending !== null &&
        (pending.keyword === "schema" || pending.name !== null);
      braceDepth += 1;
      if (startsDefinition && pending !== null) {
        active = { ...pending, openOffset: index, startLine: line };
      }
    } else if (character === "}" && braceDepth > 0) {
      braceDepth -= 1;
      if (braceDepth === 0 && active !== null) {
        if (line > active.startLine) {
          ranges.push({
            id: `${active.openOffset}:${index}`,
            startLine: active.startLine,
            endLine: line,
            label: foldLabel(active),
          });
        }
        active = null;
        pending = null;
      }
    }

    index += 1;
  }

  return ranges;
}
