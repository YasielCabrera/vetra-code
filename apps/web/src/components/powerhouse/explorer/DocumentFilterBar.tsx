import {
  POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH,
  POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT,
  POWERHOUSE_REACTOR_ID_MAX_LENGTH,
  POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH,
} from "@vetra-code/contracts";
import {
  FileType2,
  Fingerprint,
  FolderTree,
  GitBranch,
  Layers3,
  ListFilter,
  Plus,
  Search,
  X,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type ChangeEvent, type FormEvent } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { Fieldset, FieldsetLegend } from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import {
  Popover,
  PopoverDescription,
  PopoverPopup,
  PopoverTitle,
  PopoverTrigger,
} from "~/components/ui/popover";
import { Textarea } from "~/components/ui/textarea";

import {
  activeDocumentFilterFields,
  clearDocumentFilterField,
  documentFilterDraft,
  emptyDocumentFilterDraftFields,
  EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS,
  EMPTY_POWERHOUSE_DOCUMENT_FILTERS,
  hasExplicitDocumentSearch,
  parseDocumentFilterDraft,
  POWERHOUSE_DOCUMENT_FILTER_FIELDS,
  type PowerhouseDocumentFilterDraft,
  type PowerhouseDocumentFilterErrors,
  type PowerhouseDocumentFilterField,
  type PowerhouseDocumentFilters,
} from "./documentFilters";
import { DocumentTypePicker } from "./DocumentTypePicker";
import { BranchPicker, ScopePicker } from "./DocumentViewPickers";
import type {
  PowerhouseDocumentTypeCatalogStatus,
  PowerhouseDocumentTypeOption,
} from "./documentTypeOptions";

interface DocumentFilterBarProps {
  query: string;
  filters: PowerhouseDocumentFilters;
  currentParentId: string | null;
  documentTypeOptions: ReadonlyArray<PowerhouseDocumentTypeOption>;
  documentTypeCatalogStatus: PowerhouseDocumentTypeCatalogStatus;
  onQueryChange: (query: string) => void;
  onFiltersChange: (filters: PowerhouseDocumentFilters) => void;
}

interface DocumentFilterFieldDefinition {
  readonly field: PowerhouseDocumentFilterField;
  readonly label: string;
  readonly shortLabel: string;
  readonly operator: string;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly multiline?: boolean;
  readonly Icon: LucideIcon;
}

const listInputMaxLength = (valueMaxLength: number) =>
  (valueMaxLength + 2) * POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT;
const LOCAL_SEARCH_MAX_LENGTH = 4096;

const FILTER_FIELD_DEFINITIONS: Record<
  PowerhouseDocumentFilterField,
  DocumentFilterFieldDefinition
> = {
  type: {
    field: "type",
    label: "Document type",
    shortLabel: "Type",
    operator: "is",
    placeholder: "namespace/model",
    maxLength: POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH,
    Icon: FileType2,
  },
  parentId: {
    field: "parentId",
    label: "Parent identifier",
    shortLabel: "Parent",
    operator: "is",
    placeholder: "Any parent",
    maxLength: POWERHOUSE_REACTOR_ID_MAX_LENGTH,
    Icon: FolderTree,
  },
  identifiers: {
    field: "identifiers",
    label: "Identifiers",
    shortLabel: "Identifiers",
    operator: "is any of",
    placeholder: "Document IDs or slugs, comma-separated",
    maxLength: listInputMaxLength(POWERHOUSE_REACTOR_ID_MAX_LENGTH),
    multiline: true,
    Icon: Fingerprint,
  },
  branch: {
    field: "branch",
    label: "Branch",
    shortLabel: "Branch",
    operator: "is",
    placeholder: "main or custom branch",
    maxLength: POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH,
    Icon: GitBranch,
  },
  scopes: {
    field: "scopes",
    label: "Scopes",
    shortLabel: "Scopes",
    operator: "uses",
    placeholder: "global, local, or system scope",
    maxLength: listInputMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH),
    Icon: Layers3,
  },
};

const FILTER_FIELDS = POWERHOUSE_DOCUMENT_FILTER_FIELDS.map(
  (field) => FILTER_FIELD_DEFINITIONS[field],
);

function filterDescription(field: PowerhouseDocumentFilterField, currentParentId: string | null) {
  switch (field) {
    case "type":
      return "Choose a project model or built-in container type. Custom type IDs are also supported.";
    case "parentId":
      return currentParentId === null
        ? "Search this parent directly from the reactor root."
        : "Overrides the current drive or folder; remove it to keep the current parent.";
    case "identifiers":
      return "Exact IDs or slugs; commas or new lines separate values.";
    case "branch":
      return "main is Powerhouse’s default branch. Custom branch names are also supported.";
    case "scopes":
      return "Choose one or more document or system scopes. Remove this filter to include every scope.";
  }
}

function filterError(
  errors: PowerhouseDocumentFilterErrors,
  missingFields: ReadonlyArray<PowerhouseDocumentFilterField>,
  field: PowerhouseDocumentFilterField,
) {
  if (missingFields.includes(field)) return "Enter a value or remove this filter.";
  if (field === "identifiers") return errors.identifiers;
  if (field === "scopes") return errors.scopes;
  return null;
}

function appliedFilterValue(
  filters: PowerhouseDocumentFilters,
  field: PowerhouseDocumentFilterField,
) {
  const value = filters[field];
  if (typeof value === "string") return value;
  if (value.length <= 1) return value[0] ?? "";
  return `${value[0]} +${value.length - 1}`;
}

export function DocumentFilterBar({
  query,
  filters,
  currentParentId,
  documentTypeOptions,
  documentTypeCatalogStatus,
  onQueryChange,
  onFiltersChange,
}: DocumentFilterBarProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PowerhouseDocumentFilterDraft>(() =>
    documentFilterDraft(filters),
  );
  const [selectedFields, setSelectedFields] = useState<
    ReadonlyArray<PowerhouseDocumentFilterField>
  >(() => activeDocumentFilterFields(filters));
  const [choosingField, setChoosingField] = useState(false);
  const [lastAddedField, setLastAddedField] = useState<PowerhouseDocumentFilterField | null>(null);
  const [missingFields, setMissingFields] = useState<ReadonlyArray<PowerhouseDocumentFilterField>>(
    [],
  );
  const [errors, setErrors] = useState<PowerhouseDocumentFilterErrors>(
    EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS,
  );
  const filterFormId = useId();
  const activeFields = activeDocumentFilterFields(filters);
  const activeCount = activeFields.length;
  const searchingDocuments = currentParentId !== null || hasExplicitDocumentSearch(filters);
  const appliedDraft = documentFilterDraft(filters);
  const availableFields = FILTER_FIELDS.filter(({ field }) => !selectedFields.includes(field));
  const draftChanged =
    selectedFields.join("\u0000") !== activeFields.join("\u0000") ||
    POWERHOUSE_DOCUMENT_FILTER_FIELDS.some((field) => draft[field] !== appliedDraft[field]);

  const updateDraft = (field: PowerhouseDocumentFilterField, value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setMissingFields((previous) => previous.filter((candidate) => candidate !== field));
  };

  const prepareEditor = (focusField: PowerhouseDocumentFilterField | null = null) => {
    const nextFields = activeDocumentFilterFields(filters);
    setDraft(documentFilterDraft(filters));
    setSelectedFields(nextFields);
    setChoosingField(nextFields.length === 0);
    setLastAddedField(focusField);
    setMissingFields([]);
    setErrors(EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS);
  };

  const setPopoverOpen = (next: boolean) => {
    if (next) prepareEditor();
    setOpen(next);
  };

  const editAppliedFilter = (field: PowerhouseDocumentFilterField) => {
    prepareEditor(field);
    setOpen(true);
  };

  const addDraftField = (field: PowerhouseDocumentFilterField) => {
    setSelectedFields((previous) => (previous.includes(field) ? previous : [...previous, field]));
    setChoosingField(false);
    setLastAddedField(field);
  };

  const removeDraftField = (field: PowerhouseDocumentFilterField) => {
    setSelectedFields((previous) => previous.filter((candidate) => candidate !== field));
    setDraft((previous) => ({ ...previous, [field]: "" }));
    setLastAddedField((previous) => (previous === field ? null : previous));
    setMissingFields((previous) => previous.filter((candidate) => candidate !== field));
    if (field === "identifiers") {
      setErrors((previous) => ({ ...previous, identifiers: null }));
    } else if (field === "scopes") {
      setErrors((previous) => ({ ...previous, scopes: null }));
    }
  };

  const removeAllDraftFields = () => {
    setDraft(documentFilterDraft(EMPTY_POWERHOUSE_DOCUMENT_FILTERS));
    setSelectedFields([]);
    setChoosingField(true);
    setLastAddedField(null);
    setMissingFields([]);
    setErrors(EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS);
  };

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseDocumentFilterDraft(draft);
    const nextMissingFields = emptyDocumentFilterDraftFields(draft, selectedFields);
    setMissingFields(nextMissingFields);
    setErrors(parsed.errors);
    if (
      nextMissingFields.length > 0 ||
      parsed.errors.identifiers !== null ||
      parsed.errors.scopes !== null
    ) {
      return;
    }
    onFiltersChange(parsed.filters);
    setOpen(false);
  };

  const clearAppliedFilters = () => {
    removeAllDraftFields();
    onFiltersChange(EMPTY_POWERHOUSE_DOCUMENT_FILTERS);
    setOpen(false);
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl shrink-0 flex-col gap-2 px-3 pt-3 @[32rem]:px-5">
      <div className="flex min-w-0 items-center gap-2">
        <InputGroup className="min-w-0 flex-1">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            size="sm"
            name="powerhouse-document-search"
            value={query}
            maxLength={LOCAL_SEARCH_MAX_LENGTH}
            aria-label={`Search loaded Powerhouse ${searchingDocuments ? "documents" : "drives"}`}
            placeholder={searchingDocuments ? "Search name, slug, ID, or type…" : "Search drives…"}
            spellCheck={false}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              onQueryChange("");
              event.currentTarget.blur();
            }}
          />
          {query.length === 0 ? null : (
            <InputGroupAddon align="inline-end">
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label="Clear document search"
                title="Clear search"
                onClick={() => onQueryChange("")}
              >
                <X aria-hidden />
              </Button>
            </InputGroupAddon>
          )}
        </InputGroup>

        <Popover open={open} onOpenChange={setPopoverOpen}>
          <PopoverTrigger
            render={
              <Button
                size="sm"
                variant={activeCount === 0 ? "outline" : "secondary"}
                aria-label={`Document filters${activeCount === 0 ? "" : `, ${activeCount} active`}`}
              />
            }
          >
            <ListFilter data-icon="inline-start" aria-hidden />
            <span className="hidden @[26rem]:inline">Filters</span>
            {activeCount === 0 ? null : (
              <Badge size="sm" variant="outline">
                {activeCount}
              </Badge>
            )}
          </PopoverTrigger>
          <PopoverPopup
            align="end"
            side="bottom"
            className="w-[min(27rem,calc(100vw-1rem))] max-w-none"
          >
            <PopoverTitle className="text-sm">Filter documents</PopoverTitle>
            <PopoverDescription className="mt-1 mb-4 text-xs leading-relaxed">
              Choose only the fields you need. Each row shows the matching behavior supported by
              Switchboard.
            </PopoverDescription>

            <form className="flex flex-col gap-3" onSubmit={apply}>
              {selectedFields.length === 0 ? null : (
                <Fieldset className="max-w-none gap-0 overflow-hidden rounded-lg border border-border/70 bg-background/50">
                  <FieldsetLegend className="sr-only">Selected document filters</FieldsetLegend>
                  {selectedFields.map((field) => {
                    const definition = FILTER_FIELD_DEFINITIONS[field];
                    const error = filterError(errors, missingFields, field);
                    const inputId = `${filterFormId}-${field}`;
                    const controlProps = {
                      id: inputId,
                      value: draft[field],
                      maxLength: definition.maxLength,
                      "aria-invalid": error !== null,
                      placeholder:
                        field === "parentId" && currentParentId !== null
                          ? currentParentId
                          : definition.placeholder,
                      spellCheck: false,
                      autoFocus: lastAddedField === field,
                      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
                        updateDraft(field, event.target.value),
                    };
                    return (
                      <Field
                        key={field}
                        data-invalid={error !== null}
                        className="gap-1.5 border-b border-border/60 p-3 last:border-b-0"
                      >
                        <div className="flex w-full min-w-0 items-center gap-2">
                          <FieldLabel htmlFor={inputId} className="min-w-0 flex-1">
                            <definition.Icon
                              aria-hidden
                              className="size-3.5 shrink-0 text-muted-foreground"
                            />
                            <span className="truncate">{definition.label}</span>
                          </FieldLabel>
                          <span className="shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-[.625rem] font-medium text-muted-foreground">
                            {definition.operator}
                          </span>
                          <Button
                            type="button"
                            size="icon-micro"
                            variant="ghost-muted"
                            aria-label={`Remove ${definition.label} filter`}
                            title={`Remove ${definition.label}`}
                            onClick={() => removeDraftField(field)}
                          >
                            <X aria-hidden />
                          </Button>
                        </div>
                        {field === "type" ? (
                          <DocumentTypePicker
                            id={inputId}
                            value={draft.type}
                            options={documentTypeOptions}
                            catalogStatus={documentTypeCatalogStatus}
                            invalid={error !== null}
                            autoFocus={lastAddedField === field}
                            onChange={(value) => updateDraft(field, value)}
                          />
                        ) : field === "branch" ? (
                          <BranchPicker
                            id={inputId}
                            value={draft.branch}
                            invalid={error !== null}
                            autoFocus={lastAddedField === field}
                            onChange={(value) => updateDraft(field, value)}
                          />
                        ) : field === "scopes" ? (
                          <ScopePicker
                            id={inputId}
                            value={draft.scopes}
                            invalid={error !== null}
                            autoFocus={lastAddedField === field}
                            onChange={(value) => updateDraft(field, value)}
                          />
                        ) : definition.multiline ? (
                          <Textarea size="sm" {...controlProps} />
                        ) : (
                          <Input size="sm" {...controlProps} />
                        )}
                        {error === null ? (
                          <FieldDescription>
                            {filterDescription(field, currentParentId)}
                          </FieldDescription>
                        ) : (
                          <FieldError>{error}</FieldError>
                        )}
                      </Field>
                    );
                  })}
                </Fieldset>
              )}

              <div className="flex flex-col gap-2">
                {selectedFields.length === 0 ? (
                  <div>
                    <p className="text-xs font-medium text-foreground">Choose a filter field</p>
                    <p className="mt-0.5 text-[.6875rem] text-muted-foreground">
                      Fields appear here only after you add them.
                    </p>
                  </div>
                ) : availableFields.length === 0 ? (
                  <p className="text-[.6875rem] text-muted-foreground">All fields are selected.</p>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="self-start"
                    aria-expanded={choosingField}
                    onClick={() => setChoosingField((previous) => !previous)}
                  >
                    <Plus aria-hidden />
                    Add filter
                  </Button>
                )}

                {selectedFields.length === 0 || choosingField ? (
                  <div
                    role="group"
                    className="flex flex-col gap-0.5 rounded-lg border border-border/70 bg-muted/20 p-1"
                    aria-label="Available document filter fields"
                  >
                    {availableFields.map((definition) => (
                      <button
                        key={definition.field}
                        type="button"
                        className="group flex min-h-10 w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => addDraftField(definition.field)}
                      >
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground group-hover:text-foreground">
                          <definition.Icon aria-hidden className="size-3.5" />
                        </span>
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="text-xs font-medium text-foreground">
                            {definition.label}
                          </span>
                          <span className="truncate text-[.625rem] text-muted-foreground">
                            {definition.operator} {definition.placeholder}
                          </span>
                        </span>
                        <Plus aria-hidden className="size-3.5 shrink-0 text-muted-foreground/70" />
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="flex items-center justify-between gap-2 border-t border-border/60 pt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost-muted"
                  disabled={selectedFields.length === 0}
                  onClick={removeAllDraftFields}
                >
                  Remove all
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost-muted"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={!draftChanged}>
                    Apply filters
                  </Button>
                </div>
              </div>
            </form>
          </PopoverPopup>
        </Popover>
      </div>

      {activeFields.length === 0 ? null : (
        <div
          role="group"
          className="flex min-w-0 flex-wrap items-center gap-1.5"
          aria-label="Active document filters"
        >
          {activeFields.map((field) => {
            const definition = FILTER_FIELD_DEFINITIONS[field];
            const value = appliedFilterValue(filters, field);
            return (
              <div
                key={field}
                className="flex h-6 min-w-0 max-w-full items-stretch overflow-hidden rounded-md border border-input bg-background shadow-xs/5"
              >
                <button
                  type="button"
                  className="flex min-w-0 items-center gap-1.5 px-2 text-[.6875rem] outline-none transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`Edit ${definition.label} filter, ${definition.operator} ${value}`}
                  onClick={() => editAppliedFilter(field)}
                >
                  <definition.Icon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                  <span className="shrink-0 font-medium text-foreground">
                    {definition.shortLabel}
                  </span>
                  <span className="shrink-0 text-muted-foreground">{definition.operator}</span>
                  <span className="min-w-0 max-w-48 truncate font-mono text-foreground">
                    {value}
                  </span>
                </button>
                <button
                  type="button"
                  className="flex w-6 shrink-0 items-center justify-center border-l border-input text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  aria-label={`Remove ${definition.label} filter`}
                  onClick={() => onFiltersChange(clearDocumentFilterField(filters, field))}
                >
                  <X aria-hidden className="size-3" />
                </button>
              </div>
            );
          })}
          <Button size="xs" variant="ghost-muted" onClick={clearAppliedFilters}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}
