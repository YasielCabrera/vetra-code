import {
  POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH,
  POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT,
  POWERHOUSE_REACTOR_ID_MAX_LENGTH,
  POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH,
} from "@vetra-code/contracts";
import { ListFilter, Search, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

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
  documentFilterBadges,
  documentFilterCount,
  documentFilterDraft,
  EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS,
  EMPTY_POWERHOUSE_DOCUMENT_FILTERS,
  hasExplicitDocumentSearch,
  parseDocumentFilterDraft,
  type PowerhouseDocumentFilterDraft,
  type PowerhouseDocumentFilterErrors,
  type PowerhouseDocumentFilters,
} from "./documentFilters";

interface DocumentFilterBarProps {
  query: string;
  filters: PowerhouseDocumentFilters;
  currentParentId: string | null;
  onQueryChange: (query: string) => void;
  onFiltersChange: (filters: PowerhouseDocumentFilters) => void;
}

const listInputMaxLength = (valueMaxLength: number) =>
  (valueMaxLength + 2) * POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT;
const LOCAL_SEARCH_MAX_LENGTH = 4096;

export function DocumentFilterBar({
  query,
  filters,
  currentParentId,
  onQueryChange,
  onFiltersChange,
}: DocumentFilterBarProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PowerhouseDocumentFilterDraft>(() =>
    documentFilterDraft(filters),
  );
  const [errors, setErrors] = useState<PowerhouseDocumentFilterErrors>(
    EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS,
  );
  const typeId = useId();
  const parentId = useId();
  const identifiersId = useId();
  const branchId = useId();
  const scopesId = useId();
  const activeCount = documentFilterCount(filters);
  const badges = documentFilterBadges(filters);
  const searchingDocuments = currentParentId !== null || hasExplicitDocumentSearch(filters);

  const updateDraft = (patch: Partial<PowerhouseDocumentFilterDraft>) =>
    setDraft((previous) => ({ ...previous, ...patch }));

  const setPopoverOpen = (next: boolean) => {
    if (next) {
      setDraft(documentFilterDraft(filters));
      setErrors(EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS);
    }
    setOpen(next);
  };

  const apply = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = parseDocumentFilterDraft(draft);
    setErrors(parsed.errors);
    if (parsed.errors.identifiers !== null || parsed.errors.scopes !== null) return;
    onFiltersChange(parsed.filters);
    setOpen(false);
  };

  const clearFilters = () => {
    setDraft(documentFilterDraft(EMPTY_POWERHOUSE_DOCUMENT_FILTERS));
    setErrors(EMPTY_POWERHOUSE_DOCUMENT_FILTER_ERRORS);
    onFiltersChange(EMPTY_POWERHOUSE_DOCUMENT_FILTERS);
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
            className="w-[min(25rem,calc(100vw-1rem))] max-w-none"
          >
            <PopoverTitle className="text-sm">Document filters</PopoverTitle>
            <PopoverDescription className="mt-1 mb-4 text-xs leading-relaxed">
              Exact fields sent to the Switchboard API. The search box filters the results it
              returns.
            </PopoverDescription>
            <form className="flex flex-col gap-4" onSubmit={apply}>
              <Fieldset className="max-w-none gap-3">
                <FieldsetLegend className="sr-only">Switchboard document filters</FieldsetLegend>
                <Field>
                  <FieldLabel htmlFor={typeId}>Document type</FieldLabel>
                  <Input
                    id={typeId}
                    size="sm"
                    value={draft.type}
                    maxLength={POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH}
                    placeholder="namespace/model"
                    spellCheck={false}
                    onChange={(event) => updateDraft({ type: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={parentId}>Parent identifier</FieldLabel>
                  <Input
                    id={parentId}
                    size="sm"
                    value={draft.parentId}
                    maxLength={POWERHOUSE_REACTOR_ID_MAX_LENGTH}
                    placeholder={currentParentId ?? "Any parent"}
                    spellCheck={false}
                    onChange={(event) => updateDraft({ parentId: event.target.value })}
                  />
                  <FieldDescription>
                    {currentParentId === null
                      ? "Leave blank to search across the reactor by type or identifier."
                      : "Leave blank to use the current drive or folder."}
                  </FieldDescription>
                </Field>
                <Field data-invalid={errors.identifiers !== null}>
                  <FieldLabel htmlFor={identifiersId}>Identifiers</FieldLabel>
                  <Textarea
                    id={identifiersId}
                    value={draft.identifiers}
                    maxLength={listInputMaxLength(POWERHOUSE_REACTOR_ID_MAX_LENGTH)}
                    aria-invalid={errors.identifiers !== null}
                    placeholder="Document IDs or slugs, comma-separated"
                    spellCheck={false}
                    onChange={(event) => updateDraft({ identifiers: event.target.value })}
                  />
                  {errors.identifiers === null ? (
                    <FieldDescription>
                      Exact matches; commas or new lines separate values.
                    </FieldDescription>
                  ) : (
                    <FieldError>{errors.identifiers}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel htmlFor={branchId}>Branch</FieldLabel>
                  <Input
                    id={branchId}
                    size="sm"
                    value={draft.branch}
                    maxLength={POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH}
                    placeholder="Default branch"
                    spellCheck={false}
                    onChange={(event) => updateDraft({ branch: event.target.value })}
                  />
                </Field>
                <Field data-invalid={errors.scopes !== null}>
                  <FieldLabel htmlFor={scopesId}>Scopes</FieldLabel>
                  <Input
                    id={scopesId}
                    size="sm"
                    value={draft.scopes}
                    maxLength={listInputMaxLength(POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH)}
                    aria-invalid={errors.scopes !== null}
                    placeholder="global, local"
                    spellCheck={false}
                    onChange={(event) => updateDraft({ scopes: event.target.value })}
                  />
                  {errors.scopes === null ? (
                    <FieldDescription>Commas or new lines separate scope names.</FieldDescription>
                  ) : (
                    <FieldError>{errors.scopes}</FieldError>
                  )}
                </Field>
              </Fieldset>
              <div className="flex items-center justify-between gap-2">
                <Button type="button" size="sm" variant="ghost-muted" onClick={clearFilters}>
                  Clear
                </Button>
                <Button type="submit" size="sm">
                  Apply filters
                </Button>
              </div>
            </form>
          </PopoverPopup>
        </Popover>
      </div>

      {badges.length === 0 ? null : (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5" aria-label="Active filters">
          {badges.map((badge) => (
            <Badge key={badge} size="sm" variant="outline" className="max-w-full">
              <span className="max-w-64 truncate">{badge}</span>
            </Badge>
          ))}
          <Button size="xs" variant="ghost-muted" onClick={clearFilters}>
            Clear filters
          </Button>
        </div>
      )}
    </div>
  );
}
