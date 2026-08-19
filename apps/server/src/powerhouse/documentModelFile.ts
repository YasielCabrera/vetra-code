/**
 * documentModelFile - parsing of Powerhouse document model JSON.
 *
 * The only place that knows the on-disk file shape. Everything the panel does
 * not render is ignored, so a format change upstream lands here and nowhere
 * else. Parsing is total: a file that cannot be read as a model resolves to a
 * failure reason rather than throwing.
 *
 * @module documentModelFile
 */
import type {
  PowerhouseDocumentModel,
  PowerhouseDocumentModelFailureReason,
  PowerhouseDocumentModelModule,
  PowerhouseDocumentModelOperation,
  PowerhouseDocumentModelSpecification,
  PowerhouseDocumentModelSummary,
} from "@vetra-code/contracts";
import {
  POWERHOUSE_MODEL_SUMMARY_DESCRIPTION_MAX_LENGTH,
  POWERHOUSE_MODEL_SUMMARY_EXTENSION_MAX_LENGTH,
  POWERHOUSE_MODEL_SUMMARY_ID_MAX_LENGTH,
  POWERHOUSE_MODEL_SUMMARY_NAME_MAX_LENGTH,
} from "@vetra-code/contracts";
import * as Predicate from "effect/Predicate";

export type ParsedDocumentModel =
  | { readonly ok: true; readonly model: PowerhouseDocumentModel }
  | { readonly ok: false; readonly reason: PowerhouseDocumentModelFailureReason };

const readString = (value: unknown): string => (typeof value === "string" ? value : "");

const readNullableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readNullableInt = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

const readArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : []);

const readStringArray = (value: unknown): ReadonlyArray<string> =>
  readArray(value).filter((entry): entry is string => typeof entry === "string");

const truncateSummaryText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  let end = maxLength - 1;
  const finalCodeUnit = value.charCodeAt(end - 1);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff) end -= 1;
  return `${value.slice(0, end)}…`;
};

function parseOperation(raw: unknown): PowerhouseDocumentModelOperation {
  const record = Predicate.isObject(raw) ? raw : {};
  return {
    name: readString(record.name),
    description: readNullableString(record.description),
    schema: readNullableString(record.schema),
    scope: readNullableString(record.scope),
  };
}

function parseModule(raw: unknown): PowerhouseDocumentModelModule {
  const record = Predicate.isObject(raw) ? raw : {};
  return {
    name: readString(record.name),
    description: readNullableString(record.description),
    operations: readArray(record.operations).map(parseOperation),
  };
}

function parseSpecification(raw: unknown): PowerhouseDocumentModelSpecification {
  const record = Predicate.isObject(raw) ? raw : {};
  const state = Predicate.isObject(record.state) ? record.state : {};
  const global = Predicate.isObject(state.global) ? state.global : {};
  const local = Predicate.isObject(state.local) ? state.local : {};
  return {
    version: readNullableInt(record.version),
    changeLog: readStringArray(record.changeLog),
    globalSchema: readString(global.schema),
    localSchema: readString(local.schema),
    modules: readArray(record.modules).map(parseModule),
  };
}

/**
 * Parse a `<name>/<name>.json` body into the projection the panel renders.
 *
 * A model needs an `id`, a `name`, and a `specifications` array to be usable;
 * anything else missing degrades to an empty value rather than a failure,
 * because half-generated models are a normal state mid-authoring.
 */
export function parseDocumentModelFile(input: {
  readonly directoryName: string;
  readonly contents: string;
}): ParsedDocumentModel {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.contents);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!Predicate.isObject(parsed)) {
    return { ok: false, reason: "invalid_shape" };
  }
  if (
    typeof parsed.id !== "string" ||
    parsed.id.trim().length === 0 ||
    typeof parsed.name !== "string" ||
    parsed.name.trim().length === 0
  ) {
    return { ok: false, reason: "invalid_shape" };
  }
  if (!Array.isArray(parsed.specifications)) {
    return { ok: false, reason: "invalid_shape" };
  }
  const author = Predicate.isObject(parsed.author)
    ? { name: readString(parsed.author.name), website: readNullableString(parsed.author.website) }
    : null;
  return {
    ok: true,
    model: {
      directoryName: input.directoryName,
      id: parsed.id,
      name: parsed.name,
      extension: readString(parsed.extension),
      description: readString(parsed.description),
      author,
      specifications: parsed.specifications.map(parseSpecification),
    },
  };
}

/**
 * The newest specification in a model.
 *
 * Powerhouse stores versions as repeated entries in one file and appends new
 * ones, so the highest `version` wins and the last entry breaks ties (and
 * covers files whose specs carry no version at all).
 */
export function latestSpecification(
  model: PowerhouseDocumentModel,
): PowerhouseDocumentModelSpecification | null {
  let latest: PowerhouseDocumentModelSpecification | null = null;
  for (const specification of model.specifications) {
    if (latest === null) {
      latest = specification;
      continue;
    }
    const latestVersion = latest.version ?? Number.NEGATIVE_INFINITY;
    const candidateVersion = specification.version ?? Number.NEGATIVE_INFINITY;
    if (candidateVersion >= latestVersion) {
      latest = specification;
    }
  }
  return latest;
}

/** List-row projection of a model: identity plus counts for its newest version. */
export function summarizeDocumentModel(
  model: PowerhouseDocumentModel,
): PowerhouseDocumentModelSummary {
  const latest = latestSpecification(model);
  const modules = latest?.modules ?? [];
  return {
    directoryName: model.directoryName,
    id: truncateSummaryText(model.id, POWERHOUSE_MODEL_SUMMARY_ID_MAX_LENGTH),
    name: truncateSummaryText(model.name, POWERHOUSE_MODEL_SUMMARY_NAME_MAX_LENGTH),
    extension: truncateSummaryText(model.extension, POWERHOUSE_MODEL_SUMMARY_EXTENSION_MAX_LENGTH),
    description: truncateSummaryText(
      model.description,
      POWERHOUSE_MODEL_SUMMARY_DESCRIPTION_MAX_LENGTH,
    ),
    specCount: model.specifications.length,
    latestVersion: latest?.version ?? null,
    moduleCount: modules.length,
    operationCount: modules.reduce((total, module) => total + module.operations.length, 0),
  };
}
