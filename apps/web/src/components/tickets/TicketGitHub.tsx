import type {
  EnvironmentId,
  GitHubIssueSnapshot,
  TicketIssueActor,
  TicketGitHubIssueRef,
} from "@t3tools/contracts";
import { CircleCheckIcon, CircleDotIcon, CircleHelpIcon } from "lucide-react";
import { msg, T, useGT } from "gt-react";

import { m } from "../../i18n/messages";
import { memo } from "react";

import { readLocalApi } from "../../localApi";
import { ticketEnvironment } from "../../state/tickets";
import { useEnvironmentQuery } from "../../state/query";
import { useTicketActions } from "../../hooks/useTicketActions";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { IssueAssigneePicker } from "../issue/IssueAssigneePicker";
import { IssueTimelineGhost } from "../issue/IssueGhosts";
import { IssueTimeline } from "../issue/IssueTimeline";
import { SourceControlActorAvatar } from "../SourceControlActorAvatar";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import type { GitHubTicket } from "./ticketGitHub.logic";
import { TicketPropertyRow } from "./ticketPresentation";

const { Icon: GitHubIcon } = getSourceControlPresentationForKind("github");

export function openOnGitHub(url: string) {
  void readLocalApi()
    ?.shell.openExternal(url)
    .catch(() => undefined);
}

export function useTicketIssueReads(
  environmentId: EnvironmentId,
  reference: TicketGitHubIssueRef | null,
) {
  const target = reference === null ? null : { environmentId, input: reference };
  const detail = useEnvironmentQuery(
    target === null ? null : ticketEnvironment.githubIssueDetail(target),
  );
  const activity = useEnvironmentQuery(
    target === null ? null : ticketEnvironment.githubIssueActivity(target),
  );
  const { refreshGitHubIssue: refreshTicket } = useTicketActions();
  const refreshDetail = detail.refresh;
  const refreshActivity = activity.refresh;
  const refresh = async () => {
    if (target === null) return;
    await refreshTicket({ environmentId: target.environmentId, ticketId: target.input.ticketId });
    refreshDetail();
    refreshActivity();
  };
  return {
    issue: detail.data,
    activity: activity.data,
    activityError: activity.error,
    refreshActivity,
    refresh,
  };
}

type TicketIssueReads = ReturnType<typeof useTicketIssueReads>;

function describeIssueState(github: GitHubIssueSnapshot): string {
  if (github.state === "open") return m(msg("Open"));
  switch (github.stateReason) {
    case "missing":
      return m(msg("Missing on GitHub"));
    case "not_planned":
      return m(msg("Closed as not planned"));
    case "duplicate":
      return m(msg("Closed as duplicate"));
    default:
      return m(msg("Closed"));
  }
}

function TicketGitHubStateBadge(props: { readonly github: GitHubIssueSnapshot }) {
  const open = props.github.state === "open";
  const missing = props.github.stateReason === "missing";
  return (
    <Badge variant={open ? "success" : "secondary"} size="control">
      {missing ? (
        <CircleHelpIcon aria-hidden />
      ) : open ? (
        <CircleDotIcon aria-hidden />
      ) : (
        <CircleCheckIcon aria-hidden />
      )}
      {describeIssueState(props.github)}
    </Badge>
  );
}

export function TicketGitHubProperties(props: {
  readonly ticket: GitHubTicket;
  readonly reference: TicketGitHubIssueRef | null;
  readonly reads: TicketIssueReads;
  /** The source's last sync; null when no source syncs the repository or it never ran. */
  readonly lastSyncedAt: string | null;
  readonly hasSource: boolean;
  readonly refreshing: boolean;
  readonly onRefresh: () => void;
}) {
  const gt = useGT();
  const { ticket } = props;
  const assignees: ReadonlyArray<TicketIssueActor> =
    props.reads.issue?.assignees ??
    ticket.github.assignees.map((login) => ({ login, name: null, avatarUrl: null }));
  return (
    <>
      <TicketPropertyRow label={gt("Repository")}>
        <span className="block truncate">{ticket.github.repository}</span>
      </TicketPropertyRow>
      <TicketPropertyRow label={gt("Issue")}>
        <button
          type="button"
          className="hover:underline"
          onClick={() => openOnGitHub(ticket.github.url)}
        >
          #{ticket.github.number}
        </button>
      </TicketPropertyRow>
      <TicketPropertyRow label={gt("State")}>
        <TicketGitHubStateBadge github={ticket.github} />
      </TicketPropertyRow>
      <TicketPropertyRow label={gt("Assignees")}>
        <div className="flex flex-wrap items-center gap-1.5">
          {assignees.length === 0 ? (
            <span className="text-xs text-muted-foreground">
              <T>None</T>
            </span>
          ) : (
            assignees.map((assignee) => (
              <span key={assignee.login} className="flex items-center gap-1 text-xs">
                <SourceControlActorAvatar actor={assignee} />
                {assignee.login}
              </span>
            ))
          )}
          {props.reference === null ? null : (
            <IssueAssigneePicker
              environmentId={ticket.environmentId}
              reference={props.reference}
              onAssigned={() => void props.reads.refresh()}
            />
          )}
        </div>
      </TicketPropertyRow>
      <TicketPropertyRow label={gt("Last sync")}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {props.hasSource
              ? props.lastSyncedAt === null
                ? gt("Never")
                : formatRelativeTimeLabel(props.lastSyncedAt)
              : gt("Not synced")}
          </span>
          <Button size="xs" variant="ghost" disabled={props.refreshing} onClick={props.onRefresh}>
            <RefreshIcon refreshing={props.refreshing} />
            <T>Refresh</T>
          </Button>
        </div>
      </TicketPropertyRow>
    </>
  );
}

export const TicketGitHubActivity = memo(function TicketGitHubActivity(props: {
  readonly environmentId: EnvironmentId;
  readonly reads: TicketIssueReads;
  readonly hasReference: boolean;
}) {
  const { activity, activityError, refreshActivity } = props.reads;
  return (
    <div className="flex flex-col gap-2 border-t border-border/60 pt-4">
      <h3 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <GitHubIcon aria-hidden className="size-3.5" />
        <T>On GitHub</T>
      </h3>
      {!props.hasReference ? (
        <p className="text-xs text-muted-foreground">
          <T>Link a project with this repository to see the issue's comments.</T>
        </p>
      ) : activity !== null ? (
        <IssueTimeline
          activity={activity}
          environmentId={props.environmentId}
          order="oldest"
          onOpen={openOnGitHub}
        />
      ) : activityError !== null ? (
        <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
          <p>
            <T>Could not load the issue's comments.</T> {activityError}
          </p>
          <Button size="xs" variant="outline" onClick={refreshActivity}>
            <T>Retry</T>
          </Button>
        </div>
      ) : (
        <IssueTimelineGhost rows={3} />
      )}
    </div>
  );
});
