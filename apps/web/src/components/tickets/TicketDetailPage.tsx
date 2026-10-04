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
  type TicketStatusId,
  ticketLinkTargetKey,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  CheckIcon,
  CircleCheckIcon,
  CircleDotIcon,
  EyeIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  FolderIcon,
  MessageSquareIcon,
  PaperclipIcon,
  TagIcon,
  UserRoundIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import { isElectron } from "../../env";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { useRunning } from "../../hooks/useRunning";
import { confirmGitHubStateChange, useTicketActions } from "../../hooks/useTicketActions";
import { useViewportWidth } from "../../hooks/useViewportWidth";
import { cn } from "../../lib/utils";
import { useProjects } from "../../state/entities";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  useTicket,
  useTicketDetail,
  useTicketGitHubSources,
  useTicketStatuses,
} from "../../state/tickets";
import ChatMarkdown from "../ChatMarkdown";
import { setMarkdownTaskChecked } from "../files/filePreviewMode";
import { GitHubIcon } from "../Icons";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { TicketActivityTimeline } from "./TicketActivityTimeline";
import {
  TicketAttachmentChip,
  TicketAttachmentReference,
  uploadTicketFiles,
} from "./ticketAttachments";
import { hasUnsavedBody } from "./ticketDocument.logic";
import {
  openOnGitHub,
  TicketGitHubActivity,
  TicketGitHubProperties,
  TicketGitHubStateBadge,
  useTicketIssueReads,
} from "./TicketGitHub";
import {
  issueStateTargetStatus,
  ticketGitHubSource,
  ticketIssueRef,
  ticketRepositoryProjectId,
} from "./ticketGitHub.logic";
import { TicketLinkPreview, type TicketLinkPreviewTarget } from "./TicketLinkPreview";
import {
  TicketLabelsEditor,
  TicketPropertiesPanel,
  TicketStatusSelect,
} from "./TicketPropertiesPanel";
import { TicketProjectsEditor } from "./TicketProjectsEditor";
import { TicketStartThreadMenu } from "./TicketStartThreadMenu";
import { formatTicketRef } from "./ticketRefs";
import { useTicketDocument } from "./useTicketDocument";

const TicketBodyEditor = lazy(() => import("./TicketBodyEditor"));

const PANEL_WIDTH_STORAGE_KEY = "vetra:ticket-panel-width";
const PANEL_MIN_WIDTH = 260;
const PANEL_DEFAULT_WIDTH = 300;
const PREVIEW_WIDTH_STORAGE_KEY = "vetra:ticket-preview-width";
const PREVIEW_DEFAULT_WIDTH = 560;
const PANEL_VIEWPORT_RESERVE = 640;
const SIDE_PANEL_MIN_VIEWPORT = 1024;

function copyText(text: string, title: string) {
  void navigator.clipboard.writeText(text).then(
    () => toastManager.add({ type: "success", title, timeout: 1500 }),
    () => toastManager.add({ type: "error", title: "Could not copy to the clipboard" }),
  );
}

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
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
          <TicketBreadcrumbHeader current={summary === null ? null : formatTicketRef(summary)} />
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pt-4">
            {summary !== null ? (
              <h2 className="text-xl font-semibold text-foreground">{summary.title}</h2>
            ) : null}
            <p className="text-sm text-muted-foreground">
              {ref === null || AsyncResult.isFailure(detail)
                ? "This ticket does not exist, or its environment is not connected."
                : "Loading ticket…"}
            </p>
          </div>
        </div>
      )}
    </SidebarInset>
  );
}

function TicketBreadcrumbHeader(props: {
  readonly current: string | null;
  readonly trailing?: ReactNode;
  readonly reachesWindowEdge?: boolean;
}) {
  const navigate = useNavigate();
  return (
    <WorkspacePageHeader
      electron={isElectron}
      reserveNativeControls={isElectron && props.reachesWindowEdge !== false}
    >
      <WorkspaceBreadcrumb ariaLabel="Ticket breadcrumb" className="flex-1">
        <WorkspaceBreadcrumbItem>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => void navigate({ to: "/tickets", search: {} })}
          >
            Tickets
          </button>
        </WorkspaceBreadcrumbItem>
        {props.current === null ? null : (
          <>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate font-mono">
                <button
                  type="button"
                  aria-label={`Copy ${props.current}`}
                  className="hover:text-foreground"
                  onClick={() =>
                    props.current !== null && copyText(props.current, `Copied ${props.current}`)
                  }
                >
                  {props.current}
                </button>
              </h1>
            </WorkspaceBreadcrumbItem>
          </>
        )}
      </WorkspaceBreadcrumb>
      {props.trailing}
    </WorkspacePageHeader>
  );
}

function TicketDocument(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly detail: TicketDetail;
}) {
  const { ticketRef, detail } = props;
  const { summary } = detail;
  const navigate = useNavigate();
  const actions = useTicketActions();
  const statusSet = useTicketStatuses(ticketRef.environmentId);
  const doc = useTicketDocument(ticketRef, detail);
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const readOnly = summary.kind === "github";
  const reference = formatTicketRef(summary);
  const author =
    summary.kind === "github"
      ? (summary.github.author ?? "Unknown author")
      : summary.createdBy.type === "user"
        ? "You"
        : summary.createdBy.type === "agent"
          ? "An agent"
          : summary.createdBy.type === "automation"
            ? "Auto-advance"
            : "GitHub sync";
  const ticket = useMemo(
    () => ({ ...summary, environmentId: ticketRef.environmentId }),
    [summary, ticketRef.environmentId],
  );
  const { link, unlink } = actions;
  const githubTicket = ticket.kind === "github" ? ticket : null;
  const githubSources = useTicketGitHubSources();
  const projects = useProjects();
  const linkedProjects = useMemo(
    () =>
      summary.linkRefs.flatMap((ref) => {
        if (ref.kind !== "project") return [];
        return [
          projects.find(
            (project) =>
              project.environmentId === ticketRef.environmentId && project.id === ref.targetKey,
          )?.title ?? "Missing project",
        ];
      }),
    [projects, summary.linkRefs, ticketRef.environmentId],
  );
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
  const [preview, setPreview] = useState<{
    readonly ticketId: TicketId;
    readonly kind: TicketLinkKind;
    readonly targetKey: string;
  } | null>(null);
  const previewTarget = useMemo(() => {
    if (preview === null || preview.ticketId !== summary.id) return null;
    const link = detail.links.find(
      (candidate) =>
        candidate.target.kind === preview.kind &&
        ticketLinkTargetKey(candidate.target) === preview.targetKey,
    );
    return link === undefined || link.target.kind === "project" ? null : link.target;
  }, [detail.links, preview, summary.id]);
  const previewProjectId =
    previewTarget === null || previewTarget.kind === "thread"
      ? null
      : ticketRepositoryProjectId(ticketRef.environmentId, previewTarget.ref, repositoryContext);
  const widePanel = previewProjectId !== null;
  const viewportWidth = useViewportWidth();
  const sidePanel = viewportWidth >= SIDE_PANEL_MIN_VIEWPORT;
  const { width, handlers } = useResizableWidth({
    storageKey: widePanel ? PREVIEW_WIDTH_STORAGE_KEY : PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: widePanel ? PREVIEW_DEFAULT_WIDTH : PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: Math.max(PANEL_MIN_WIDTH, viewportWidth - PANEL_VIEWPORT_RESERVE),
    edge: "left",
  });
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

  const commitTitle = () => {
    if (titleDraft === null) return;
    const title = titleDraft.trim();
    setTitleDraft(null);
    if (title.length > 0 && title !== summary.title) void doc.saveFields({ title });
  };
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  const { addPendingUpload } = doc;
  const onFiles = useCallback(
    (files: ReadonlyArray<File>) =>
      uploadTicketFiles(
        ticketRef.environmentId,
        files,
        (upload) => editingRef.current && addPendingUpload(upload),
      ),
    [addPendingUpload, ticketRef.environmentId],
  );
  const renderAttachment = useCallback(
    (reference: Parameters<typeof TicketAttachmentReference>[0]["reference"]) => (
      <TicketAttachmentReference
        environmentId={ticketRef.environmentId}
        attachments={detail.attachments}
        reference={reference}
      />
    ),
    [detail.attachments, ticketRef.environmentId],
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

  const linkPreview =
    previewTarget === null ? null : (
      <TicketLinkPreview
        key={`${previewTarget.kind}:${ticketLinkTargetKey(previewTarget)}`}
        environmentId={ticketRef.environmentId}
        target={previewTarget}
        projectId={previewProjectId}
        stacked={!sidePanel}
        onBack={() => setPreview(null)}
      />
    );

  const menu = (
    <Menu>
      <MenuTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label={`Options for ${reference}`} />}
      >
        <MoreHorizontalIcon aria-hidden className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-44">
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-row bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TicketBreadcrumbHeader
          current={reference}
          trailing={
            <div className="flex items-center gap-1.5">
              <TicketStartThreadMenu
                environmentId={ticketRef.environmentId}
                detail={detail}
                readBody={doc.readText}
              />
              {menu}
            </div>
          }
          reachesWindowEdge={!sidePanel}
        />
        <ScrollArea className="min-h-0 flex-1">
          <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-16 lg:px-8">
            <div className="flex flex-col gap-4">
              {readOnly ? (
                <h2 className="text-3xl leading-tight font-semibold break-words tracking-tight text-foreground">
                  {summary.title}
                </h2>
              ) : (
                <textarea
                  value={titleDraft ?? summary.title}
                  aria-label="Title"
                  rows={1}
                  maxLength={500}
                  onChange={(event) => setTitleDraft(event.target.value)}
                  onBlur={commitTitle}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                    if (event.key === "Escape") {
                      flushSync(() => setTitleDraft(null));
                      event.currentTarget.blur();
                    }
                  }}
                  className="field-sizing-content w-full resize-none overflow-hidden rounded-md bg-transparent text-3xl leading-tight font-semibold tracking-tight text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
                {summary.kind === "github" ? (
                  <>
                    <TicketGitHubStateBadge github={summary.github} />
                    <button
                      type="button"
                      className="inline-flex min-w-0 items-center gap-1.5 hover:text-foreground"
                      onClick={() => openOnGitHub(summary.github.url)}
                    >
                      <GitHubIcon aria-hidden className="size-3.5 shrink-0" />
                      <span className="truncate">
                        {summary.github.repository}#{summary.github.number}
                      </span>
                    </button>
                  </>
                ) : (
                  <span>Local ticket</span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <UserRoundIcon aria-hidden className="size-3" />
                  {author}
                </span>
                <time
                  dateTime={summary.createdAt}
                  aria-label={`Created ${new Date(summary.createdAt).toLocaleString()}`}
                >
                  Created {formatRelativeTimeLabel(summary.createdAt)}
                </time>
                <time
                  dateTime={summary.updatedAt}
                  aria-label={`Updated ${new Date(summary.updatedAt).toLocaleString()}`}
                >
                  Updated {formatRelativeTimeLabel(summary.updatedAt)}
                </time>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div
                  className="flex min-w-0 flex-wrap items-center gap-2 lg:hidden"
                  aria-label="Ticket properties"
                >
                  <div className="min-w-0 max-w-full">
                    <TicketStatusSelect
                      statusSet={statusSet}
                      value={summary.statusId}
                      onChange={changeStatus}
                    />
                  </div>
                  <Popover>
                    <PopoverTrigger
                      render={<Button size="xs" variant="ghost" aria-label="Labels" />}
                    >
                      <TagIcon aria-hidden />
                      <span className="max-w-40 truncate">
                        {summary.labels.length === 0
                          ? "Labels"
                          : summary.labels.length === 1
                            ? summary.labels[0]
                            : `${summary.labels.length} labels`}
                      </span>
                    </PopoverTrigger>
                    <PopoverPopup width="sm" padding="compact" align="start">
                      <TicketLabelsEditor
                        labels={summary.labels}
                        readOnly={readOnly}
                        onChange={saveLabels}
                      />
                    </PopoverPopup>
                  </Popover>
                  <Popover>
                    <PopoverTrigger
                      render={<Button size="xs" variant="ghost" aria-label="Projects" />}
                    >
                      <FolderIcon aria-hidden />
                      <span className="max-w-40 truncate">
                        {linkedProjects.length === 0
                          ? "Project"
                          : linkedProjects.length === 1
                            ? linkedProjects[0]
                            : `${linkedProjects.length} projects`}
                      </span>
                    </PopoverTrigger>
                    <PopoverPopup width="sm" padding="compact" align="start">
                      <TicketProjectsEditor
                        environmentId={ticketRef.environmentId}
                        detail={detail}
                      />
                    </PopoverPopup>
                  </Popover>
                </div>
                {readOnly || editing ? null : (
                  <div className="ms-auto">
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Edit description"
                      onClick={() => setEditing(true)}
                    >
                      <PencilIcon aria-hidden />
                      Edit
                    </Button>
                  </div>
                )}
              </div>
            </div>

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

            {doc.state.conflict ? (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-sm text-warning-foreground"
              >
                <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  Someone else changed the description while you were editing.
                </span>
                <Button size="xs" variant="outline" onClick={doc.reload}>
                  Reload
                </Button>
                <Button size="xs" onClick={doc.keepMine}>
                  Keep mine
                </Button>
              </div>
            ) : null}

            <section aria-label="Description" className="relative flex flex-col gap-3">
              {editing || readOnly || hasUnsavedBody(doc.state) ? (
                <div className="flex items-center justify-end gap-2">
                  <div className="flex items-center gap-2">
                    {hasUnsavedBody(doc.state) ? (
                      <span role="status" className="text-xs text-muted-foreground">
                        Unsaved changes
                      </span>
                    ) : null}
                    {githubTicket !== null ? (
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
                    ) : editing ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        aria-label={editing ? "Done editing description" : "Edit description"}
                        onClick={() => setEditing((value) => !value)}
                      >
                        {editing ? <CheckIcon aria-hidden /> : <PencilIcon aria-hidden />}
                        {editing ? "Done" : "Edit"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {editing ? (
                <div className="rounded-lg border border-input p-3 focus-within:border-ring">
                  <Suspense
                    fallback={
                      <pre className="min-h-48 px-3 py-3 font-mono text-sm whitespace-pre-wrap">
                        {doc.state.text}
                      </pre>
                    }
                  >
                    <TicketBodyEditor
                      value={doc.state.text}
                      onChange={doc.edit}
                      onFiles={onFiles}
                      placeholder="Describe the work. Paste or drop files to attach them."
                      ariaLabel="Description"
                      autoFocus
                      minHeight="12rem"
                    />
                  </Suspense>
                </div>
              ) : (
                <div
                  role={readOnly ? undefined : "button"}
                  tabIndex={readOnly ? undefined : 0}
                  aria-label={readOnly ? undefined : "Edit description"}
                  className={cn(
                    "min-w-0 rounded-md outline-none",
                    !readOnly && "cursor-text focus-visible:ring-1 focus-visible:ring-ring",
                  )}
                  onClick={
                    readOnly
                      ? undefined
                      : (event) => {
                          if (
                            !(event.target instanceof Element) ||
                            event.target.closest("a, button, input, video, audio, summary") ||
                            window.getSelection()?.toString()
                          )
                            return;
                          setEditing(true);
                        }
                  }
                  onKeyDown={
                    readOnly
                      ? undefined
                      : (event) => {
                          if (
                            event.target === event.currentTarget &&
                            (event.key === "Enter" || event.key === " ")
                          ) {
                            event.preventDefault();
                            setEditing(true);
                          }
                        }
                  }
                >
                  {doc.state.text.trim().length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                      {readOnly ? "No description." : "Add a description…"}
                    </p>
                  ) : (
                    <ChatMarkdown
                      allowLocalFileLinks={false}
                      text={doc.state.text}
                      cwd={undefined}
                      environmentId={ticketRef.environmentId}
                      renderAttachmentReference={renderAttachment}
                      onTaskListChange={
                        readOnly
                          ? undefined
                          : ({ markerOffset, checked }) =>
                              doc.edit(
                                setMarkdownTaskChecked(doc.state.text, markerOffset, checked),
                              )
                      }
                    />
                  )}
                </div>
              )}
              {detail.attachments.length > 0 ? (
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
              ) : null}
            </section>

            {!sidePanel ? (
              <div
                className={cn(
                  "rounded-lg border border-border/70",
                  linkPreview === null ? "p-3" : "overflow-hidden pt-2",
                )}
              >
                {linkPreview ?? panel}
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
      </div>
      {sidePanel ? (
        <aside
          className="relative flex min-h-0 w-(--ticket-panel-width) shrink-0 flex-col border-s border-border/70 bg-muted/10"
          style={{ "--ticket-panel-width": `${width}px` } as CSSProperties}
        >
          <RightPanelResizeHandle handlers={handlers} label="Resize ticket panel" />
          <div
            className={cn(
              "h-[var(--workspace-topbar-height)] shrink-0",
              isElectron && "drag-region",
            )}
          />
          {widePanel ? (
            linkPreview
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              {linkPreview ?? <div className="px-5 pt-7 pb-8">{panel}</div>}
            </ScrollArea>
          )}
        </aside>
      ) : null}
    </div>
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
