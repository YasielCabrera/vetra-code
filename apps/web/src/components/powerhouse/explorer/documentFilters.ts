import type {
  PowerhouseReactorDocumentSearchFilter,
  PowerhouseReactorDocumentSummary,
  PowerhouseReactorDocumentViewFilter,
} from "@vetra-code/contracts";
import {
  POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT,
  POWERHOUSE_REACTOR_ID_MAX_LENGTH,
  POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH,
} from "@vetra-code/contracts";

export interface PowerhouseDocumentFilters {
  readonly type: string;
  /** Empty means the explorer's current drive or folder. */
  readonly parentId: string;
  readonly identifiers: ReadonlyArray<string>;
  readonly branch: string;
  readonly scopes: ReadonlyArray<string>;
}

export interface PowerhouseDocumentFilterDraft {
  readonly type: string;
  readonly parentId: string;
  readonly identifiers: string;
  readonly branch: string;
  readonly scopes: string;
}

export interface PowerhouseDocumentFilterErrors {
  readonly identifiers: string | null;
  readonly scopes: string | null;
}

export const EMPTY_POWERHOUSE_DOCUMENT_FILTERS: PowerhouseDocumentFilters = {
  type: "",
  parentId: "",
  identifiers: [],
  branch: "",
  scopes: [],
};

export const EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS: PowerhouseDocumentFilterErrors = {
  identifiers: null,
  scopes: null,
};

/** Commas and newlines separate exact Switchboard list-filter values. */
export function parseDocumentFilterValues(value: string): ReadonlyArray<string> {
  const seen = new Set<string>();
  const values: Array<string> = [];
  for (const raw of value.split(/[,\n]/)) {
    const entry = raw.trim();
    if (entry.length === 0 || seen.has(entry)) continue;
    seen.add(entry);
    values.push(entry);
  }
  return values;
}

export function documentFilterDraft(
  filters: PowerhouseDocumentFilters,
): PowerhouseDocumentFilterDraft {
  return {
    type: filters.type,
    parentId: filters.parentId,
    identifiers: filters.identifiers.join(", "),
    branch: filters.branch,
    scopes: filters.scopes.join(", "),
  };
}

function listFilterError(values: ReadonlyArray<string>, noun: string, maxValueLength: number) {
  if (values.length > POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT) {
    return `Enter at most ${POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT} ${noun}.`;
  }
  if (values.some((value) => value.length > maxValueLength)) {
    return `One or more ${noun} are too long.`;
  }
  return null;
}

export function parseDocumentFilterDraft(draft: PowerhouseDocumentFilterDraft): {
  readonly filters: PowerhouseDocumentFilters;
  readonly errors: PowerhouseDocumentFilterErrors;
} {
  const identifiers = parseDocumentFilterValues(draft.identifiers);
  const scopes = parseDocumentFilterValues(draft.scopes);
  return {
    filters: {
      type: draft.type.trim(),
      parentId: draft.parentId.trim(),
      identifiers,
      branch: draft.branch.trim(),
      scopes,
    },
    errors: {
      identifiers: listFilterError(identifiers, "identifiers", POWERHOUSE_REACTOR_ID_MAX_LENGTH),
      scopes: listFilterError(scopes, "scopes", POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH),
    },
  };
}

export function documentFilterCount(filters: PowerhouseDocumentFilters): number {
  return (
    Number(filters.type.length > 0) +
    Number(filters.parentId.length > 0) +
    Number(filters.identifiers.length > 0) +
    Number(filters.branch.length > 0) +
    Number(filters.scopes.length > 0)
  );
}

/** Search fields that can make `findDocuments` return a set at reactor root. */
export function hasExplicitDocumentSearch(filters: PowerhouseDocumentFilters): boolean {
  return filters.type.length > 0 || filters.parentId.length > 0 || filters.identifiers.length > 0;
}

export function reactorDocumentSearch(
  filters: PowerhouseDocumentFilters,
  currentParentId: string | null,
): PowerhouseReactorDocumentSearchFilter {
  const parentId = filters.parentId || currentParentId;
  return {
    ...(filters.type.length === 0 ? {} : { type: filters.type }),
    ...(parentId === null ? {} : { parentId }),
    ...(filters.identifiers.length === 0 ? {} : { identifiers: filters.identifiers }),
  };
}

export function reactorDocumentView(
  filters: PowerhouseDocumentFilters,
): PowerhouseReactorDocumentViewFilter | undefined {
  if (filters.branch.length === 0 && filters.scopes.length === 0) return undefined;
  return {
    ...(filters.branch.length === 0 ? {} : { branch: filters.branch }),
    ...(filters.scopes.length === 0 ? {} : { scopes: filters.scopes }),
  };
}

const documentTextSearchTerms = (query: string) =>
  query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

function documentMatchesTerms(
  document: PowerhouseReactorDocumentSummary,
  terms: ReadonlyArray<string>,
): boolean {
  if (terms.length === 0) return true;
  const text = [document.name, document.slug, document.id, document.documentType]
    .filter((value): value is string => value !== null)
    .join("\n")
    .toLowerCase();
  return terms.every((term) => text.includes(term));
}

/** Case-insensitive AND search across the summary fields already loaded. */
export function documentMatchesTextSearch(
  document: PowerhouseReactorDocumentSummary,
  query: string,
): boolean {
  return documentMatchesTerms(document, documentTextSearchTerms(query));
}

/** Parse the query once, then narrow a bounded reactor page in one pass. */
export function filterDocumentsByTextSearch(
  documents: ReadonlyArray<PowerhouseReactorDocumentSummary>,
  query: string,
): ReadonlyArray<PowerhouseReactorDocumentSummary> {
  const terms = documentTextSearchTerms(query);
  if (terms.length === 0) return documents;
  const matching: Array<PowerhouseReactorDocumentSummary> = [];
  for (const document of documents) {
    if (documentMatchesTerms(document, terms)) matching.push(document);
  }
  return matching;
}

export function documentFilterBadges(filters: PowerhouseDocumentFilters): ReadonlyArray<string> {
  const badges: Array<string> = [];
  if (filters.type.length > 0) badges.push(`Type: ${filters.type}`);
  if (filters.parentId.length > 0) badges.push(`Parent: ${filters.parentId}`);
  if (filters.identifiers.length > 0) {
    badges.push(
      `${filters.identifiers.length} identifier${filters.identifiers.length === 1 ? "" : "s"}`,
    );
  }
  if (filters.branch.length > 0) badges.push(`Branch: ${filters.branch}`);
  if (filters.scopes.length > 0) {
    badges.push(`${filters.scopes.length} scope${filters.scopes.length === 1 ? "" : "s"}`);
  }
  return badges;
}
