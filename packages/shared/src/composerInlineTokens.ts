export type ComposerInlineToken =
  | {
      readonly type: "mention";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "skill";
      readonly value: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    }
  | {
      readonly type: "powerhouse";
      /** `<kind>/<id>` — what the reference addresses. */
      readonly value: string;
      readonly kind: PowerhouseReferenceKind;
      /** What a chip shows: the item's name, or its id when the reference names none. */
      readonly label: string;
      /** The facts after the label, verbatim, for a chip's tooltip. */
      readonly detail: string;
      readonly source: string;
      readonly start: number;
      readonly end: number;
    };

export interface CollectComposerInlineTokensOptions {
  readonly preserveTrailingFrom?: ReadonlyArray<ComposerInlineToken>;
}

/**
 * A skill name may start with a digit, but compact monetary amounts and
 * numeric expressions like "$20", "$20k", "$100M", and "$1e6" must stay prose:
 * the composer chips any matched `$name` token, known or not. Tokens beginning
 * with digits must not match numbers with currency/exponent suffixes, and must
 * contain at least one letter. Any currency symbol is accepted as the sigil.
 */
const SKILL_MENTION_SOURCE =
  /(^|\s)\p{Sc}(?![0-9][0-9_]*(?:[kKmMbBtT]|[eE][0-9]+)?(?:\s|$))(?=[a-zA-Z0-9:_-]*[a-zA-Z])([a-zA-Z0-9][a-zA-Z0-9:_-]*)/u
    .source;
// While typing, a token only becomes a chip once a delimiter follows it, so a
// half-typed name at the end of the text stays plain.
const SKILL_TOKEN_REGEX = new RegExp(`${SKILL_MENTION_SOURCE}(?=\\s)`, "gu");
/**
 * Skill mentions in a sent prompt, which may also end at the end of the text.
 * Group 1 is the leading delimiter and group 2 the skill name. The pattern is
 * global, so use it with `matchAll` or `replace`, not `test` or `exec`.
 */
export const SKILL_MENTION_PATTERN = new RegExp(`${SKILL_MENTION_SOURCE}(?=\\s|$)`, "gu");
const MENTION_TOKEN_REGEX = /(^|\s)@(?:"((?:\\.|[^"\\])*)"|([^\s@"]+))(?=\s)/g;
/**
 * The label body is bounded rather than `*`. Unbounded, every whitespace in
 * the composer is a candidate start: the engine scans the rest of the text for
 * a closing `]`, fails, and rescans from the next whitespace — quadratic on
 * input like " [[[[[…". A cap makes each attempt constant-bounded.
 *
 * Only a basename ever survives the `label !== basename` check below, so this
 * cannot reject a link a user could meaningfully write; the longest filename
 * any common filesystem allows is 255.
 */
const MAX_FILE_LINK_LABEL_LENGTH = 512;
const FILE_LINK_TOKEN_REGEX = new RegExp(
  `(^|\\s)\\[((?:\\\\.|[^\\]\\\\]){0,${MAX_FILE_LINK_LABEL_LENGTH}})\\]\\(([^)\\s]+)\\)(?=\\s)`,
  "g",
);
const URI_SCHEME_REGEX = /^[A-Za-z][A-Za-z0-9+.-]*:/;
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;
// Autocomplete emits canonical file links, so ambiguous bare @scope/package text stays a package.
const SCOPED_PACKAGE_REFERENCE_REGEX =
  /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*(?:\/[^\s@"]+)*$/;

/**
 * A Powerhouse reference addresses a drive, a folder, or a leaf document in a
 * reactor. Unlike a file mention there is no path to link, so the reference
 * carries an addressable token plus the facts needed to fetch the item.
 */
export type PowerhouseReferenceKind = "drive" | "folder" | "doc";

export interface PowerhouseReferenceFields {
  readonly kind: PowerhouseReferenceKind;
  readonly id: string;
  /** The item's name. Empty when the reactor only knew its id. */
  readonly name: string;
  /** Reactor document type. Empty for a drive or folder, whose kind already says it. */
  readonly documentType: string;
  /** Drive slug, when it is neither the id nor the name again. */
  readonly slug: string;
  /** Containing drive and folders, joined with `/`. Empty for a drive. */
  readonly path: string;
  readonly reactorUrl: string;
}

const POWERHOUSE_REFERENCE_KINDS = ["drive", "folder", "doc"] as const;
const POWERHOUSE_FACT_SEPARATOR = " \u00b7 ";
const POWERHOUSE_SLUG_FACT_PREFIX = "slug ";
const POWERHOUSE_PATH_FACT_PREFIX = "in ";
/**
 * Bounded for the same reason the file link label is: an unbounded lazy body
 * makes every whitespace a candidate start and every failed attempt a scan to
 * the end of the prompt. Reactor ids, types, and URLs are all length-bounded at
 * the RPC boundary, so nothing a reactor can produce comes close.
 */
const MAX_POWERHOUSE_REFERENCE_ID_LENGTH = 512;
const MAX_POWERHOUSE_REFERENCE_DETAIL_LENGTH = 1024;
/**
 * The detail body is lazy so it ends at the first `)` that closes the
 * reference, which lets a document named `report (final).pdf` still match: its
 * inner `)` is not followed by whitespace.
 */
const POWERHOUSE_REFERENCE_TOKEN_REGEX = new RegExp(
  "(^|\\s)`powerhouse:(" +
    POWERHOUSE_REFERENCE_KINDS.join("|") +
    `)/([^\`\\s]{1,${MAX_POWERHOUSE_REFERENCE_ID_LENGTH}})\` ` +
    `\\(([^\\n]{0,${MAX_POWERHOUSE_REFERENCE_DETAIL_LENGTH}}?)\\)(?=\\s)`,
  "g",
);

function isPowerhouseReferenceKind(value: string): value is PowerhouseReferenceKind {
  return (POWERHOUSE_REFERENCE_KINDS as ReadonlyArray<string>).includes(value);
}

/**
 * Facts are emitted in a fixed order — name, type, slug, path, reactor URL —
 * with empty ones left out, so a reader can peel them back from the right
 * without guessing what any one of them means.
 */
export function serializePowerhouseReference(fields: PowerhouseReferenceFields): string {
  const facts: string[] = [];
  if (fields.name.length > 0) facts.push(fields.name);
  if (fields.documentType.length > 0) facts.push(fields.documentType);
  if (fields.slug.length > 0) facts.push(`${POWERHOUSE_SLUG_FACT_PREFIX}${fields.slug}`);
  if (fields.path.length > 0) facts.push(`${POWERHOUSE_PATH_FACT_PREFIX}${fields.path}`);
  facts.push(fields.reactorUrl);
  return `\`powerhouse:${fields.kind}/${fields.id}\` (${facts.join(POWERHOUSE_FACT_SEPARATOR)})`;
}

/**
 * The name a reference carries, or empty when it named only an id. Read from the
 * right: the reactor URL is always last, the optional slots announce themselves
 * with a prefix, and a type slot exists only for a leaf. Whatever survives on
 * the left is the name, rejoined in case it contained the separator itself.
 */
function powerhouseReferenceName(kind: PowerhouseReferenceKind, detail: string): string {
  const facts = detail.split(POWERHOUSE_FACT_SEPARATOR);
  facts.pop();
  const last = () => facts[facts.length - 1] ?? "";
  if (facts.length > 0 && last().startsWith(POWERHOUSE_PATH_FACT_PREFIX)) facts.pop();
  if (facts.length > 0 && last().startsWith(POWERHOUSE_SLUG_FACT_PREFIX)) facts.pop();
  if (kind === "doc" && facts.length > 0) facts.pop();
  return facts.join(POWERHOUSE_FACT_SEPARATOR);
}

function collectPowerhouseTokens(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];
  for (const match of text.matchAll(POWERHOUSE_REFERENCE_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const kind = match[2] ?? "";
    const id = match[3] ?? "";
    const detail = match[4] ?? "";
    if (!isPowerhouseReferenceKind(kind) || id.length === 0) {
      continue;
    }
    const name = powerhouseReferenceName(kind, detail);
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "powerhouse",
      value: `${kind}/${id}`,
      kind,
      label: name.length > 0 ? name : id,
      detail,
      source: text.slice(start, end),
      start,
      end,
    });
  }
  return matches;
}

function collectMentionTokens(text: string): ComposerInlineToken[] {
  const matches: ComposerInlineToken[] = [];

  for (const match of text.matchAll(FILE_LINK_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const label = (match[2] ?? "").replace(/\\(.)/g, "$1");
    const encodedPath = match[3] ?? "";
    let path = encodedPath;
    try {
      path = decodeURIComponent(encodedPath);
    } catch {
      // Preserve malformed source rather than dropping a user-authored token.
    }
    const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
    const basename = separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
    const hasExternalScheme = URI_SCHEME_REGEX.test(path) && !WINDOWS_DRIVE_PATH_REGEX.test(path);
    if (!path || hasExternalScheme || label !== basename) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const match of text.matchAll(MENTION_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const quotedPath = match[2];
    const path = quotedPath !== undefined ? quotedPath.replace(/\\(.)/g, "$1") : (match[3] ?? "");
    if (!path || (quotedPath === undefined && SCOPED_PACKAGE_REFERENCE_REGEX.test(path))) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "mention",
      value: path,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  return matches;
}

export function collectComposerInlineTokens(
  text: string,
  options: CollectComposerInlineTokensOptions = {},
): ReadonlyArray<ComposerInlineToken> {
  const matches = [...collectMentionTokens(text), ...collectPowerhouseTokens(text)];

  for (const match of text.matchAll(SKILL_TOKEN_REGEX)) {
    const fullMatch = match[0];
    const prefix = match[1] ?? "";
    const value = match[2] ?? "";
    if (!value) {
      continue;
    }
    const start = (match.index ?? 0) + prefix.length;
    const end = start + fullMatch.length - prefix.length;
    matches.push({
      type: "skill",
      value,
      source: text.slice(start, end),
      start,
      end,
    });
  }

  for (const token of options.preserveTrailingFrom ?? []) {
    if (
      token.end === text.length &&
      text.slice(token.start, token.end) === token.source &&
      !matches.some(
        (match) =>
          match.type === token.type && match.start === token.start && match.end === token.end,
      )
    ) {
      matches.push(token);
    }
  }

  return [...matches].sort((left, right) => left.start - right.start);
}
