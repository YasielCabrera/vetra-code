import {
  POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT,
  POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH,
} from "@t3tools/contracts";
import {
  Check,
  ChevronDown,
  FileClock,
  FileCog,
  GitBranch,
  Globe2,
  HardDrive,
  Layers3,
  Search,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxStatus,
  ComboboxTrigger,
} from "~/components/ui/combobox";
import { cn } from "~/lib/utils";

import { parseDocumentFilterValues } from "./documentFilters";
import {
  customDocumentViewValue,
  filterDocumentViewOptions,
  POWERHOUSE_BRANCH_OPTIONS,
  POWERHOUSE_SCOPE_OPTIONS,
  type PowerhouseDocumentViewOption,
} from "./documentViewOptions";

interface DocumentViewPickerProps {
  id: string;
  value: string;
  invalid: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}

const PICKER_POPUP_CLASS =
  "w-[min(24rem,calc(100vw-1rem))] min-w-0 overflow-hidden [&>[data-slot=combobox-popup]]:min-w-0";

function optionIcon(option: PowerhouseDocumentViewOption): LucideIcon {
  switch (option.value) {
    case "global":
      return Globe2;
    case "local":
      return HardDrive;
    case "document":
      return FileClock;
    case "auth":
      return ShieldCheck;
    case "header":
      return FileCog;
    default:
      return option.group === "default" ? GitBranch : Layers3;
  }
}

function DocumentViewItem({
  option,
  selected,
  disabled = false,
}: {
  option: PowerhouseDocumentViewOption;
  selected: boolean;
  disabled?: boolean;
}) {
  const Icon = optionIcon(option);
  return (
    <ComboboxItem value={option.value} disabled={disabled}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
          <Icon aria-hidden className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium text-foreground">{option.label}</span>
          <span className="truncate font-mono text-[.625rem] text-muted-foreground">
            {option.value}
          </span>
        </span>
        <Check
          aria-hidden
          className={cn("size-3.5 shrink-0 text-primary", selected ? "opacity-100" : "opacity-0")}
        />
      </div>
    </ComboboxItem>
  );
}

function PickerSearch({
  value,
  placeholder,
  label,
  onChange,
}: {
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="shrink-0 px-3 pt-2.5">
      <div className="relative -translate-y-px border-b border-border/70 pb-1.5 transition-colors focus-within:border-ring">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1.5 left-0 size-4 text-muted-foreground/55"
        />
        <ComboboxInput
          className="[&_input]:h-6.5 [&_input]:ps-5 [&_input]:font-sans [&_input]:leading-6.5"
          inputClassName="rounded-none bg-transparent text-sm"
          placeholder={placeholder}
          aria-label={label}
          showTrigger={false}
          size="sm"
          unstyled
          value={value}
          maxLength={POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH}
          spellCheck={false}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

export function BranchPicker({ id, value, invalid, autoFocus, onChange }: DocumentViewPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedOption = POWERHOUSE_BRANCH_OPTIONS.find((option) => option.value === value) ?? null;
  const visibleOptions = useMemo(
    () => filterDocumentViewOptions(POWERHOUSE_BRANCH_OPTIONS, query),
    [query],
  );
  const selectedCustomValue =
    value.length > 0 && selectedOption === null && query.trim().length === 0 ? value : null;
  const candidateValue =
    visibleOptions.length === 0
      ? customDocumentViewValue(
          POWERHOUSE_BRANCH_OPTIONS.map((option) => option.value),
          query,
        )
      : null;
  const customValue = candidateValue ?? selectedCustomValue;
  const itemValues = [
    ...visibleOptions.map((option) => option.value),
    ...(customValue === null ? [] : [customValue]),
  ];

  const setPickerOpen = (next: boolean) => {
    setOpen(next);
    setQuery("");
  };

  return (
    <Combobox
      items={itemValues}
      filteredItems={itemValues}
      autoHighlight
      open={open}
      value={value.length === 0 ? null : value}
      onOpenChange={setPickerOpen}
      onValueChange={(next) => {
        if (typeof next !== "string" || next.length === 0) return;
        onChange(next);
        setPickerOpen(false);
      }}
    >
      <ComboboxTrigger
        id={id}
        autoFocus={autoFocus}
        aria-invalid={invalid}
        className={cn(
          "relative flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border border-input bg-background px-2.5 py-1.5 text-left text-sm text-foreground shadow-xs/5 outline-none ring-ring/24 transition-shadow before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/24 dark:bg-input/32",
          invalid &&
            "border-destructive/36 focus-visible:border-destructive/64 focus-visible:ring-destructive/16 dark:ring-destructive/24",
        )}
      >
        <GitBranch aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {value.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">Choose branch…</span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium">
              {selectedOption?.label ?? "Custom branch"}
            </span>
            <span className="truncate font-mono text-[.625rem] text-muted-foreground">{value}</span>
          </span>
        )}
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>

      <ComboboxPopup align="start" className={PICKER_POPUP_CLASS}>
        <PickerSearch
          value={query}
          placeholder="Search or enter a branch…"
          label="Search branches"
          onChange={setQuery}
        />
        <ComboboxList className="max-h-72 min-w-0 overflow-x-hidden">
          {visibleOptions.length === 0 ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>Powerhouse default</ComboboxGroupLabel>
              {visibleOptions.map((option) => (
                <DocumentViewItem
                  key={option.value}
                  option={option}
                  selected={option.value === value}
                />
              ))}
            </ComboboxGroup>
          )}

          {customValue === null ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>
                {customValue === selectedCustomValue ? "Current value" : "Custom branch"}
              </ComboboxGroupLabel>
              <DocumentViewItem
                option={{
                  value: customValue,
                  label: customValue === selectedCustomValue ? "Custom branch" : "Use this branch",
                  group: "default",
                }}
                selected={customValue === value}
              />
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

const matchesQuery = (value: string, query: string) =>
  value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());

export function ScopePicker({ id, value, invalid, autoFocus, onChange }: DocumentViewPickerProps) {
  const [query, setQuery] = useState("");
  const selectedValues = useMemo(() => parseDocumentFilterValues(value), [value]);
  const selectedSet = useMemo(() => new Set(selectedValues), [selectedValues]);
  const knownValues: ReadonlyArray<string> = useMemo(
    () => POWERHOUSE_SCOPE_OPTIONS.map((option) => option.value),
    [],
  );
  const knownValueSet = useMemo(() => new Set<string>(knownValues), [knownValues]);
  const visibleOptions = useMemo(
    () => filterDocumentViewOptions(POWERHOUSE_SCOPE_OPTIONS, query),
    [query],
  );
  const visibleModelOptions = visibleOptions.filter((option) => option.group === "model");
  const visibleSystemOptions = visibleOptions.filter((option) => option.group === "system");
  const visibleCustomValues = selectedValues.filter(
    (scope) => !knownValueSet.has(scope) && matchesQuery(scope, query),
  );
  const customValue =
    visibleOptions.length === 0 && visibleCustomValues.length === 0
      ? customDocumentViewValue([...knownValues, ...selectedValues], query)
      : null;
  const itemValues = [
    ...visibleOptions.map((option) => option.value),
    ...visibleCustomValues,
    ...(customValue === null ? [] : [customValue]),
  ];
  const atLimit = selectedValues.length >= POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT;

  return (
    <Combobox
      multiple
      items={itemValues}
      filteredItems={itemValues}
      autoHighlight
      value={[...selectedValues]}
      onValueChange={(next) => {
        if (next.length > POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT) return;
        onChange(next.join(", "));
        setQuery("");
      }}
    >
      <ComboboxChips aria-invalid={invalid} startAddon={<Layers3 aria-hidden />}>
        {selectedValues.map((scope) => (
          <ComboboxChip key={scope}>{scope}</ComboboxChip>
        ))}
        <ComboboxChipsInput
          id={id}
          autoFocus={autoFocus}
          aria-invalid={invalid}
          aria-label="Search scopes"
          size="sm"
          value={query}
          maxLength={POWERHOUSE_REACTOR_OPERATION_TEXT_MAX_LENGTH}
          placeholder={selectedValues.length === 0 ? "Choose scopes…" : "Add scope…"}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />
        <ComboboxTrigger
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Open scope options"
        >
          <ChevronDown aria-hidden className="size-3.5" />
        </ComboboxTrigger>
      </ComboboxChips>

      <ComboboxPopup align="start" className={PICKER_POPUP_CLASS}>
        {atLimit ? (
          <ComboboxStatus>
            Maximum of {POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT} scopes selected.
          </ComboboxStatus>
        ) : null}
        <ComboboxList className="max-h-72 min-w-0 overflow-x-hidden">
          {visibleModelOptions.length === 0 ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>Document scopes</ComboboxGroupLabel>
              {visibleModelOptions.map((option) => (
                <DocumentViewItem
                  key={option.value}
                  option={option}
                  selected={selectedSet.has(option.value)}
                  disabled={atLimit && !selectedSet.has(option.value)}
                />
              ))}
            </ComboboxGroup>
          )}

          {visibleSystemOptions.length === 0 ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>System scopes</ComboboxGroupLabel>
              {visibleSystemOptions.map((option) => (
                <DocumentViewItem
                  key={option.value}
                  option={option}
                  selected={selectedSet.has(option.value)}
                  disabled={atLimit && !selectedSet.has(option.value)}
                />
              ))}
            </ComboboxGroup>
          )}

          {visibleCustomValues.length === 0 ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>Custom scopes</ComboboxGroupLabel>
              {visibleCustomValues.map((scope) => (
                <DocumentViewItem
                  key={scope}
                  option={{ value: scope, label: "Custom scope", group: "system" }}
                  selected
                />
              ))}
            </ComboboxGroup>
          )}

          {customValue === null ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>Custom scope</ComboboxGroupLabel>
              <DocumentViewItem
                option={{ value: customValue, label: "Use this scope", group: "system" }}
                selected={false}
                disabled={atLimit}
              />
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
