import type { PowerhouseDocumentModelSummary } from "@vetra-code/contracts";

export type PowerhouseDocumentTypeSource = "system" | "model";

export interface PowerhouseDocumentTypeOption {
  readonly value: string;
  readonly label: string;
  readonly source: PowerhouseDocumentTypeSource;
}

export type PowerhouseDocumentTypeCatalogStatus = "loading" | "ready" | "partial" | "error";

export const SYSTEM_POWERHOUSE_DOCUMENT_TYPE_OPTIONS = [
  {
    value: "powerhouse/document-drive",
    label: "Document drive",
    source: "system",
  },
  {
    value: "powerhouse/reactor-drive",
    label: "Reactor drive",
    source: "system",
  },
  {
    value: "powerhouse/folder",
    label: "Folder",
    source: "system",
  },
] as const satisfies ReadonlyArray<PowerhouseDocumentTypeOption>;

type DocumentModelType = Pick<PowerhouseDocumentModelSummary, "id" | "name">;

/** Built-ins stay first; project models are deduplicated by their exact type identifier. */
export function documentTypeOptions(
  models: ReadonlyArray<DocumentModelType>,
): ReadonlyArray<PowerhouseDocumentTypeOption> {
  const values = new Set<string>(SYSTEM_POWERHOUSE_DOCUMENT_TYPE_OPTIONS.map(({ value }) => value));
  const modelOptions: Array<PowerhouseDocumentTypeOption> = [];

  for (const model of models) {
    const value = model.id.trim();
    if (value.length === 0 || values.has(value)) continue;
    values.add(value);
    modelOptions.push({
      value,
      label: model.name.trim() || value,
      source: "model",
    });
  }

  modelOptions.sort(
    (left, right) => left.label.localeCompare(right.label) || left.value.localeCompare(right.value),
  );

  return [...SYSTEM_POWERHOUSE_DOCUMENT_TYPE_OPTIONS, ...modelOptions];
}

/** Match friendly names and exact identifiers so either vocabulary finds the same type. */
export function filterDocumentTypeOptions(
  options: ReadonlyArray<PowerhouseDocumentTypeOption>,
  query: string,
): ReadonlyArray<PowerhouseDocumentTypeOption> {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return options;

  return options.filter((option) => {
    const searchable = `${option.label}\n${option.value}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

export function customDocumentTypeValue(
  options: ReadonlyArray<PowerhouseDocumentTypeOption>,
  query: string,
): string | null {
  const value = query.trim();
  if (value.length === 0 || options.some((option) => option.value === value)) return null;
  return value;
}
