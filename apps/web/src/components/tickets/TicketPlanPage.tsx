import { Link, useNavigate } from "@tanstack/react-router";
import { parseTicketKey, type ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import type { TicketPlan, TicketPlanCommentId, TicketSummary } from "@t3tools/contracts";
import { orderPlanCommentThreads, type PlanCommentThread } from "@t3tools/shared/ticketPlanAnchors";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CopyIcon,
  MessageSquarePlusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SparklesIcon,
  Trash2Icon,
} from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useTicketActions } from "../../hooks/useTicketActions";
import { useTicket, useTicketDetail, useTicketPlan } from "../../state/tickets";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { TicketActorName } from "./TicketActivityTimeline";
import { openPlanPrefill, revisePlanPrefill } from "./ticketContextRecord";
import { TicketDocumentEditor } from "./TicketDocumentEditor";
import { TicketMarkdownBody } from "./TicketMarkdownBody";
import { copyText, TicketBreadcrumbHeader, TicketPagePlaceholder } from "./ticketPageHeader";
import {
  type PlanCommentDraft,
  type PlanCommentSurfaceHandle,
  TicketPlanCommentSurface,
} from "./TicketPlanCommentSurface";
import type { PlanCommentFocus } from "./TicketPlanComments";
import { type PlanPanelTab, TicketPlanPanel } from "./TicketPlanPanel";
import { findTicketPlanByNumber } from "./ticketPlans.logic";
import { formatTicketRef } from "./ticketRefs";
import { TicketSidePanelLayout, useSidePanelFits } from "./TicketSidePanelLayout";
import { TicketStartThreadMenu } from "./TicketStartThreadMenu";
import { TicketTitleInput } from "./TicketTitleInput";
import { usePlanStatus, useTicketPlanDocument } from "./useTicketDocument";
import { useTitleDraft } from "./useTitleDraft";

const PANEL_WIDTH_STORAGE_KEY = "vetra:ticket-plan-panel-width";
const PANEL_DEFAULT_WIDTH = 320;

export function TicketPlanPage(props: {
  readonly ticketKey: string;
  readonly planNumber: string;
  /** Opened right after creating the plan: edit mode, title focused. */
  readonly startEditing: boolean;
}) {
  const ticketRef = useMemo(() => parseTicketKey(props.ticketKey), [props.ticketKey]);
  const boardTicket = useTicket(ticketRef);
  const offBoardDetail = useTicketDetail(boardTicket === null ? ticketRef : null);
  const ticket =
    boardTicket ?? Option.getOrNull(AsyncResult.value(offBoardDetail))?.summary ?? null;
  const summary = ticket === null ? null : findTicketPlanByNumber(ticket.plans, props.planNumber);
  const planResult = useTicketPlan(
    ticketRef === null || summary === null
      ? null
      : { environmentId: ticketRef.environmentId, planId: summary.planId },
  );
  const plan = Option.getOrNull(AsyncResult.value(planResult));
  const ticketLabel = ticket === null ? null : formatTicketRef(ticket);

  if (ticketRef !== null && ticket !== null && plan !== null && summary !== null) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
        <TicketPlanView
          ticketKey={props.ticketKey}
          ticketRef={ticketRef}
          ticket={ticket}
          plan={plan}
          startEditing={props.startEditing}
        />
      </SidebarInset>
    );
  }

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <TicketPagePlaceholder
        header={
          <TicketBreadcrumbHeader
            ticket={
              ticketRef === null || ticketLabel === null
                ? null
                : { label: ticketLabel, ticketKey: props.ticketKey }
            }
            current={summary === null ? null : `P${summary.number}`}
          />
        }
        title={summary?.title ?? null}
      >
        {ticketRef === null || AsyncResult.isFailure(offBoardDetail) ? (
          "This ticket does not exist, or its environment is not connected."
        ) : ticket === null ? (
          "Loading plan…"
        ) : summary === null ? (
          <>
            This plan does not exist.{" "}
            <Link
              to="/tickets/$ticketKey"
              params={{ ticketKey: props.ticketKey }}
              className="text-foreground underline-offset-4 hover:underline"
            >
              Back to {ticketLabel ?? "the ticket"}
            </Link>
          </>
        ) : AsyncResult.isFailure(planResult) ? (
          "This plan could not be loaded."
        ) : (
          "Loading plan…"
        )}
      </TicketPagePlaceholder>
    </SidebarInset>
  );
}

function TicketPlanView(props: {
  readonly ticketKey: string;
  readonly ticketRef: ScopedTicketRef;
  readonly ticket: TicketSummary;
  readonly plan: TicketPlan;
  readonly startEditing: boolean;
}) {
  const { ticketKey, ticketRef, ticket, plan } = props;
  const { environmentId } = ticketRef;
  const { summary } = plan;
  const navigate = useNavigate();
  const actions = useTicketActions();
  const [editing, setEditing] = useState<"title" | "body" | null>(
    props.startEditing ? "title" : null,
  );
  const doc = useTicketPlanDocument(environmentId, plan);
  const title = useTitleDraft(summary.title, doc);
  const [uploading, setUploading] = useState(false);
  const status = usePlanStatus({
    doc,
    commitTitle: title.commit,
    uploading,
    onArchived: () => setEditing(null),
  });
  const [tab, setTab] = useState<PlanPanelTab>("open");
  const [focus, setFocus] = useState<PlanCommentFocus | null>(null);
  const [draft, setDraft] = useState<PlanCommentDraft | null>(null);
  const surfaceRef = useRef<PlanCommentSurfaceHandle>(null);
  const sidePanel = useSidePanelFits();
  const archived = summary.status === "archived";
  const ticketLabel = formatTicketRef(ticket);

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

  const startDraft = useCallback((next: PlanCommentDraft) => {
    setDraft(next);
    setTab("open");
  }, []);
  const focusThread = useCallback((id: TicketPlanCommentId | null) => {
    setFocus(id === null ? null : { id, reveal: true });
    if (id !== null) setTab("open");
  }, []);
  const selectThread = useCallback((thread: PlanCommentThread) => {
    setFocus({ id: thread.comment.id, reveal: false });
    surfaceRef.current?.scrollToThread(thread);
  }, []);
  const focused = focus !== null;
  useEffect(() => {
    if (!focused) return;
    const unfocus = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setFocus(null);
    };
    window.addEventListener("keydown", unfocus);
    return () => window.removeEventListener("keydown", unfocus);
  }, [focused]);
  const addComment = async (body: string) => {
    const submittedDraft = draft;
    const comment = await actions.addPlanComment(environmentId, {
      planId: summary.planId,
      body,
      ...(draft === null ? {} : { anchor: draft.anchor }),
    });
    if (comment === null) return false;
    setDraft((current) => (current === submittedDraft ? null : current));
    setFocus({ id: comment.id, reveal: true });
    return true;
  };

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

  const deletePlan = async () => {
    if (!(await actions.confirmDeletePlan(summary))) return;
    const discardDraft = doc.reload;
    discardDraft();
    if (await actions.deletePlan(environmentId, summary.planId)) {
      void navigate({ to: "/tickets/$ticketKey", params: { ticketKey } });
    }
  };
  const showEditor = editing !== null && !archived;

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
          <MenuItem disabled={status.changing} onClick={() => void status.setStatus("active")}>
            <ArchiveRestoreIcon aria-hidden />
            Restore
          </MenuItem>
        ) : (
          <MenuItem
            disabled={status.changing || uploading}
            onClick={() => void status.setStatus("archived")}
          >
            <ArchiveIcon aria-hidden />
            Archive
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem variant="destructive" onClick={() => void deletePlan()}>
          <Trash2Icon aria-hidden />
          Delete
        </MenuItem>
      </MenuPopup>
    </Menu>
  );

  const panel = (
    <TicketPlanPanel
      ticketRef={ticketRef}
      plan={summary}
      openThreads={openThreads}
      resolvedThreads={resolvedThreads}
      tab={tab}
      onTabChange={setTab}
      draft={draft}
      onCancelDraft={() => setDraft(null)}
      onComment={addComment}
      focus={focus}
      onSelectThread={selectThread}
      stacked={!sidePanel}
    />
  );

  return (
    <TicketSidePanelLayout
      sidePanel={sidePanel}
      panel={<ScrollArea className="min-h-0 flex-1">{panel}</ScrollArea>}
      storageKey={PANEL_WIDTH_STORAGE_KEY}
      defaultWidth={PANEL_DEFAULT_WIDTH}
      resizeLabel="Resize plan panel"
    >
      <TicketBreadcrumbHeader
        ticket={{ label: ticketLabel, ticketKey }}
        current={`P${summary.number}`}
        copy={summary.ref}
        trailing={
          <div className="flex items-center gap-1.5">
            <TicketStartThreadMenu
              environmentId={environmentId}
              ticket={ticket}
              prefill={() => openPlanPrefill(environmentId, ticket, summary)}
              label="Open in new thread"
              icon={<MessageSquarePlusIcon aria-hidden />}
              variant="outline"
            />
            {archived ? null : (
              <TicketStartThreadMenu
                environmentId={environmentId}
                ticket={ticket}
                prefill={() => revisePlanPrefill(environmentId, summary)}
                label="Ask agent to revise"
                icon={<SparklesIcon aria-hidden />}
                variant="outline"
              />
            )}
            {menu}
          </div>
        }
        reachesWindowEdge={!sidePanel}
      />
      <ScrollArea className="min-h-0 flex-1">
        <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 pt-8 pb-16 lg:px-8">
          <div className="flex flex-col gap-4">
            <TicketTitleInput
              ref={titleRef}
              title={title}
              label="Plan title"
              readOnly={archived}
              disabled={status.changing}
            />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <span>
                Plan for{" "}
                <Link
                  to="/tickets/$ticketKey"
                  params={{ ticketKey }}
                  className="text-foreground hover:underline"
                >
                  {ticketLabel} {ticket.title}
                </Link>
              </span>
              <span>
                By <TicketActorName environmentId={environmentId} actor={summary.createdBy} />
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
                    disabled={status.changing}
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
              <span className="min-w-0 flex-1">This plan is archived. Restore it to edit it.</span>
              <Button
                size="xs"
                variant="outline"
                disabled={status.changing}
                onClick={() => void status.setStatus("active")}
              >
                Restore
              </Button>
            </div>
          ) : null}

          <TicketDocumentEditor
            environmentId={environmentId}
            doc={doc}
            label="Plan"
            editing={showEditor}
            onDone={() => setEditing(null)}
            doneDisabled={status.changing || uploading}
            editor={{
              placeholder:
                "Describe how to implement the ticket. Paste or drop files to attach them.",
              autoFocus: editing === "body",
              disabled: status.changing,
              onUploadingChange: setUploading,
              minHeight: "16rem",
              document: "plan",
            }}
            emptyText="This plan is empty."
          >
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
              <TicketMarkdownBody
                environmentId={environmentId}
                body={doc.state.text}
                attachments={plan.attachments}
                onBodyChange={archived || status.changing ? undefined : doc.edit}
                sourcePositions
              />
            </TicketPlanCommentSurface>
          </TicketDocumentEditor>

          {!sidePanel ? (
            <div className="overflow-hidden rounded-lg border border-border/70">{panel}</div>
          ) : null}
        </article>
      </ScrollArea>
    </TicketSidePanelLayout>
  );
}
