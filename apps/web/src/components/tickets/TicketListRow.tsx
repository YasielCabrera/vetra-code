import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentTicket } from "@t3tools/client-runtime/state/tickets";
import type { TicketStatusDefinition } from "@t3tools/contracts";
import { gitHubLoginAvatarUrl } from "@t3tools/shared/githubActor";
import { TicketIcon } from "lucide-react";
import { memo } from "react";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { ProjectFavicon } from "../ProjectFavicon";
import { GitHubIcon } from "../Icons";
import { SourceControlActorAvatar } from "../SourceControlActorAvatar";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { isHiddenTicket } from "./ticketBoard.logic";
import { TicketLinkCounts, TicketStatusIcon, ticketProjects } from "./ticketPresentation";
import { formatTicketRef } from "./ticketRefs";

export const TICKET_LIST_ROW_HEIGHT = 64;

export function TicketStatusMark(props: {
  readonly status: Pick<TicketStatusDefinition, "name" | "color" | "category"> | undefined;
}) {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center">
      <span className="sr-only">{props.status?.name ?? "No status"}</span>
      <TicketStatusIcon
        color={props.status?.color ?? "gray"}
        category={props.status?.category ?? "open"}
      />
    </span>
  );
}

export function TicketSource(props: { readonly ticket: EnvironmentTicket }) {
  const source =
    props.ticket.kind === "github"
      ? `${props.ticket.github.repository}#${props.ticket.github.number}`
      : "Local ticket";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" />
        }
      >
        {props.ticket.kind === "github" ? (
          <GitHubIcon aria-hidden className="size-3 shrink-0" />
        ) : (
          <TicketIcon aria-hidden className="size-3 shrink-0" />
        )}
        <span className="truncate">{source}</span>
      </TooltipTrigger>
      <TooltipPopup>{source}</TooltipPopup>
    </Tooltip>
  );
}

const VISIBLE_ASSIGNEES = 3;

/** Overlapping faces of the people GitHub has the issue assigned to; local tickets have none. */
export function TicketAssignees(props: { readonly ticket: EnvironmentTicket }) {
  if (props.ticket.kind !== "github") return null;
  const { host, assignees } = props.ticket.github;
  if (assignees.length === 0) return null;
  const extra = assignees.length - VISIBLE_ASSIGNEES;
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex shrink-0 items-center" />}>
        <span className="sr-only">Assigned to {assignees.join(", ")}</span>
        <span className="flex items-center -space-x-1">
          {assignees.slice(0, VISIBLE_ASSIGNEES).map((login) => (
            <SourceControlActorAvatar
              key={login}
              actor={{ login, avatarUrl: gitHubLoginAvatarUrl(login, host) }}
              className="ring-1 ring-card"
            />
          ))}
        </span>
        {extra > 0 ? (
          <span aria-hidden className="ml-1 text-xs text-muted-foreground tabular-nums">
            +{extra}
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup>Assigned to {assignees.join(", ")}</TooltipPopup>
    </Tooltip>
  );
}

export function TicketTags(props: {
  readonly ticket: EnvironmentTicket;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
}) {
  const projects = ticketProjects(props.ticket, props.projectByKey);
  const extraProjects = Math.max(0, projects.length - 2);
  const extraLabels = Math.max(0, props.ticket.labels.length - 2);
  if (projects.length === 0 && props.ticket.labels.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex min-w-0 items-center gap-1.5 overflow-hidden" />}
      >
        {projects.slice(0, 2).map((project) => (
          <span
            key={project.id}
            className="inline-flex h-5 min-w-0 shrink items-center gap-1 rounded border border-primary/20 bg-primary/8 px-1.5 text-xs text-foreground"
          >
            <ProjectFavicon project={project} className="size-3" />
            <span className="max-w-40 truncate">{project.title}</span>
          </span>
        ))}
        {extraProjects > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            +{extraProjects}
            <span className="sr-only"> more projects</span>
          </span>
        ) : null}
        {props.ticket.labels.slice(0, 2).map((label) => (
          <span key={label} className="min-w-0 shrink overflow-hidden">
            <Badge variant="outline">
              <span className="max-w-32 truncate">{label}</span>
            </Badge>
          </span>
        ))}
        {extraLabels > 0 ? (
          <span className="shrink-0 text-xs text-muted-foreground">
            +{extraLabels}
            <span className="sr-only"> more labels</span>
          </span>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup>
        {projects.length > 0 ? (
          <div>Projects: {projects.map((project) => project.title).join(", ")}</div>
        ) : null}
        {props.ticket.labels.length > 0 ? (
          <div>Labels: {props.ticket.labels.join(", ")}</div>
        ) : null}
      </TooltipPopup>
    </Tooltip>
  );
}

export function TicketUpdatedAt(props: { readonly ticket: EnvironmentTicket }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <time
            dateTime={props.ticket.updatedAt}
            className="shrink-0 text-xs text-muted-foreground tabular-nums"
          />
        }
      >
        <span className="sr-only">Updated </span>
        {formatRelativeTimeLabel(props.ticket.updatedAt)}
      </TooltipTrigger>
      <TooltipPopup>Updated {new Date(props.ticket.updatedAt).toLocaleString()}</TooltipPopup>
    </Tooltip>
  );
}

export const TicketRow = memo(function TicketRow(props: {
  readonly ticket: EnvironmentTicket;
  readonly status: Pick<TicketStatusDefinition, "name" | "color" | "category"> | undefined;
  readonly rowIndex: number;
  readonly projectByKey: ReadonlyMap<string, EnvironmentProject>;
  readonly onOpen: (ticket: EnvironmentTicket) => void;
  readonly onTrackAgain: (ticket: EnvironmentTicket) => void;
}) {
  const { ticket } = props;
  const row = (
    <button
      type="button"
      data-board-row={props.rowIndex}
      onClick={() => props.onOpen(ticket)}
      className="flex h-16 w-full min-w-0 items-center gap-3 rounded-lg border-b border-border/40 px-3 text-left text-sm outline-none hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:ring-1 focus-visible:ring-ring"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex h-5 min-w-0 items-center gap-2">
          <TicketStatusMark status={props.status} />
          <span className="shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
            {formatTicketRef(ticket)}
          </span>
          <span className="min-w-0 truncate font-medium text-foreground">{ticket.title}</span>
        </span>
        <span className="flex h-5 min-w-0 items-center gap-2 pl-5.5">
          <span className="min-w-0 max-w-[40%] shrink-0">
            <TicketSource ticket={ticket} />
          </span>
          <TicketTags ticket={ticket} projectByKey={props.projectByKey} />
        </span>
      </div>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <TicketUpdatedAt ticket={ticket} />
        <span className="flex h-5 items-center gap-2">
          <TicketLinkCounts ticket={ticket} />
          <TicketAssignees ticket={ticket} />
        </span>
      </span>
    </button>
  );
  if (!isHiddenTicket(ticket)) return row;
  return (
    <div className="flex h-16 min-w-0 items-center gap-2">
      <div className="min-w-0 flex-1">{row}</div>
      <Button size="xs" variant="outline" onClick={() => props.onTrackAgain(ticket)}>
        Track again
      </Button>
    </div>
  );
});
