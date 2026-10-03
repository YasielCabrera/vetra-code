import { POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH } from "@t3tools/contracts";
import { Braces, ChevronDown, FileType2, Folder, HardDrive } from "lucide-react";
import { useMemo, useState } from "react";

import {
  Combobox,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxStatus,
  ComboboxTrigger,
} from "~/components/ui/combobox";

import {
  customDocumentTypeValue,
  filterDocumentTypeOptions,
  type PowerhouseDocumentTypeCatalogStatus,
  type PowerhouseDocumentTypeOption,
} from "./documentTypeOptions";
import { PickerTriggerButton } from "./PickerTriggerButton";

interface DocumentTypePickerProps {
  id: string;
  value: string;
  options: ReadonlyArray<PowerhouseDocumentTypeOption>;
  catalogStatus: PowerhouseDocumentTypeCatalogStatus;
  invalid: boolean;
  autoFocus?: boolean;
  onChange: (value: string) => void;
}

function optionIcon(option: PowerhouseDocumentTypeOption) {
  if (option.value === "powerhouse/folder") return Folder;
  if (option.source === "system") return HardDrive;
  return Braces;
}

function DocumentTypeItem({ option }: { option: PowerhouseDocumentTypeOption }) {
  const Icon = optionIcon(option);
  return (
    <ComboboxItem value={option.value}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
          <Icon aria-hidden className="size-3.5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-xs font-medium text-foreground">{option.label}</span>
          <span className="truncate font-mono text-3xs text-muted-foreground">{option.value}</span>
        </span>
      </div>
    </ComboboxItem>
  );
}

export function DocumentTypePicker({
  id,
  value,
  options,
  catalogStatus,
  invalid,
  autoFocus,
  onChange,
}: DocumentTypePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const visibleOptions = useMemo(() => filterDocumentTypeOptions(options, query), [options, query]);
  const systemOptions = visibleOptions.filter((option) => option.source === "system");
  const modelOptions = visibleOptions.filter((option) => option.source === "model");
  const selectedCustomValue =
    value.length > 0 && selectedOption === null && query.trim().length === 0 ? value : null;
  const customValue =
    (visibleOptions.length === 0 ? customDocumentTypeValue(options, query) : null) ??
    selectedCustomValue;
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
        render={<PickerTriggerButton />}
      >
        <FileType2 aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        {value.length === 0 ? (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Choose document type…
          </span>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium">
              {selectedOption?.label ?? "Custom document type"}
            </span>
            <span className="truncate font-mono text-3xs text-muted-foreground">{value}</span>
          </span>
        )}
        <ChevronDown aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </ComboboxTrigger>

      <ComboboxPopup
        align="start"
        className="w-[min(24rem,calc(100vw-1rem))] min-w-0 overflow-hidden [&>[data-slot=combobox-popup]]:min-w-0"
      >
        <ComboboxSearchInput
          placeholder="Search names or type IDs…"
          aria-label="Search document types"
          value={query}
          maxLength={POWERHOUSE_REACTOR_DOCUMENT_TYPE_MAX_LENGTH}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
        />

        {catalogStatus === "loading" ? (
          <ComboboxStatus>Loading project document types…</ComboboxStatus>
        ) : catalogStatus === "partial" ? (
          <ComboboxStatus>
            Some project document types could not be listed. You can still use a custom type ID.
          </ComboboxStatus>
        ) : catalogStatus === "error" ? (
          <ComboboxStatus>
            Project document types could not be loaded. Built-in types are still available.
          </ComboboxStatus>
        ) : null}

        <ComboboxList className="max-h-72 min-w-0 overflow-x-hidden">
          {systemOptions.length === 0 ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>Built-in types</ComboboxGroupLabel>
              {systemOptions.map((option) => (
                <DocumentTypeItem key={option.value} option={option} />
              ))}
            </ComboboxGroup>
          )}

          {modelOptions.length === 0 ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>Project models</ComboboxGroupLabel>
              {modelOptions.map((option) => (
                <DocumentTypeItem key={option.value} option={option} />
              ))}
            </ComboboxGroup>
          )}

          {customValue === null ? null : (
            <ComboboxGroup>
              <ComboboxGroupLabel>
                {customValue === selectedCustomValue ? "Current value" : "Custom type"}
              </ComboboxGroupLabel>
              <ComboboxItem value={customValue}>
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background text-muted-foreground">
                    <FileType2 aria-hidden className="size-3.5" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-xs font-medium text-foreground">
                      {customValue === selectedCustomValue
                        ? "Custom document type"
                        : "Use this type"}
                    </span>
                    <span className="truncate font-mono text-3xs text-muted-foreground">
                      {customValue}
                    </span>
                  </span>
                </div>
              </ComboboxItem>
            </ComboboxGroup>
          )}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}
