export type PowerhouseDocumentViewOptionGroup = "default" | "model" | "system";

export interface PowerhouseDocumentViewOption {
  readonly value: string;
  readonly label: string;
  readonly group: PowerhouseDocumentViewOptionGroup;
}

export const POWERHOUSE_BRANCH_OPTIONS = [
  {
    value: "main",
    label: "Main branch",
    group: "default",
  },
] as const satisfies ReadonlyArray<PowerhouseDocumentViewOption>;

export const POWERHOUSE_SCOPE_OPTIONS = [
  {
    value: "global",
    label: "Global state",
    group: "model",
  },
  {
    value: "local",
    label: "Local state",
    group: "model",
  },
  {
    value: "document",
    label: "Document lifecycle",
    group: "system",
  },
  {
    value: "auth",
    label: "Authorization",
    group: "system",
  },
  {
    value: "header",
    label: "Document header",
    group: "system",
  },
] as const satisfies ReadonlyArray<PowerhouseDocumentViewOption>;

/** Match the friendly name and exact Switchboard value with AND search semantics. */
export function filterDocumentViewOptions(
  options: ReadonlyArray<PowerhouseDocumentViewOption>,
  query: string,
): ReadonlyArray<PowerhouseDocumentViewOption> {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return options;

  return options.filter((option) => {
    const searchable = `${option.label}\n${option.value}`.toLocaleLowerCase();
    return terms.every((term) => searchable.includes(term));
  });
}

/** Preserve custom branches and scopes without duplicating an exact known value. */
export function customDocumentViewValue(
  knownValues: ReadonlyArray<string>,
  query: string,
): string | null {
  const value = query.trim();
  if (value.length === 0 || knownValues.includes(value)) return null;
  return value;
}
