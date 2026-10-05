import { Link, useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import type {
  TicketActor,
  TicketPlanId,
  TicketPlanSummary,
  TicketSummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  ArrowLeftIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClipboardListIcon,
  MessageSquareIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { useTicketActions } from "../../hooks/useTicketActions";
import { cn } from "../../lib/utils";
import { useTicketPlan } from "../../state/tickets";
import { buildThreadRouteParams } from "../../threadRoutes";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { TicketActorName } from "./TicketActivityTimeline";
import { askForPlanPrefill, openPlanPrefill } from "./ticketContextRecord";
import { TicketMarkdownBody } from "./TicketMarkdownBody";
import { partitionTicketPlans, ticketPlanRouteParams } from "./ticketPlans.logic";
import { TicketStartThreadMenu } from "./TicketStartThreadMenu";

const NEW_PLAN_TITLE = "Untitled plan";

function openCommentsLabel(count: number): string {
  return count === 0
    ? "No open comments"
    : count === 1
      ? "1 open comment"
      : `${count} open comments`;
}

/** The ticket page's list of plans, without their bodies; a row opens its preview. */
export const TicketPlansSection = memo(function TicketPlansSection(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly ticket: TicketSummary;
  readonly previewPlanId: TicketPlanId | null;
  readonly onPreview: (planId: TicketPlanId) => void;
}) {
  const { ticketRef, ticket } = props;
  const { plans } = ticket;
  const navigate = useNavigate();
  const { createPlan } = useTicketActions();
  const { active, archived } = useMemo(() => partitionTicketPlans(plans), [plans]);
  const [showArchived, setShowArchived] = useState(false);
  // A created plan opens once the ticket's stream lists it, so its page never shows it missing.
  const [newPlan, setNewPlan] = useState<"creating" | { readonly number: number } | null>(null);

  const openNumber =
    newPlan !== null &&
    newPlan !== "creating" &&
    plans.some((plan) => plan.number === newPlan.number)
      ? newPlan.number
      : null;
  useEffect(() => {
    if (openNumber === null) return;
    void navigate({
      to: "/tickets/$ticketKey/plans/$planNumber",
      params: ticketPlanRouteParams(ticketRef, openNumber),
      search: { edit: true },
    });
  }, [navigate, openNumber, ticketRef]);

  const create = async () => {
    setNewPlan("creating");
    const result = await createPlan(ticketRef.environmentId, {
      ticketId: ticketRef.ticketId,
      title: NEW_PLAN_TITLE,
    });
    setNewPlan(result === null ? null : { number: result.plan.number });
  };

  const row = (plan: TicketPlanSummary) => (
    <TicketPlanRow
      key={plan.planId}
      ticketRef={ticketRef}
      ticket={ticket}
      plan={plan}
      selected={plan.planId === props.previewPlanId}
      onPreview={props.onPreview}
    />
  );

  return (
    <section aria-label="Plans" className="flex flex-col gap-3 border-t border-border/60 pt-6">
      <div className="flex items-center gap-2">
        <ClipboardListIcon aria-hidden className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Plans</h2>
        <div className="ms-auto flex items-center gap-1">
          <TicketStartThreadMenu
            environmentId={ticketRef.environmentId}
            ticket={ticket}
            prefill={() => askForPlanPrefill(ticketRef.environmentId, ticket)}
            label="Ask agent to plan"
            icon={<SparklesIcon aria-hidden />}
            variant="ghost"
          />
          <Button
            size="xs"
            variant="ghost"
            disabled={newPlan !== null}
            onClick={() => void create()}
          >
            <PlusIcon aria-hidden />
            {newPlan === null ? "New plan" : "Creating…"}
          </Button>
        </div>
      </div>
      {plans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No plans yet. A plan describes how to implement this ticket.
        </p>
      ) : null}
      {active.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0">{active.map(row)}</ul>
      ) : null}
      {archived.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div>
            <Button
              size="xs"
              variant="ghost-muted"
              aria-expanded={showArchived}
              onClick={() => setShowArchived((value) => !value)}
            >
              {showArchived ? <ChevronDownIcon aria-hidden /> : <ChevronRightIcon aria-hidden />}
              {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
            </Button>
          </div>
          {showArchived ? (
            <ul aria-label="Archived plans" className="m-0 flex list-none flex-col p-0">
              {archived.map(row)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
});

function TicketPlanRow(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly ticket: TicketSummary;
  readonly plan: TicketPlanSummary;
  readonly selected: boolean;
  readonly onPreview: (planId: TicketPlanId) => void;
}) {
  const { ticketRef, plan } = props;
  return (
    <li
      className={cn(
        "group flex min-w-0 items-center gap-3 rounded-md pe-2 hover:bg-accent/40",
        props.selected && "bg-accent/60 hover:bg-accent/60",
      )}
    >
      <button
        type="button"
        aria-pressed={props.selected}
        aria-label={`Preview ${plan.ref}, ${plan.title}`}
        onClick={() => props.onPreview(plan.planId)}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1.5 text-start text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring",
          plan.status === "archived" && "text-muted-foreground",
        )}
      >
        <span className="shrink-0 font-mono text-xs text-muted-foreground">P{plan.number}</span>
        <span className="min-w-0 flex-1 truncate">{plan.title}</span>
        <Badge variant={plan.reviewStatus === "ready" ? "success" : "warning"}>
          {plan.reviewStatus === "ready" ? "Ready" : "Draft"}
        </Badge>
        {plan.openCommentCount > 0 ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground tabular-nums"
            aria-label={openCommentsLabel(plan.openCommentCount)}
          >
            <MessageSquareIcon aria-hidden className="size-3" />
            {plan.openCommentCount}
          </span>
        ) : null}
      </button>
      <TicketPlanAuthor ticketRef={ticketRef} actor={plan.createdBy} />
      <span className="flex shrink-0 opacity-0 transition-opacity pointer-coarse:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 has-data-popup-open:opacity-100 motion-reduce:transition-none">
        <TicketStartThreadMenu
          environmentId={ticketRef.environmentId}
          ticket={props.ticket}
          prefill={() => openPlanPrefill(ticketRef.environmentId, props.ticket, plan)}
          label={`Open ${plan.ref} in new thread`}
          icon={<MessageSquarePlusIcon aria-hidden />}
          variant="ghost"
          iconOnly
        />
      </span>
    </li>
  );
}

/** Who wrote the plan; an agent links to its thread. */
function TicketPlanAuthor(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly actor: TicketActor;
}) {
  const { actor } = props;
  const name = <TicketActorName environmentId={props.ticketRef.environmentId} actor={actor} />;
  if (actor.type !== "agent") {
    return <span className="max-w-48 shrink-0 truncate text-xs text-muted-foreground">{name}</span>;
  }
  return (
    <Link
      to="/$environmentId/$threadId"
      params={buildThreadRouteParams(scopeThreadRef(props.ticketRef.environmentId, actor.threadId))}
      className="inline-flex max-w-48 min-w-0 shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
    >
      <BotIcon aria-hidden className="size-3 shrink-0" />
      <span className="truncate">{name}</span>
    </Link>
  );
}

/** One plan, read-only, in the ticket page's side panel. */
export function TicketPlanPreview(props: {
  readonly ticketRef: ScopedTicketRef;
  readonly ticket: TicketSummary;
  readonly plan: TicketPlanSummary;
  readonly stacked: boolean;
  readonly onBack: () => void;
}) {
  const { ticketRef, plan: summary } = props;
  const navigate = useNavigate();
  const result = useTicketPlan({ environmentId: ticketRef.environmentId, planId: summary.planId });
  const plan = Option.getOrNull(AsyncResult.value(result));
  const content = (
    <div className="flex flex-col gap-4 px-5 pt-5 pb-8">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold break-words text-foreground">
          <span className="me-2 font-mono text-muted-foreground">P{summary.number}</span>
          {summary.title}
        </h3>
        <p className="text-xs text-muted-foreground">
          <Badge variant={summary.reviewStatus === "ready" ? "success" : "warning"}>
            {summary.reviewStatus === "ready" ? "Ready" : "Draft"}
          </Badge>{" "}
          · {summary.status === "archived" ? "Archived · " : null}
          {openCommentsLabel(summary.openCommentCount)} · Updated{" "}
          {formatRelativeTimeLabel(summary.updatedAt)}
        </p>
      </div>
      {plan === null ? (
        <p className="text-sm text-muted-foreground">
          {AsyncResult.isFailure(result) ? "This plan could not be loaded." : "Loading plan…"}
        </p>
      ) : plan.body.trim().length === 0 ? (
        <p className="text-sm text-muted-foreground">This plan is empty.</p>
      ) : (
        <div className="min-w-0 text-sm">
          <TicketMarkdownBody
            environmentId={ticketRef.environmentId}
            body={plan.body}
            attachments={plan.attachments}
          />
        </div>
      )}
    </div>
  );
  return (
    <div className={cn("flex min-h-0 flex-col", !props.stacked && "flex-1")}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2">
        <Button size="xs" variant="ghost-muted" onClick={props.onBack}>
          <ArrowLeftIcon aria-hidden />
          Properties
        </Button>
        <span className="min-w-0 truncate text-xs text-muted-foreground">Plan preview</span>
        <div className="ms-auto flex items-center gap-1.5">
          <TicketStartThreadMenu
            environmentId={ticketRef.environmentId}
            ticket={props.ticket}
            prefill={() => openPlanPrefill(ticketRef.environmentId, props.ticket, summary)}
            label="Open in new thread"
            icon={<MessageSquarePlusIcon aria-hidden />}
            variant="outline"
          />
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              void navigate({
                to: "/tickets/$ticketKey/plans/$planNumber",
                params: ticketPlanRouteParams(ticketRef, summary.number),
              })
            }
          >
            Open
          </Button>
        </div>
      </div>
      {props.stacked ? content : <ScrollArea className="min-h-0 flex-1">{content}</ScrollArea>}
    </div>
  );
}
