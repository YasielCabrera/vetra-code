import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import { type TicketStatusCategory, TicketStatusColor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { CheckIcon, LayersIcon, MessageSquareIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/utils";
import { PROJECT_ICON_COLORS, projectIconColorClassName } from "../../projectIconColors";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuRadioItemIndicator,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";

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
  readonly icon?: ReactNode;
}

export function TicketFilterMenu(props: {
  readonly label: string;
  readonly value: string | undefined;
  readonly options: ReadonlyArray<TicketFilterOption>;
  readonly onChange: (value: string | undefined) => void;
}) {
  const selected = props.options.find((option) => option.value === props.value);
  return (
    <Menu>
      <MenuTrigger
        render={<Button size="xs" variant={selected === undefined ? "ghost" : "outline"} />}
      >
        <span className="flex min-w-0 max-w-64 items-center gap-1.5">
          {selected?.icon ? (
            <span className="inline-flex size-4 shrink-0 items-center justify-center">
              {selected.icon}
            </span>
          ) : null}
          <span className="min-w-0 truncate">
            {selected === undefined ? props.label : `${props.label}: ${selected.label}`}
          </span>
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        <div className="max-h-80 w-64 max-w-[calc(100vw-2.5rem)] overflow-y-auto">
          <MenuGroup>
            <MenuRadioGroup
              value={props.value ?? ""}
              onValueChange={(value: string) => props.onChange(value === "" ? undefined : value)}
            >
              <MenuRadioItem value="">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex size-4 shrink-0 items-center justify-center">
                    <LayersIcon aria-hidden className="size-3.5" />
                  </span>
                  <span className="min-w-0 flex-1 truncate">Any {props.label.toLowerCase()}</span>
                  <span className="inline-flex size-4 shrink-0 items-center justify-center">
                    <MenuRadioItemIndicator />
                  </span>
                </span>
              </MenuRadioItem>
              {props.options.length > 0 ? <MenuSeparator /> : null}
              {props.options.map((option) => (
                <MenuRadioItem key={option.value} value={option.value}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="inline-flex size-4 shrink-0 items-center justify-center">
                      {option.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    <span className="inline-flex size-4 shrink-0 items-center justify-center">
                      <MenuRadioItemIndicator />
                    </span>
                  </span>
                </MenuRadioItem>
              ))}
            </MenuRadioGroup>
          </MenuGroup>
        </div>
      </MenuPopup>
    </Menu>
  );
}

/** Titles of the projects a ticket links to, from a map keyed `environmentId:projectId`. */
export function ticketProjectTitles(
  ticket: EnvironmentTicket,
  projectTitleByKey: ReadonlyMap<string, string>,
): ReadonlyArray<string> {
  return ticket.linkRefs.flatMap((ref) => {
    if (ref.kind !== "project") return [];
    const title = projectTitleByKey.get(`${ticket.environmentId}:${ref.targetKey}`);
    return title === undefined ? [] : [title];
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
