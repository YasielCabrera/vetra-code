import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import { type TicketStatusCategory, TicketStatusColor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { CheckIcon, LayersIcon, ListFilterIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";

import { cn } from "../../lib/utils";
import { PROJECT_ICON_COLORS, projectIconColorClassName } from "../../projectIconColors";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Group } from "../ui/group";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { SelectButton } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const isTicketStatusColor = Schema.is(TicketStatusColor);

export const TICKET_STATUS_COLOR_OPTIONS = PROJECT_ICON_COLORS.flatMap((option) =>
  isTicketStatusColor(option.value) ? [{ ...option, value: option.value }] : [],
);

export function TicketStatusIcon(props: {
  readonly color: TicketStatusColor;
  readonly category: TicketStatusCategory;
  readonly className?: string;
}) {
  const colorClassName = projectIconColorClassName(props.color);
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center",
        colorClassName,
        props.className,
      )}
    >
      {props.category === "closed" ? (
        <CheckIcon className={cn("size-3.5", colorClassName)} />
      ) : (
        <span
          className={cn(
            "size-2.5 rounded-full border-2 border-current",
            props.category === "active" && "bg-current",
          )}
        />
      )}
    </span>
  );
}

export function TicketPropertyRow(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-baseline gap-2 text-sm">
      <span className="text-xs text-muted-foreground">{props.label}</span>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

export interface TicketFilterOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly icon?: ReactNode;
}

/** One way to narrow the board: a submenu in the filter menu, and a chip while it is set. */
interface TicketFilterFieldBase {
  readonly key: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** The choice that clears the filter. Defaults to "Any <label>". */
  readonly anyLabel?: string;
  /** Every known choice, so a set filter can name its value even when the menu leaves it out. */
  readonly options: ReadonlyArray<TicketFilterOption>;
  /** Whether the menu offers this field while it is unset. Defaults to having options. */
  readonly offered?: boolean;
}

export type TicketFilterField = TicketFilterFieldBase &
  (
    | {
        readonly selection?: "single";
        readonly value: string | undefined;
        readonly onChange: (value: string | undefined) => void;
      }
    | {
        readonly selection: "multiple";
        readonly value: ReadonlyArray<string>;
        readonly searchable: boolean;
        readonly onToggle: (value: string, selected: boolean) => void;
        readonly onClear: () => void;
      }
  );

export interface TicketFilterSection {
  readonly label?: string;
  readonly fields: ReadonlyArray<TicketFilterField>;
}

function TicketFilterOptionRow(props: { readonly icon: ReactNode; readonly label: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex size-4 shrink-0 items-center justify-center">{props.icon}</span>
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
      <span className="inline-flex size-4 shrink-0 items-center justify-center">
        <MenuRadioItemIndicator />
      </span>
    </span>
  );
}

function TicketFilterOptions(props: { readonly field: TicketFilterField }) {
  const { field } = props;
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  if (field.selection === "multiple") {
    const needle = field.searchable ? query.trim().toLowerCase() : "";
    const options = field.options.filter((option) => option.label.toLowerCase().includes(needle));
    return (
      <div className="w-64 max-w-[calc(100vw-2.5rem)]">
        {field.searchable ? (
          <div className="flex items-center gap-1 p-1">
            <Input
              autoFocus
              size="compact"
              type="search"
              aria-label={`Search ${field.label.toLowerCase()}s`}
              placeholder={`Search ${field.label.toLowerCase()}s…`}
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  event.stopPropagation();
                  const items = listRef.current?.querySelectorAll<HTMLElement>(
                    '[role="menuitemcheckbox"]',
                  );
                  items?.[event.key === "ArrowDown" ? 0 : items.length - 1]?.focus();
                } else if (event.key !== "Escape" && event.key !== "Tab") {
                  event.stopPropagation();
                }
              }}
            />
            {query.length > 0 ? (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Clear ${field.label.toLowerCase()} search`}
                onClick={() => setQuery("")}
              >
                <XIcon aria-hidden />
              </Button>
            ) : null}
          </div>
        ) : null}
        <div ref={listRef} className="max-h-80 overflow-y-auto">
          <MenuCheckboxItem
            checked={field.value.length === 0}
            closeOnClick={false}
            onClick={field.onClear}
          >
            <span className="flex min-w-0 items-center gap-2">
              <LayersIcon aria-hidden className="size-3.5 shrink-0" />
              <span className="truncate">
                {field.anyLabel ?? `Any ${field.label.toLowerCase()}`}
              </span>
            </span>
          </MenuCheckboxItem>
          {field.options.length > 0 ? <MenuSeparator /> : null}
          {options.map((option) => (
            <MenuCheckboxItem
              key={option.value}
              checked={field.value.includes(option.value)}
              closeOnClick={false}
              onCheckedChange={(selected) => field.onToggle(option.value, selected)}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="inline-flex size-4 shrink-0 items-center justify-center">
                  {option.icon}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{option.label}</span>
                  {option.description === undefined ? null : (
                    <span className="truncate text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
              </span>
            </MenuCheckboxItem>
          ))}
          {options.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">No projects match your search.</p>
          ) : null}
        </div>
      </div>
    );
  }
  return (
    <div className="max-h-80 w-64 max-w-[calc(100vw-2.5rem)] overflow-y-auto">
      <MenuRadioGroup
        value={field.value ?? ""}
        onValueChange={(value: string) => field.onChange(value === "" ? undefined : value)}
      >
        <MenuRadioItem value="">
          <TicketFilterOptionRow
            icon={<LayersIcon aria-hidden className="size-3.5" />}
            label={field.anyLabel ?? `Any ${field.label.toLowerCase()}`}
          />
        </MenuRadioItem>
        {field.options.length > 0 ? <MenuSeparator /> : null}
        {field.options.map((option) => (
          <MenuRadioItem key={option.value} value={option.value}>
            <TicketFilterOptionRow icon={option.icon} label={option.label} />
          </MenuRadioItem>
        ))}
      </MenuRadioGroup>
    </div>
  );
}

export function isTicketFilterActive(field: TicketFilterField): boolean {
  return field.selection === "multiple" ? field.value.length > 0 : field.value !== undefined;
}

/** A selected value the options no longer list (a label nobody uses now) still shows as itself. */
function selectedFilterSummary(field: TicketFilterField) {
  const values =
    field.selection === "multiple" ? field.value : field.value === undefined ? [] : [field.value];
  const selected = values.map((value) => {
    const option = field.options.find((candidate) => candidate.value === value);
    return {
      label:
        option?.description === undefined
          ? (option?.label ?? value)
          : `${option.label} (${option.description})`,
      icon: option?.icon,
    };
  });
  const first = selected[0];
  if (first === undefined) return undefined;
  return {
    label: selected.length === 1 ? first.label : `${selected.length} projects`,
    accessibleLabel: selected.map((option) => option.label).join(", "),
    icon: selected.length === 1 ? first.icon : field.icon,
  };
}

/** The toolbar's filter menu: one submenu per field, grouped into sections. */
export function TicketFilterButton(props: {
  readonly sections: ReadonlyArray<TicketFilterSection>;
}) {
  const activeCount = props.sections
    .flatMap((section) => section.fields)
    .filter(isTicketFilterActive).length;
  const sections = props.sections
    .map((section) => ({
      ...section,
      fields: section.fields.filter(
        (field) => isTicketFilterActive(field) || (field.offered ?? field.options.length > 0),
      ),
    }))
    .filter((section) => section.fields.length > 0);
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={
                    activeCount === 0 ? "Filter tickets" : `Filter tickets, ${activeCount} active`
                  }
                />
              }
            />
          }
        >
          <ListFilterIcon aria-hidden />
          {activeCount === 0 ? null : (
            <Badge aria-hidden size="sm" className="absolute -top-1 -right-1">
              {activeCount}
            </Badge>
          )}
        </TooltipTrigger>
        <TooltipPopup side="bottom">Filter</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        {sections.map((section, index) => (
          <MenuGroup key={section.label ?? index}>
            {index > 0 ? <MenuSeparator /> : null}
            {section.label === undefined ? null : <MenuGroupLabel>{section.label}</MenuGroupLabel>}
            {section.fields.map((field) => {
              const selected = selectedFilterSummary(field);
              return (
                <MenuSub key={field.key}>
                  <MenuSubTrigger
                    aria-label={
                      selected === undefined
                        ? undefined
                        : `${field.label}: ${selected.accessibleLabel}`
                    }
                  >
                    <span className="inline-flex size-4 shrink-0 items-center justify-center">
                      {field.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{field.label}</span>
                    {selected === undefined ? null : (
                      <span className="max-w-32 truncate text-xs text-muted-foreground">
                        {selected.label}
                      </span>
                    )}
                  </MenuSubTrigger>
                  <MenuSubPopup>
                    <TicketFilterOptions field={field} />
                  </MenuSubPopup>
                </MenuSub>
              );
            })}
          </MenuGroup>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** A set filter under the toolbar: opens the same choices, and the cross clears it. */
export function TicketFilterChip(props: { readonly field: TicketFilterField }) {
  const { field } = props;
  const selected = selectedFilterSummary(field);
  if (selected === undefined) return null;
  return (
    <Group>
      <Menu>
        <MenuTrigger
          render={<SelectButton size="xs" />}
          className="w-auto min-w-0"
          aria-label={`${field.label}: ${selected.accessibleLabel}. Change filter`}
        >
          <span className="flex min-w-0 max-w-64 items-center gap-1.5">
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              {selected.icon ?? field.icon}
            </span>
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">{field.label}:</span> {selected.label}
            </span>
          </span>
        </MenuTrigger>
        <MenuPopup align="start">
          <TicketFilterOptions field={field} />
        </MenuPopup>
      </Menu>
      <Button
        size="icon-xs"
        variant="outline"
        aria-label={`Remove ${field.label.toLowerCase()} filter`}
        onClick={() =>
          field.selection === "multiple" ? field.onClear() : field.onChange(undefined)
        }
      >
        <XIcon aria-hidden />
      </Button>
    </Group>
  );
}

/** The projects a ticket links to, from a map keyed `environmentId:projectId`. */
export function ticketProjects(
  ticket: EnvironmentTicket,
  projectByKey: ReadonlyMap<string, EnvironmentProject>,
): ReadonlyArray<EnvironmentProject> {
  return ticket.linkRefs.flatMap((ref) => {
    if (ref.kind !== "project") return [];
    const project = projectByKey.get(`${ticket.environmentId}:${ref.targetKey}`);
    return project === undefined ? [] : [project];
  });
}

export function TicketLinkCounts(props: { readonly ticket: EnvironmentTicket }) {
  const threadCount = props.ticket.linkRefs.filter((ref) => ref.kind === "thread").length;
  const pullRequestCount = props.ticket.linkRefs.filter(
    (ref) => ref.kind === "pull_request",
  ).length;
  return (
    <>
      {threadCount > 0 ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <MessageSquareIcon aria-hidden className="size-3.5" />
          {threadCount}
          <span className="sr-only">linked thread{threadCount === 1 ? "" : "s"}</span>
        </span>
      ) : null}
      {pullRequestCount > 0 ? (
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums">
          <PullRequestGlyph.pullRequest aria-hidden className="size-3.5" />
          {pullRequestCount}
          <span className="sr-only">linked pull request{pullRequestCount === 1 ? "" : "s"}</span>
        </span>
      ) : null}
    </>
  );
}
