import type {
  EnvironmentId,
  GitHubIssueSnapshot,
  IssueActor,
  TicketGitHubIssueRef,
} from "@t3tools/contracts";
import { CircleCheckIcon, CircleDotIcon } from "lucide-react";
import { memo, useCallback, useMemo } from "react";

import { readLocalApi } from "../../localApi";
import { ticketEnvironment } from "../../state/tickets";
import { useEnvironmentQuery } from "../../state/query";
import { useTicketActions } from "../../hooks/useTicketActions";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { IssueAssigneePicker } from "../issue/IssueAssigneePicker";
import { IssueTimelineGhost } from "../issue/IssueGhosts";
import { IssueTimeline } from "../issue/IssueTimeline";
import { SourceControlActorAvatar } from "../SourceControlActorAvatar";
import { GitHubIcon } from "../Icons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import type { GitHubTicket } from "./ticketGitHub.logic";
import { TicketPropertyRow } from "./ticketPresentation";

export function openOnGitHub(url: string) {
  void readLocalApi()
    ?.shell.openExternal(url)
    .catch(() => undefined);
}

export function useTicketIssueReads(
  environmentId: EnvironmentId,
  reference: TicketGitHubIssueRef | null,
) {
  const target = useMemo(
    () => (reference === null ? null : { environmentId, input: reference }),
    [environmentId, reference],
  );
  const detail = useEnvironmentQuery(
    target === null ? null : ticketEnvironment.githubIssueDetail(target),
  );
  const activity = useEnvironmentQuery(
    target === null ? null : ticketEnvironment.githubIssueActivity(target),
  );
  const { refreshGitHubIssue: refreshTicket } = useTicketActions();
  const refreshDetail = detail.refresh;
  const refreshActivity = activity.refresh;
  const refresh = useCallback(async () => {
    if (target === null) return;
    await refreshTicket({ environmentId: target.environmentId, ticketId: target.input.ticketId });
    refreshDetail();
    refreshActivity();
  }, [refreshTicket, refreshActivity, refreshDetail, target]);
  return useMemo(
    () => ({
      issue: detail.data,
      activity: activity.data,
      activityError: activity.error,
      refreshActivity,
      refresh,
    }),
    [activity.data, activity.error, detail.data, refresh, refreshActivity],
  );
}

type TicketIssueReads = ReturnType<typeof useTicketIssueReads>;

function describeIssueState(github: GitHubIssueSnapshot): string {
  if (github.state === "open") return "Open";
  switch (github.stateReason) {
    case "not_planned":
      return "Closed as not planned";
    case "duplicate":
      return "Closed as duplicate";
    default:
      return "Closed";
  }
}

export function TicketGitHubStateBadge(props: { readonly github: GitHubIssueSnapshot }) {
  const open = props.github.state === "open";
  return (
    <Badge variant={open ? "success" : "secondary"} size="control">
      {open ? <CircleDotIcon aria-hidden /> : <CircleCheckIcon aria-hidden />}
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
  const { ticket } = props;
  const assignees: ReadonlyArray<IssueActor> =
    props.reads.issue?.assignees ??
    ticket.github.assignees.map((login) => ({ login, name: null, avatarUrl: null }));
  return (
    <>
      <TicketPropertyRow label="Repository">
        <span className="block truncate">{ticket.github.repository}</span>
      </TicketPropertyRow>
      <TicketPropertyRow label="Issue">
        <button
          type="button"
          className="hover:underline"
          onClick={() => openOnGitHub(ticket.github.url)}
        >
          #{ticket.github.number}
        </button>
      </TicketPropertyRow>
      <TicketPropertyRow label="State">
        <TicketGitHubStateBadge github={ticket.github} />
      </TicketPropertyRow>
      <TicketPropertyRow label="Assignees">
        <div className="flex flex-wrap items-center gap-1.5">
          {assignees.length === 0 ? (
            <span className="text-xs text-muted-foreground">None</span>
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
      <TicketPropertyRow label="Last sync">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {props.hasSource
              ? props.lastSyncedAt === null
                ? "Never"
                : formatRelativeTimeLabel(props.lastSyncedAt)
              : "Not synced"}
          </span>
          <Button size="xs" variant="ghost" disabled={props.refreshing} onClick={props.onRefresh}>
            <RefreshIcon refreshing={props.refreshing} />
            Refresh
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
        On GitHub
      </h3>
      {!props.hasReference ? (
        <p className="text-xs text-muted-foreground">
          Link a project with this repository to see the issue's comments.
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
          <p>Could not load the issue's comments. {activityError}</p>
          <Button size="xs" variant="outline" onClick={refreshActivity}>
            Retry
          </Button>
        </div>
      ) : (
        <IssueTimelineGhost rows={3} />
      )}
    </div>
  );
});
