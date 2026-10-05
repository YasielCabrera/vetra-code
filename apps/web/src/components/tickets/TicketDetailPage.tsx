import { useNavigate } from "@tanstack/react-router";
import {
  parseTicketKey,
  type ScopedTicketRef,
  ticketKey,
} from "@t3tools/client-runtime/state/tickets";
import {
  type TicketDetail,
  type TicketId,
  type TicketLinkKind,
  type TicketLinkTarget,
  type TicketPlanId,
  type TicketStatusId,
  ticketLinkTargetKey,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  CircleCheckIcon,
  CircleDotIcon,
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  PaperclipIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { memo, useCallback, useMemo, useState } from "react";

import { useRunning } from "../../hooks/useRunning";
import { confirmGitHubStateChange, useTicketActions } from "../../hooks/useTicketActions";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import {
  useTicket,
  useTicketDetail,
  useTicketGitHubSources,
  useTicketStatuses,
} from "../../state/tickets";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { TicketActivityTimeline } from "./TicketActivityTimeline";
import { TicketAttachmentChip } from "./ticketAttachments";
import { TicketDocumentEditor } from "./TicketDocumentEditor";
import {
  openOnGitHub,
  TicketGitHubActivity,
  TicketGitHubProperties,
  useTicketIssueReads,
} from "./TicketGitHub";
import {
  issueStateTargetStatus,
  ticketGitHubSource,
  ticketIssueRef,
  ticketRepositoryProjectId,
} from "./ticketGitHub.logic";
import { TicketLinkPreview, type TicketLinkPreviewTarget } from "./TicketLinkPreview";
import { TicketMarkdownBody } from "./TicketMarkdownBody";
import { copyText, TicketBreadcrumbHeader, TicketPagePlaceholder } from "./ticketPageHeader";
import { TicketPlanPreview, TicketPlanPreviewHeader, TicketPlansSection } from "./TicketPlans";
import { TicketPropertiesPanel } from "./TicketPropertiesPanel";
import { ticketContextRecord } from "./ticketContextRecord";
import { TicketSidePanelLayout, useSidePanelFits } from "./TicketSidePanelLayout";
import { TicketStartThreadSubmenu } from "./TicketStartThreadMenu";
import { formatTicketRef } from "./ticketRefs";
import { TicketTitleInput } from "./TicketTitleInput";
import { useTicketDocument } from "./useTicketDocument";
import { useTitleDraft } from "./useTitleDraft";

const PANEL_WIDTH_STORAGE_KEY = "vetra:ticket-panel-width";
const PANEL_DEFAULT_WIDTH = 300;
const PREVIEW_WIDTH_STORAGE_KEY = "vetra:ticket-preview-width";
const PREVIEW_DEFAULT_WIDTH = 560;

export function TicketDetailPage(props: { readonly ticketKey: string }) {
  const ref = useMemo(() => parseTicketKey(props.ticketKey), [props.ticketKey]);
  const detail = useTicketDetail(ref);
  const loaded = Option.getOrNull(AsyncResult.value(detail));
  const summary = useTicket(ref);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      {ref !== null && loaded !== null ? (
        <TicketDocument ticketRef={ref} detail={loaded} />
      ) : (
        <TicketPagePlaceholder
          header={
            <TicketBreadcrumbHeader current={summary === null ? null : formatTicketRef(summary)} />
          }
          title={summary?.title ?? null}
        >
          {ref === null || AsyncResult.isFailure(detail)
            ? "This ticket does not exist, or its environment is not connected."
            : "Loading ticket…"}
        </TicketPagePlaceholder>
      )}
    </SidebarInset>
  );
}

type TicketPanelPreview =
  | { readonly ticketId: TicketId; readonly kind: TicketLinkKind; readonly targetKey: string }
  | { readonly ticketId: TicketId; readonly kind: "plan"; readonly planId: TicketPlanId };

function TicketDocument(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly detail: TicketDetail;
}) {
  const { ticketRef, detail } = props;
  const { summary } = detail;
  const navigate = useNavigate();
  const actions = useTicketActions();
  const statusSet = useTicketStatuses(ticketRef.environmentId);
  const [editing, setEditing] = useState(false);
  const doc = useTicketDocument(ticketRef, detail);
  const title = useTitleDraft(summary.title, doc);
  const readOnly = summary.kind === "github";
  const reference = formatTicketRef(summary);
  const ticket = useMemo(
    () => ({ ...summary, environmentId: ticketRef.environmentId }),
    [summary, ticketRef.environmentId],
  );
  const { link, unlink } = actions;
  const githubTicket = ticket.kind === "github" ? ticket : null;
  const githubSources = useTicketGitHubSources();
  const projects = useProjects();
  const repositoryContext = useMemo(
    () => ({
      sources: githubSources,
      linkedProjectIds: summary.linkRefs.flatMap((ref) =>
        ref.kind === "project" ? [ref.targetKey] : [],
      ),
      projects,
    }),
    [githubSources, projects, summary.linkRefs],
  );
  const [preview, setPreview] = useState<TicketPanelPreview | null>(null);
  // A preview closes by itself once its link or plan is gone.
  const previewPlan =
    preview?.kind === "plan" && preview.ticketId === summary.id
      ? (summary.plans.find((plan) => plan.planId === preview.planId) ?? null)
      : null;
  const previewTarget = useMemo(() => {
    if (preview === null || preview.kind === "plan" || preview.ticketId !== summary.id) return null;
    const link = detail.links.find(
      (candidate) =>
        candidate.target.kind === preview.kind &&
        ticketLinkTargetKey(candidate.target) === preview.targetKey,
    );
    return link === undefined || link.target.kind === "project" ? null : link.target;
  }, [detail.links, preview, summary.id]);
  const previewProjectId =
    previewTarget === null || previewTarget.kind !== "pull_request"
      ? null
      : ticketRepositoryProjectId(ticketRef.environmentId, previewTarget.ref, repositoryContext);
  const widePanel =
    previewProjectId !== null || previewPlan !== null || previewTarget?.kind === "issue";
  const sidePanel = useSidePanelFits();
  const githubSource =
    githubTicket === null
      ? null
      : ticketGitHubSource(githubTicket.environmentId, githubTicket.github, githubSources);
  const issueRef = useMemo(
    () => (githubTicket === null ? null : ticketIssueRef(githubTicket, repositoryContext)),
    [githubTicket, repositoryContext],
  );
  const issueReads = useTicketIssueReads(ticketRef.environmentId, issueRef);
  const [refreshingGitHub, trackGitHubRefresh] = useRunning();
  const hidden = githubTicket !== null && githubTicket.hiddenAt !== null;

  const { setStatus, saveLabels } = doc;
  const changeStatus = useCallback(
    async (statusId: TicketStatusId) => {
      const status = statusSet?.statuses.find((candidate) => candidate.id === statusId);
      if (status === undefined || !(await confirmGitHubStateChange(ticket, status))) return;
      await setStatus(statusId);
    },
    [setStatus, statusSet, ticket],
  );
  const moveIssue = (action: "close" | "reopen") => {
    const status = issueStateTargetStatus(statusSet, action);
    if (status !== undefined) void setStatus(status.id);
  };
  const refreshIssue = issueReads.refresh;
  const refreshGitHub = useCallback(
    () => void trackGitHubRefresh(refreshIssue),
    [refreshIssue, trackGitHubRefresh],
  );

  const onLink = useCallback(
    (target: TicketLinkTarget) => link(ticketRef, target),
    [link, ticketRef],
  );
  const onUnlink = useCallback(
    (kind: TicketLinkKind, targetKey: string) => void unlink(ticketRef, kind, targetKey),
    [ticketRef, unlink],
  );
  const onPreview = useCallback(
    (target: TicketLinkPreviewTarget) =>
      setPreview({
        ticketId: summary.id,
        kind: target.kind,
        targetKey: ticketLinkTargetKey(target),
      }),
    [summary.id],
  );
  const onPreviewPlan = useCallback(
    (planId: TicketPlanId) => setPreview({ ticketId: summary.id, kind: "plan", planId }),
    [summary.id],
  );
  const lastSyncedAt = githubSource?.lastSyncedAt ?? null;
  const hasSource = githubSource !== null;
  const githubProperties = useMemo(
    () =>
      githubTicket === null ? null : (
        <TicketGitHubProperties
          ticket={githubTicket}
          reference={issueRef}
          reads={issueReads}
          lastSyncedAt={lastSyncedAt}
          hasSource={hasSource}
          refreshing={refreshingGitHub}
          onRefresh={refreshGitHub}
        />
      ),
    [githubTicket, hasSource, issueReads, issueRef, lastSyncedAt, refreshGitHub, refreshingGitHub],
  );

  const panel = (
    <TicketPropertiesPanel
      environmentId={ticketRef.environmentId}
      detail={detail}
      statusSet={statusSet}
      onStatusChange={changeStatus}
      onLabelsChange={saveLabels}
      onLink={onLink}
      onUnlink={onUnlink}
      onPreview={onPreview}
      githubProperties={githubProperties}
    />
  );

  const panelPreview =
    previewPlan !== null ? (
      <TicketPlanPreview
        key={`plan:${previewPlan.planId}`}
        ticketRef={ticketRef}
        ticket={summary}
        plan={previewPlan}
        stacked={!sidePanel}
        onBack={() => setPreview(null)}
      />
    ) : previewTarget !== null ? (
      <TicketLinkPreview
        key={`${previewTarget.kind}:${ticketLinkTargetKey(previewTarget)}`}
        environmentId={ticketRef.environmentId}
        ticketId={summary.id}
        target={previewTarget}
        projectId={previewProjectId}
        stacked={!sidePanel}
        onBack={() => setPreview(null)}
      />
    ) : null;

  const menu = (
    <Menu>
      <MenuTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label={`Options for ${reference}`} />}
      >
        <MoreHorizontalIcon aria-hidden className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-44" keepMounted>
        <TicketStartThreadSubmenu
          environmentId={ticketRef.environmentId}
          ticket={summary}
          prefill={() => ({
            records: [
              ticketContextRecord({
                environmentId: ticketRef.environmentId,
                ticket: summary,
                body: doc.readText(),
              }),
            ],
          })}
          label="Start thread"
          icon={<MessageSquarePlusIcon aria-hidden />}
        />
        <MenuSeparator />
        {readOnly || editing ? null : (
          <MenuItem onClick={() => setEditing(true)}>
            <PencilIcon aria-hidden />
            Edit description
          </MenuItem>
        )}
        <MenuItem onClick={() => copyText(reference, `Copied ${reference}`)}>
          <CopyIcon aria-hidden />
          Copy ref
        </MenuItem>
        <MenuItem
          onClick={() =>
            copyText(
              `${window.location.origin}/tickets/${ticketKey({ environmentId: ticketRef.environmentId, ticketId: summary.id })}`,
              "Link copied",
            )
          }
        >
          <LinkIcon aria-hidden />
          Copy link
        </MenuItem>
        {githubTicket === null ? null : (
          <>
            <MenuItem onClick={() => openOnGitHub(githubTicket.github.url)}>
              <ExternalLinkIcon aria-hidden />
              Open on GitHub
            </MenuItem>
            <MenuSeparator />
            {githubTicket.github.state === "open" ? (
              <MenuItem onClick={() => moveIssue("close")}>
                <CircleCheckIcon aria-hidden />
                Close issue
              </MenuItem>
            ) : (
              <MenuItem onClick={() => moveIssue("reopen")}>
                <CircleDotIcon aria-hidden />
                Reopen issue
              </MenuItem>
            )}
            <MenuItem onClick={() => void actions.setHidden(ticketRef, !hidden)}>
              {hidden ? <EyeIcon aria-hidden /> : <EyeOffIcon aria-hidden />}
              {hidden ? "Track again" : "Stop tracking"}
            </MenuItem>
          </>
        )}
        {readOnly ? null : (
          <>
            <MenuSeparator />
            <MenuItem
              variant="destructive"
              onClick={() =>
                void actions
                  .confirmAndDelete({ ...summary, environmentId: ticketRef.environmentId })
                  .then((deleted) => {
                    if (deleted) void navigate({ to: "/tickets", search: {} });
                  })
              }
            >
              <Trash2Icon aria-hidden />
              Delete
            </MenuItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );

  return (
    <TicketSidePanelLayout
      sidePanel={sidePanel}
      panelHeader={
        previewPlan === null ? undefined : (
          <TicketPlanPreviewHeader
            ticketRef={ticketRef}
            ticket={summary}
            plan={previewPlan}
            onBack={() => setPreview(null)}
          />
        )
      }
      panel={
        widePanel ? (
          panelPreview
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            {panelPreview ?? <div className="px-5 pt-7 pb-8">{panel}</div>}
          </ScrollArea>
        )
      }
      storageKey={widePanel ? PREVIEW_WIDTH_STORAGE_KEY : PANEL_WIDTH_STORAGE_KEY}
      defaultWidth={widePanel ? PREVIEW_DEFAULT_WIDTH : PANEL_DEFAULT_WIDTH}
      resizeLabel="Resize ticket panel"
    >
      <TicketBreadcrumbHeader
        current={
          <>
            <span className="me-2 shrink-0 font-mono text-muted-foreground">{reference}</span>
            <TicketTitleInput title={title} label="Title" readOnly={readOnly} />
          </>
        }
        trailing={menu}
        reachesWindowEdge={!sidePanel}
      />
      <ScrollArea className="min-h-0 flex-1">
        <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-4 pb-16 lg:px-8">
          {hidden ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
            >
              <EyeOffIcon aria-hidden className="size-4 shrink-0" />
              <span className="min-w-0 flex-1">
                You stopped tracking this issue. It stays off the board and sync leaves it alone.
              </span>
              <Button
                size="xs"
                variant="outline"
                onClick={() => void actions.setHidden(ticketRef, false)}
              >
                Track again
              </Button>
            </div>
          ) : null}

          <TicketDocumentEditor
            environmentId={ticketRef.environmentId}
            doc={doc}
            label="Description"
            editing={editing}
            onDone={() => setEditing(false)}
            editor={{
              placeholder: "Describe the work. Paste or drop files to attach them.",
              autoFocus: true,
              minHeight: "12rem",
            }}
            notice={
              githubTicket === null ? undefined : (
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Description is synced from GitHub.</span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => openOnGitHub(githubTicket.github.url)}
                  >
                    <ExternalLinkIcon aria-hidden />
                    Edit on GitHub
                  </Button>
                </div>
              )
            }
            emptyText={readOnly ? "No description." : "No description yet."}
            footer={
              detail.attachments.length > 0 ? (
                <div
                  className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-4"
                  aria-label="Attachments"
                >
                  <PaperclipIcon aria-hidden className="size-3.5 text-muted-foreground" />
                  {detail.attachments.map((attachment) => (
                    <TicketAttachmentChip
                      key={attachment.id}
                      environmentId={ticketRef.environmentId}
                      attachment={attachment}
                      onRemove={
                        readOnly
                          ? undefined
                          : () => void doc.saveFields({ removeAttachmentIds: [attachment.id] })
                      }
                    />
                  ))}
                </div>
              ) : null
            }
          >
            <TicketMarkdownBody
              environmentId={ticketRef.environmentId}
              body={doc.state.text}
              attachments={detail.attachments}
              onBodyChange={readOnly ? undefined : doc.edit}
            />
          </TicketDocumentEditor>

          <TicketPlansSection
            ticketRef={ticketRef}
            ticket={summary}
            previewPlanId={previewPlan?.planId ?? null}
            onPreview={onPreviewPlan}
          />

          {!sidePanel ? (
            <div
              className={cn(
                "rounded-lg border border-border/70",
                panelPreview === null ? "p-3" : "overflow-hidden pt-2",
              )}
            >
              {panelPreview ?? panel}
            </div>
          ) : null}

          <section className="flex flex-col gap-4 border-t border-border/60 pt-6">
            <div className="flex items-center gap-2">
              <MessageSquareIcon aria-hidden className="size-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Activity</h2>
            </div>
            <TicketActivityTimeline
              environmentId={ticketRef.environmentId}
              activity={detail.activity}
              statusSet={statusSet}
              plans={summary.plans}
            />
            {githubTicket === null ? null : (
              <TicketGitHubActivity
                environmentId={ticketRef.environmentId}
                reads={issueReads}
                hasReference={issueRef !== null}
              />
            )}
            <TicketCommentComposer
              ticketRef={ticketRef}
              github={githubTicket !== null}
              onPosted={issueReads.refresh}
            />
          </section>
        </article>
      </ScrollArea>
    </TicketSidePanelLayout>
  );
}

const TicketCommentComposer = memo(function TicketCommentComposer(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly github: boolean;
  readonly onPosted: () => Promise<void>;
}) {
  const actions = useTicketActions();
  const [comment, setComment] = useState("");
  const [commenting, setCommenting] = useState(false);
  const submit = async () => {
    const body = comment.trim();
    if (!body || commenting) return;
    setCommenting(true);
    const result = await actions.comment(props.ticketRef, body);
    setCommenting(false);
    if (result === null) return;
    setComment("");
    if (props.github) void props.onPosted();
  };
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-muted/15 p-3">
      <Textarea
        value={comment}
        aria-label={props.github ? "Comment on GitHub" : "Comment"}
        placeholder={props.github ? "Comment on the GitHub issue" : "Leave a comment…"}
        rows={3}
        readOnly={commenting}
        onChange={(event) => setComment(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">⌘ / Ctrl + Enter to comment</span>
        <Button size="sm" disabled={!comment.trim() || commenting} onClick={() => void submit()}>
          {commenting ? "Posting…" : props.github ? "Comment on GitHub" : "Comment"}
        </Button>
      </div>
    </div>
  );
});
