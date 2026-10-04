import { Link, useNavigate } from "@tanstack/react-router";
import { parseTicketKey, type ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import type {
  EnvironmentId,
  TicketDetail,
  TicketPlan,
  TicketPlanCommentId,
  TicketPlanStatus,
} from "@t3tools/contracts";
import { orderPlanCommentThreads, type PlanCommentThread } from "@t3tools/shared/ticketPlanAnchors";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CheckIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  lazy,
  Suspense,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";

import { isElectron } from "../../env";
import { useResizableWidth } from "../../hooks/useResizableWidth";
import { useTicketActions } from "../../hooks/useTicketActions";
import { useViewportWidth } from "../../hooks/useViewportWidth";
import { SELECTION_MULTI_CLICK_INTERVAL_MS } from "../../lib/selectionActions";
import { cn } from "../../lib/utils";
import { useTicket, useTicketDetail, useTicketPlan } from "../../state/tickets";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { RightPanelResizeHandle } from "../preview/RightPanelResizeHandle";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PLAN_ENTRY_VERBS, TicketActorName } from "./TicketActivityTimeline";
import { uploadTicketFiles } from "./ticketAttachments";
import { copyText, TicketBreadcrumbHeader } from "./TicketDetailPage";
import { hasUnsavedBody } from "./ticketDocument.logic";
import {
  type PlanCommentDraft,
  type PlanCommentSurfaceHandle,
  TicketPlanCommentSurface,
} from "./TicketPlanCommentSurface";
import {
  type PlanCommentFocus,
  TicketPlanCommentList,
  TicketPlanNewComment,
} from "./TicketPlanComments";
import { TicketPlanDocument } from "./TicketPlanDocument";
import {
  findTicketPlanByNumber,
  type TicketPlanActivity,
  ticketPlanHistory,
} from "./ticketPlans.logic";
import { formatTicketRef } from "./ticketRefs";
import { useTicketPlanDocument } from "./useTicketDocument";

const TicketBodyEditor = lazy(() => import("./TicketBodyEditor"));

const PANEL_WIDTH_STORAGE_KEY = "vetra:ticket-plan-panel-width";
const PANEL_MIN_WIDTH = 260;
const PANEL_DEFAULT_WIDTH = 320;
const PANEL_VIEWPORT_RESERVE = 640;
const SIDE_PANEL_MIN_VIEWPORT = 1024;

const PLAN_PANEL_TABS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "history", label: "History" },
] as const;
type PlanPanelTab = (typeof PLAN_PANEL_TABS)[number]["value"];

/**
 * `/tickets/$ticketKey/plans/$planNumber`. The ticket's detail resolves the number to a plan and
 * carries its history; the plan's own subscription carries the body.
 */
export function TicketPlanPage(props: {
  readonly ticketKey: string;
  readonly planNumber: string;
  /** Opened right after creating the plan: edit mode, title focused. */
  readonly startEditing: boolean;
}) {
  const ticketRef = useMemo(() => parseTicketKey(props.ticketKey), [props.ticketKey]);
  const detailResult = useTicketDetail(ticketRef);
  const detail = Option.getOrNull(AsyncResult.value(detailResult));
  const ticket = useTicket(ticketRef);
  const summary =
    detail === null ? null : findTicketPlanByNumber(detail.summary.plans, props.planNumber);
  const planResult = useTicketPlan(
    ticketRef === null || summary === null
      ? null
      : { environmentId: ticketRef.environmentId, planId: summary.planId },
  );
  const plan = Option.getOrNull(AsyncResult.value(planResult));
  const ticketLabel = ticket === null ? null : formatTicketRef(ticket);

  if (ticketRef !== null && detail !== null && plan !== null && summary !== null) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
        <TicketPlanView
          ticketKey={props.ticketKey}
          ticketRef={ticketRef}
          detail={detail}
          plan={plan}
          startEditing={props.startEditing}
        />
      </SidebarInset>
    );
  }

  const message =
    ticketRef === null || AsyncResult.isFailure(detailResult)
      ? "This ticket does not exist, or its environment is not connected."
      : detail === null
        ? "Loading plan…"
        : summary === null
          ? null
          : AsyncResult.isFailure(planResult)
            ? "This plan could not be loaded."
            : "Loading plan…";
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <TicketBreadcrumbHeader
          ticket={
            ticketRef === null || ticketLabel === null
              ? null
              : { label: ticketLabel, ticketKey: props.ticketKey }
          }
          current={summary === null ? null : `P${summary.number}`}
        />
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pt-4">
          {summary !== null ? (
            <h2 className="text-xl font-semibold text-foreground">{summary.title}</h2>
          ) : null}
          {message !== null ? (
            <p className="text-sm text-muted-foreground">{message}</p>
          ) : (
            <p className="text-sm text-muted-foreground">
              This plan does not exist.{" "}
              <Link
                to="/tickets/$ticketKey"
                params={{ ticketKey: props.ticketKey }}
                className="text-foreground underline-offset-4 hover:underline"
              >
                Back to {ticketLabel ?? "the ticket"}
              </Link>
            </p>
          )}
        </div>
      </div>
    </SidebarInset>
  );
}

function TicketPlanView(props: {
  readonly ticketKey: string;
  readonly ticketRef: ScopedTicketRef;
  readonly detail: TicketDetail;
  readonly plan: TicketPlan;
  readonly startEditing: boolean;
}) {
  const { ticketKey, ticketRef, detail, plan } = props;
  const { summary } = plan;
  const navigate = useNavigate();
  const actions = useTicketActions();
  const doc = useTicketPlanDocument(ticketRef.environmentId, plan);
  const [editing, setEditing] = useState<"title" | "body" | null>(
    props.startEditing ? "title" : null,
  );
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [tab, setTab] = useState<PlanPanelTab>("open");
  const [focus, setFocus] = useState<PlanCommentFocus | null>(null);
  const [draft, setDraft] = useState<PlanCommentDraft | null>(null);
  const surfaceRef = useRef<PlanCommentSurfaceHandle>(null);
  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const archived = summary.status === "archived";
  const ticketLabel = formatTicketRef(detail.summary);
  const history = useMemo(
    () => ticketPlanHistory(detail.activity, summary.planId),
    [detail.activity, summary.planId],
  );
  // Locating outdated passages scans the whole body, so typing does not wait for it.
  const commentedBody = useDeferredValue(doc.state.text);
  const threads = useMemo(
    () => orderPlanCommentThreads(commentedBody, plan.comments),
    [commentedBody, plan.comments],
  );
  const openThreads = useMemo(
    () => threads.filter(({ comment }) => comment.resolvedAt === null),
    [threads],
  );
  const resolvedThreads = useMemo(
    () => threads.filter(({ comment }) => comment.resolvedAt !== null),
    [threads],
  );
  const tabCounts: Partial<Record<PlanPanelTab, number>> = {
    open: openThreads.length,
    resolved: resolvedThreads.length,
  };
  const startDraft = useCallback((next: PlanCommentDraft) => {
    setDraft(next);
    setTab("open");
  }, []);
  const focusThread = useCallback((id: TicketPlanCommentId) => {
    setFocus({ id, reveal: true });
    setTab("open");
  }, []);
  const selectThread = useCallback((thread: PlanCommentThread) => {
    setFocus({ id: thread.comment.id, reveal: false });
    surfaceRef.current?.scrollToThread(thread);
  }, []);
  const addComment = async (body: string) => {
    const comment = await actions.addPlanComment(ticketRef.environmentId, {
      planId: summary.planId,
      body,
      ...(draft === null ? {} : { anchor: draft.anchor }),
    });
    if (comment === null) return false;
    setDraft(null);
    setFocus({ id: comment.id, reveal: true });
    return true;
  };

  const viewportWidth = useViewportWidth();
  const sidePanel = viewportWidth >= SIDE_PANEL_MIN_VIEWPORT;
  useEffect(() => {
    // Below the plan on narrow screens, revealing the composer would scroll away from the passage.
    if (draft !== null) newCommentRef.current?.focus({ preventScroll: !sidePanel });
  }, [draft, sidePanel]);
  const { width, handlers } = useResizableWidth({
    storageKey: PANEL_WIDTH_STORAGE_KEY,
    defaultWidth: PANEL_DEFAULT_WIDTH,
    minWidth: PANEL_MIN_WIDTH,
    maxWidth: Math.max(PANEL_MIN_WIDTH, viewportWidth - PANEL_VIEWPORT_RESERVE),
    edge: "left",
  });

  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!props.startEditing) return;
    titleRef.current?.focus();
    titleRef.current?.select();
    // The flag only means "just created"; drop it so a reload opens the plan as usual.
    void navigate({
      to: "/tickets/$ticketKey/plans/$planNumber",
      params: { ticketKey, planNumber: String(summary.number) },
      search: {},
      replace: true,
    });
  }, [navigate, props.startEditing, summary.number, ticketKey]);

  const commitTitle = () => {
    if (titleDraft === null) return;
    const title = titleDraft.trim();
    setTitleDraft(null);
    if (title.length > 0 && title !== summary.title) void doc.saveTitle(title);
  };
  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  const { addPendingUpload, edit } = doc;
  const onFiles = useCallback(
    (files: ReadonlyArray<File>) =>
      uploadTicketFiles(
        ticketRef.environmentId,
        files,
        (upload) => editingRef.current !== null && addPendingUpload(upload),
      ),
    [addPendingUpload, ticketRef.environmentId],
  );
  const setStatus = (status: TicketPlanStatus) =>
    void actions.setPlanStatus(ticketRef.environmentId, { planId: summary.planId, status });
  const showEditor = editing !== null && !archived;

  const clickToEditRef = useRef<number | undefined>(undefined);
  // A click waiting to start editing ends with the read view.
  useEffect(() => {
    if (showEditor || archived) return;
    return () => window.clearTimeout(clickToEditRef.current);
  }, [showEditor, archived]);

  const menu = (
    <Menu>
      <MenuTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label={`Options for ${summary.ref}`} />}
      >
        <MoreHorizontalIcon aria-hidden className="size-4" />
      </MenuTrigger>
      <MenuPopup align="end" className="w-44">
        <MenuItem onClick={() => copyText(summary.ref, `Copied ${summary.ref}`)}>
          <CopyIcon aria-hidden />
          Copy ref
        </MenuItem>
        {archived ? (
          <MenuItem onClick={() => setStatus("active")}>
            <ArchiveRestoreIcon aria-hidden />
            Restore
          </MenuItem>
        ) : (
          <MenuItem onClick={() => setStatus("archived")}>
            <ArchiveIcon aria-hidden />
            Archive
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem
          variant="destructive"
          onClick={() =>
            void actions.confirmAndDeletePlan(ticketRef.environmentId, summary).then((deleted) => {
              if (deleted) void navigate({ to: "/tickets/$ticketKey", params: { ticketKey } });
            })
          }
        >
          <Trash2Icon aria-hidden />
          Delete
        </MenuItem>
      </MenuPopup>
    </Menu>
  );

  const panel = (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label="Plan panel tabs"
        className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-2"
      >
        <ToggleGroup
          size="segmented"
          variant="segmented"
          value={[tab]}
          onValueChange={(next) => {
            const nextTab = PLAN_PANEL_TABS.find((item) => item.value === next[0])?.value;
            if (nextTab) setTab(nextTab);
          }}
        >
          {PLAN_PANEL_TABS.map((item) => (
            <Toggle key={item.value} value={item.value}>
              {item.label}
              {tabCounts[item.value] ? (
                <span className="text-muted-foreground tabular-nums">{tabCounts[item.value]}</span>
              ) : null}
            </Toggle>
          ))}
        </ToggleGroup>
      </nav>
      <div className="flex flex-col gap-4 px-4 pt-4 pb-8">
        {tab === "open" ? (
          <>
            <TicketPlanNewComment
              ref={newCommentRef}
              draft={draft}
              onCancelDraft={() => setDraft(null)}
              onSubmit={addComment}
            />
            <TicketPlanCommentList
              environmentId={ticketRef.environmentId}
              planId={summary.planId}
              threads={openThreads}
              focus={focus}
              onSelect={selectThread}
              actions={actions}
              empty="No open comments. Select text in the plan to comment on it."
            />
          </>
        ) : tab === "resolved" ? (
          <TicketPlanCommentList
            environmentId={ticketRef.environmentId}
            planId={summary.planId}
            threads={resolvedThreads}
            focus={focus}
            onSelect={selectThread}
            actions={actions}
            empty="No resolved comments."
          />
        ) : (
          <TicketPlanHistory environmentId={ticketRef.environmentId} history={history} />
        )}
      </div>
    </div>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-row bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <TicketBreadcrumbHeader
          ticket={{ label: ticketLabel, ticketKey }}
          current={`P${summary.number}`}
          copy={summary.ref}
          trailing={<div className="flex items-center gap-1.5">{menu}</div>}
          reachesWindowEdge={!sidePanel}
        />
        <ScrollArea className="min-h-0 flex-1">
          <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-16 lg:px-8">
            <div className="flex flex-col gap-4">
              {archived ? (
                <h2 className="text-3xl leading-tight font-semibold break-words tracking-tight text-foreground">
                  {summary.title}
                </h2>
              ) : (
                <textarea
                  ref={titleRef}
                  value={titleDraft ?? summary.title}
                  aria-label="Plan title"
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
                <span>
                  Plan for{" "}
                  <Link
                    to="/tickets/$ticketKey"
                    params={{ ticketKey }}
                    className="text-foreground hover:underline"
                  >
                    {ticketLabel} {detail.summary.title}
                  </Link>
                </span>
                <span>
                  By{" "}
                  <TicketActorName
                    environmentId={ticketRef.environmentId}
                    actor={summary.createdBy}
                  />
                </span>
                <time
                  dateTime={summary.updatedAt}
                  aria-label={`Updated ${new Date(summary.updatedAt).toLocaleString()}`}
                >
                  Updated {formatRelativeTimeLabel(summary.updatedAt)}
                </time>
                {archived || showEditor ? null : (
                  <div className="ms-auto">
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Edit plan"
                      onClick={() => setEditing("body")}
                    >
                      <PencilIcon aria-hidden />
                      Edit
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {archived ? (
              <div
                role="status"
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
              >
                <ArchiveIcon aria-hidden className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">
                  This plan is archived. Restore it to edit it.
                </span>
                <Button size="xs" variant="outline" onClick={() => setStatus("active")}>
                  Restore
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
                  Someone else changed the plan while you were editing.
                </span>
                <Button size="xs" variant="outline" onClick={doc.reload}>
                  Reload
                </Button>
                <Button size="xs" onClick={doc.keepMine}>
                  Keep mine
                </Button>
              </div>
            ) : null}

            <section aria-label="Plan" className="relative flex flex-col gap-3">
              {showEditor || hasUnsavedBody(doc.state) ? (
                <div className="flex items-center justify-end gap-2">
                  {hasUnsavedBody(doc.state) ? (
                    <span role="status" className="text-xs text-muted-foreground">
                      Unsaved changes
                    </span>
                  ) : null}
                  {showEditor ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label="Done editing plan"
                      onClick={() => setEditing(null)}
                    >
                      <CheckIcon aria-hidden />
                      Done
                    </Button>
                  ) : null}
                </div>
              ) : null}
              {showEditor ? (
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
                      onChange={edit}
                      onFiles={onFiles}
                      placeholder="Describe how to implement the ticket. Paste or drop files to attach them."
                      ariaLabel="Plan"
                      autoFocus={editing === "body"}
                      minHeight="16rem"
                      document="plan"
                    />
                  </Suspense>
                </div>
              ) : (
                // Not a button: the selection and highlight code ignores text inside controls.
                // The header's Edit button is the keyboard way in.
                <div
                  className={cn("min-w-0", !archived && "cursor-text")}
                  onPointerDown={
                    archived ? undefined : () => window.clearTimeout(clickToEditRef.current)
                  }
                  onClick={
                    archived
                      ? undefined
                      : (event) => {
                          if (
                            event.detail > 1 ||
                            !(event.target instanceof Element) ||
                            event.target.closest("a, button, input, video, audio, summary") ||
                            window.getSelection()?.toString()
                          )
                            return;
                          // Waits out a double or triple click, which selects text to comment on.
                          clickToEditRef.current = window.setTimeout(() => {
                            if (!window.getSelection()?.toString()) setEditing("body");
                          }, SELECTION_MULTI_CLICK_INTERVAL_MS);
                        }
                  }
                >
                  {doc.state.text.trim().length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">
                      {archived ? "This plan is empty." : "Write the plan…"}
                    </p>
                  ) : (
                    <TicketPlanCommentSurface
                      ref={surfaceRef}
                      body={doc.state.text}
                      revision={summary.revision}
                      threads={openThreads}
                      focusedId={focus?.id ?? null}
                      draft={draft}
                      onDraft={startDraft}
                      onFocusThread={focusThread}
                    >
                      <TicketPlanDocument
                        environmentId={ticketRef.environmentId}
                        body={doc.state.text}
                        attachments={plan.attachments}
                        onBodyChange={archived ? undefined : edit}
                      />
                    </TicketPlanCommentSurface>
                  )}
                </div>
              )}
            </section>

            {!sidePanel ? (
              <div className="overflow-hidden rounded-lg border border-border/70">{panel}</div>
            ) : null}
          </article>
        </ScrollArea>
      </div>
      {sidePanel ? (
        <aside
          className="relative flex min-h-0 w-(--plan-panel-width) shrink-0 flex-col border-s border-border/70 bg-muted/10"
          style={{ "--plan-panel-width": `${width}px` } as CSSProperties}
        >
          <RightPanelResizeHandle handlers={handlers} label="Resize plan panel" />
          <div
            className={cn(
              "h-[var(--workspace-topbar-height)] shrink-0",
              isElectron && "drag-region",
            )}
          />
          <ScrollArea className="min-h-0 flex-1">{panel}</ScrollArea>
        </aside>
      ) : null}
    </div>
  );
}

function TicketPlanHistory(props: {
  readonly environmentId: EnvironmentId;
  readonly history: ReadonlyArray<TicketPlanActivity>;
}) {
  if (props.history.length === 0) {
    return <p className="text-xs text-muted-foreground">No history yet.</p>;
  }
  return (
    <ol aria-label="Plan history" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {props.history.map((item) => (
        <li key={item.id} className="text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">
            <TicketActorName environmentId={props.environmentId} actor={item.actor} />
          </span>{" "}
          {PLAN_ENTRY_VERBS[item.entry.type]} the plan
          <time
            dateTime={item.createdAt}
            aria-label={new Date(item.createdAt).toLocaleString()}
            className="text-muted-foreground/70"
          >
            {" · "}
            {formatRelativeTimeLabel(item.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
