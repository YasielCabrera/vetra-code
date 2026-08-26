/**
 * Pure helpers for the Powerhouse panel. Kept out of the components so the
 * parts worth testing — version selection, failure wording, cursor paging —
 * can be tested without rendering anything.
 */
import type {
  PowerhouseDocumentModel,
  PowerhouseDocumentModelFailure,
  PowerhouseDocumentModelSpecification,
  PowerhouseReactorConnection,
  PowerhouseReactorFailure,
} from "@vetra-code/contracts";

/** Index of the newest specification: highest version, last entry breaking ties. */
export function latestSpecificationIndex(
  specifications: ReadonlyArray<PowerhouseDocumentModelSpecification>,
): number | null {
  if (specifications.length === 0) return null;
  let bestIndex = 0;
  for (let index = 1; index < specifications.length; index += 1) {
    const best = specifications[bestIndex]?.version ?? Number.NEGATIVE_INFINITY;
    const candidate = specifications[index]?.version ?? Number.NEGATIVE_INFINITY;
    if (candidate >= best) bestIndex = index;
  }
  return bestIndex;
}

/**
 * The specification to show: the user's pick when it still exists, otherwise
 * the newest. A stored index outlives the model it was chosen from.
 */
export function resolveSpecificationIndex(
  model: PowerhouseDocumentModel,
  selectedIndex: number | null,
): number | null {
  if (selectedIndex !== null && selectedIndex >= 0 && selectedIndex < model.specifications.length) {
    return selectedIndex;
  }
  return latestSpecificationIndex(model.specifications);
}

export function specificationLabel(
  specification: PowerhouseDocumentModelSpecification,
  index: number,
): string {
  return specification.version === null
    ? `Revision ${index + 1}`
    : `Version ${specification.version}`;
}

/** Powerhouse files may store extensions as either `todo` or `.todo`. */
export function displayModelExtension(extension: string): string {
  const normalized = extension.trim();
  if (normalized.length === 0) return "";
  return normalized.startsWith(".") ? normalized : `.${normalized}`;
}

const MODEL_FAILURE_TEXT: Record<PowerhouseDocumentModelFailure["reason"], string> = {
  missing_json: "no matching JSON file",
  invalid_json: "invalid JSON",
  invalid_shape: "not a document model",
  read_failed: "could not be read",
  too_large: "too large to display",
};

/** "todo/todo.json: invalid JSON" — names the file the author has to open. */
export function describeModelFailure(failure: PowerhouseDocumentModelFailure): string {
  const path = `${failure.directoryName}/${failure.directoryName}.json`;
  return `${path}: ${MODEL_FAILURE_TEXT[failure.reason]}`;
}

export interface ReactorFailureCopy {
  readonly title: string;
  readonly detail: string;
}

/**
 * What to tell the user about a failed connection.
 *
 * Every case names what was actually tried, because "could not connect" with no
 * address is the kind of message that sends people to the source.
 */
export function describeReactorFailure(error: {
  readonly failure: PowerhouseReactorFailure;
  readonly url?: string | undefined;
  readonly attempted?: ReadonlyArray<string> | undefined;
  readonly status?: number | undefined;
  readonly graphqlMessages?: ReadonlyArray<string> | undefined;
}): ReactorFailureCopy {
  const attempted = error.attempted ?? (error.url === undefined ? [] : [error.url]);
  const where =
    attempted.length === 0 ? "the configured address" : attempted.map(displayReactorUrl).join(", ");
  const primaryWhere = error.url === undefined ? where : displayReactorUrl(error.url);
  switch (error.failure) {
    case "unreachable":
      return {
        title: "No reactor is running",
        detail: `Nothing is listening on ${where}. Run ph reactor, or point the panel at a running reactor.`,
      };
    case "not_a_reactor":
      return {
        title: "That is not a reactor",
        detail: `Something answered on ${primaryWhere}, but it did not identify as a Powerhouse reactor.`,
      };
    case "invalid_url":
      return {
        title: "That address cannot be used",
        detail: "Enter an http or https URL, for example http://127.0.0.1:4001.",
      };
    case "invalid_request":
      return {
        title: "That request cannot be sent",
        detail: "Check the operation, variables, and request headers, then try again.",
      };
    case "http_error":
      return {
        title: "The reactor rejected the request",
        detail: `${primaryWhere} responded with HTTP ${error.status ?? "error"}.`,
      };
    case "graphql_error":
      return {
        title: "The reactor returned an error",
        detail: error.graphqlMessages?.join(" ") ?? "The reactor rejected the query.",
      };
    case "timeout":
      return {
        title: "The reactor did not respond",
        detail: `${primaryWhere} did not answer in time.`,
      };
    case "decode_failed":
      return {
        title: "Unreadable response",
        detail: `${where} answered with data this version of Vetra Code cannot read. The reactor may be newer than this client.`,
      };
  }
}

/**
 * Canonicalize a user-entered reactor base URL before it is persisted.
 * Credentials and query fragments are never forwarded by the server, so
 * retaining them in local storage would be both misleading and unnecessary.
 */
export function normalizeReactorUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const serialized = parsed.toString();
  return parsed.pathname === "/" ? serialized.slice(0, -1) : serialized;
}

/** `http://127.0.0.1:4001` → `127.0.0.1:4001`; the scheme is noise in a status chip. */
export function displayReactorUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/+$/, "");
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

export function describeConnection(connection: PowerhouseReactorConnection): string {
  const version = connection.system.version;
  const address = displayReactorUrl(connection.url);
  return version === null ? address : `${address} · v${version}`;
}

/** Client-side check mirroring the server's, so a bad URL reads as wrong immediately. */
export function isUsableReactorUrl(value: string): boolean {
  return normalizeReactorUrl(value) !== null;
}

/** "3 loaded" — never "3 of N": the reactor's totals are page lengths, not totals. */
export function describeLoadedCount(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"} loaded`;
}

const OPERATION_TIMESTAMP_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatOperationTimestamp(timestampUtcMs: string | null): string {
  if (timestampUtcMs === null) return "";
  const millis = Number(timestampUtcMs);
  if (!Number.isFinite(millis)) return timestampUtcMs;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? timestampUtcMs : OPERATION_TIMESTAMP_FORMATTER.format(date);
}

export function documentDisplayName(document: {
  readonly name: string | null;
  readonly slug: string | null;
  readonly id: string;
}): string {
  const name = document.name?.trim();
  if (name !== undefined && name.length > 0) return name;
  const slug = document.slug?.trim();
  if (slug !== undefined && slug.length > 0) return slug;
  return document.id;
}
