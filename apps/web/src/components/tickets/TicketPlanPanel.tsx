import type { ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import type { TicketPlanId, TicketPlanSummary } from "@t3tools/contracts";
import type { PlanCommentThread } from "@t3tools/shared/ticketPlanAnchors";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useRef } from "react";

import { useTicketActions } from "../../hooks/useTicketActions";
import { useTicketDetail } from "../../state/tickets";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { PLAN_ENTRY_VERBS, TicketActorName } from "./TicketActivityTimeline";
import type { PlanCommentDraft } from "./TicketPlanCommentSurface";
import {
  type PlanCommentFocus,
  TicketPlanCommentList,
  TicketPlanNewComment,
} from "./TicketPlanComments";
import { ticketPlanHistory } from "./ticketPlans.logic";

const PLAN_PANEL_TABS = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "history", label: "History" },
] as const;
export type PlanPanelTab = (typeof PLAN_PANEL_TABS)[number]["value"];

export function TicketPlanPanel(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly plan: TicketPlanSummary;
  readonly openThreads: ReadonlyArray<PlanCommentThread>;
  readonly resolvedThreads: ReadonlyArray<PlanCommentThread>;
  readonly tab: PlanPanelTab;
  readonly onTabChange: (tab: PlanPanelTab) => void;
  /** The passage a new comment is about; null comments on the whole plan. */
  readonly draft: PlanCommentDraft | null;
  readonly onCancelDraft: () => void;
  /** Resolves true once the comment is saved. */
  readonly onComment: (body: string) => Promise<boolean>;
  readonly focus: PlanCommentFocus | null;
  readonly onSelectThread: (thread: PlanCommentThread) => void;
  readonly stacked: boolean;
}) {
  const { ticketRef, plan, tab, draft, stacked } = props;
  const actions = useTicketActions();
  const newCommentRef = useRef<HTMLTextAreaElement>(null);
  const counts: Partial<Record<PlanPanelTab, number>> = {
    open: props.openThreads.length,
    resolved: props.resolvedThreads.length,
  };

  useEffect(() => {
    if (draft !== null) newCommentRef.current?.focus({ preventScroll: stacked });
  }, [draft, stacked]);

  return (
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
            if (nextTab) props.onTabChange(nextTab);
          }}
        >
          {PLAN_PANEL_TABS.map((item) => (
            <Toggle key={item.value} value={item.value}>
              {item.label}
              {counts[item.value] ? (
                <span className="text-muted-foreground tabular-nums">{counts[item.value]}</span>
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
              onCancelDraft={props.onCancelDraft}
              onSubmit={props.onComment}
            />
            <TicketPlanCommentList
              environmentId={ticketRef.environmentId}
              planId={plan.planId}
              revision={plan.revision}
              threads={props.openThreads}
              focus={props.focus}
              onSelect={props.onSelectThread}
              actions={actions}
              empty="No open comments. Select text in the plan to comment on it."
            />
          </>
        ) : tab === "resolved" ? (
          <TicketPlanCommentList
            environmentId={ticketRef.environmentId}
            planId={plan.planId}
            revision={plan.revision}
            threads={props.resolvedThreads}
            focus={props.focus}
            onSelect={props.onSelectThread}
            actions={actions}
            empty="No resolved comments."
          />
        ) : (
          <TicketPlanHistory ticketRef={ticketRef} planId={plan.planId} />
        )}
      </div>
    </div>
  );
}

function TicketPlanHistory(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly planId: TicketPlanId;
}) {
  const { ticketRef, planId } = props;
  const result = useTicketDetail(ticketRef);
  const activity = Option.getOrNull(AsyncResult.value(result))?.activity ?? null;
  const history = useMemo(
    () => (activity === null ? null : ticketPlanHistory(activity, planId)),
    [activity, planId],
  );
  if (history === null) {
    return (
      <p className="text-xs text-muted-foreground">
        {AsyncResult.isFailure(result) ? "History could not be loaded." : "Loading history…"}
      </p>
    );
  }
  if (history.length === 0) {
    return <p className="text-xs text-muted-foreground">No history yet.</p>;
  }
  return (
    <ol aria-label="Plan history" className="m-0 flex list-none flex-col gap-2.5 p-0">
      {history.map((item) => (
        <li key={item.id} className="text-xs leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">
            <TicketActorName environmentId={ticketRef.environmentId} actor={item.actor} />
          </span>{" "}
          {PLAN_ENTRY_VERBS[item.entry.type]} the plan
          {item.entry.type === "plan_review_status_changed"
            ? ` ${item.entry.to === "ready" ? "Ready" : "Draft"}`
            : null}
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
