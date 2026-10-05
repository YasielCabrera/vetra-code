import { useNavigate } from "@tanstack/react-router";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentId,
  ProjectId,
  ThreadId,
  TicketId,
  TicketLinkTarget,
} from "@t3tools/contracts";
import { formatModelSlugName } from "@t3tools/shared/model";
import { ArrowLeftIcon, ExternalLinkIcon, MessageSquareIcon } from "lucide-react";
import { useMemo } from "react";

import { isElectron } from "../../env";
import { cn } from "../../lib/utils";
import { useProject, useThreadShell } from "../../state/entities";
import { useTicketIssueLinksSupported } from "../../state/tickets";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { IssueDetailPanel } from "../issue/IssueDetailPanel";
import { PullRequestDetailPanel } from "../pullRequest/PullRequestDetailPanel";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { openOnGitHub } from "./TicketGitHub";
import { TicketPropertyRow } from "./ticketPresentation";

export type TicketLinkPreviewTarget = Exclude<TicketLinkTarget, { readonly kind: "project" }>;

function getShortcutContext() {
  return {
    terminalFocus: false,
    terminalOpen: false,
    previewFocus: false,
    previewOpen: false,
    isWeb: !isElectron,
    isDesktop: isElectron,
  };
}

export function TicketLinkPreview(props: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: TicketId;
  readonly target: TicketLinkPreviewTarget;
  readonly projectId: ProjectId | null;
  readonly stacked: boolean;
  readonly onBack: () => void;
}) {
  const { target, projectId } = props;
  const issueLinksSupported = useTicketIssueLinksSupported(props.environmentId);
  const reference = useMemo(
    () =>
      target.kind !== "pull_request" || projectId === null ? null : { projectId, ...target.ref },
    [projectId, target],
  );
  const issueReference = useMemo(
    () => (target.kind === "issue" ? { ticketId: props.ticketId, linkedIssue: target.ref } : null),
    [props.ticketId, target],
  );
  const hostedPanel =
    reference !== null ? (
      <PullRequestDetailPanel
        environmentId={props.environmentId}
        reference={reference}
        shortcutsEnabled
        getShortcutContext={getShortcutContext}
      />
    ) : issueReference !== null && issueLinksSupported ? (
      <IssueDetailPanel environmentId={props.environmentId} reference={issueReference} />
    ) : null;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col",
        hostedPanel === null ? null : props.stacked ? "h-[70dvh]" : "flex-1",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Button size="xs" variant="ghost-muted" onClick={props.onBack}>
          <ArrowLeftIcon aria-hidden />
          Properties
        </Button>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {target.kind === "thread"
            ? "Thread preview"
            : target.kind === "pull_request"
              ? "Pull request preview"
              : "Issue preview"}
        </span>
      </div>
      {hostedPanel !== null ? (
        <div className="min-h-0 flex-1">{hostedPanel}</div>
      ) : (
        <div className="px-5 pt-5 pb-8">
          {target.kind === "thread" ? (
            <ThreadPreviewCard environmentId={props.environmentId} threadId={target.threadId} />
          ) : (
            <UnreadableLinkCard
              target={target}
              {...(target.kind === "issue" && !issueLinksSupported
                ? {
                    description:
                      "Inline issue previews are unavailable on this environment. Open the recorded link on GitHub.",
                  }
                : {})}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ThreadPreviewCard(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
}) {
  const navigate = useNavigate();
  const thread = useThreadShell(scopeThreadRef(props.environmentId, props.threadId));
  const project = useProject(
    thread === null ? null : scopeProjectRef(props.environmentId, thread.projectId),
  );
  if (thread === null) {
    return <p className="text-sm text-muted-foreground">This thread no longer exists.</p>;
  }
  const status = resolveThreadStatusPill({ thread });
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2">
        <MessageSquareIcon aria-hidden className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 text-base font-semibold break-words text-foreground">
          {thread.title}
        </h3>
      </div>
      <div className="flex flex-col gap-1.5">
        <TicketPropertyRow label="Status">
          <span
            className={cn(
              "inline-flex items-center gap-1.5",
              status?.colorClass ?? "text-muted-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn("size-1.5 rounded-full", status?.dotClass ?? "bg-muted-foreground")}
            />
            {status?.label ?? (thread.archivedAt === null ? "Idle" : "Archived")}
          </span>
        </TicketPropertyRow>
        <TicketPropertyRow label="Model">
          {formatModelSlugName(thread.modelSelection.model)}
        </TicketPropertyRow>
        {project === null ? null : (
          <TicketPropertyRow label="Project">{project.title}</TicketPropertyRow>
        )}
        {thread.branch === null ? null : (
          <TicketPropertyRow label="Branch">
            <span className="block truncate font-mono text-xs">{thread.branch}</span>
          </TicketPropertyRow>
        )}
        <TicketPropertyRow label="Updated">
          {formatRelativeTimeLabel(thread.updatedAt)}
        </TicketPropertyRow>
      </div>
      <div>
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void navigate({
              to: "/$environmentId/$threadId",
              params: buildThreadRouteParams(scopeThreadRef(props.environmentId, thread.id)),
            })
          }
        >
          Open thread
        </Button>
      </div>
    </div>
  );
}

function UnreadableLinkCard(props: {
  readonly target: Exclude<TicketLinkPreviewTarget, { readonly kind: "thread" }>;
  readonly description?: string;
}) {
  const { ref, snapshot } = props.target;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-base font-semibold break-words text-foreground">{snapshot.title}</h3>
        <p className="text-xs text-muted-foreground">
          {ref.repository}#{ref.number} · {snapshot.state}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        {props.description ?? `Link a project that uses ${ref.repository} to see the details here.`}
      </p>
      <div>
        <Button size="sm" variant="outline" onClick={() => openOnGitHub(snapshot.url)}>
          <ExternalLinkIcon aria-hidden />
          {ref.host === "github.com" ? "Open on GitHub" : `Open on ${ref.host}`}
        </Button>
      </div>
    </div>
  );
}
