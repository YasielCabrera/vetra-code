/**
 * Header Agents chip: a robot icon plus settled/total, expanding to the roster
 * the Agents panel owns. The fraction counts exactly the rows below it, so a
 * workflow coordinator reads as a group header rather than an agent.
 */
import type {
  AgentControlGroup,
  AgentControlState,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { agentControlAriaLabel } from "@t3tools/client-runtime/state/subagentRuntime";
import { Bot } from "lucide-react";
import { memo, useState } from "react";

import {
  AgentElapsed,
  agentActivityText,
  STATUS_VISUALS,
  StatusDot,
} from "~/components/agentStatusPresentation";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Full identity on top (wrapping when needed), current activity beneath. */
export function AgentPopoverRow({ agent }: { agent: RuntimeSubagent }) {
  const visuals = STATUS_VISUALS[agent.status];
  const activity = agentActivityText(agent);
  const role =
    agent.role?.trim().toLocaleLowerCase() === agent.title.trim().toLocaleLowerCase()
      ? null
      : agent.role;

  return (
    <li className="rounded-md px-1.5 py-1">
      <div className="flex items-start gap-2">
        <span className="flex h-5 shrink-0 items-center">
          <StatusDot status={agent.status} />
        </span>
        <span className="min-w-0 flex-1 whitespace-normal text-[12px] font-medium leading-5 wrap-anywhere">
          {agent.title}
        </span>
        {role ? (
          <span className="mt-0.5 max-w-24 shrink-0 truncate rounded-sm border border-border/60 px-1 font-mono text-[.6rem] text-muted-foreground">
            {role}
          </span>
        ) : null}
        <span className="flex h-5 shrink-0 items-center font-mono text-[.65rem] text-muted-foreground/80">
          <AgentElapsed agent={agent} />
        </span>
      </div>
      <div
        className={cn(
          "truncate pl-3.5 text-[11px] leading-4",
          agent.status === "failed" ? "text-destructive-foreground" : "text-muted-foreground",
        )}
      >
        {activity ?? visuals.label}
      </div>
      <span className="sr-only">{visuals.label}</span>
    </li>
  );
}

function AgentGroupSection({ group }: { group: AgentControlGroup }) {
  return (
    <li>
      <div className="flex items-center gap-1.5 px-1.5 pt-1.5 text-[.65rem] font-medium uppercase tracking-wider text-muted-foreground">
        {group.workflow ? (
          <>
            <StatusDot status={group.workflow.status} />
            <span className="min-w-0 truncate">
              {group.workflow.workflowName ?? group.workflow.title}
            </span>
            <span className="ml-auto shrink-0 font-mono normal-case tabular-nums text-muted-foreground/80">
              {group.settled}/{group.agents.length}
            </span>
          </>
        ) : (
          <span>Direct spawns</span>
        )}
      </div>
      <ul className={cn("space-y-px", group.workflow ? "pl-1.5" : null)}>
        {group.agents.map((agent) => (
          <AgentPopoverRow key={agent.id} agent={agent} />
        ))}
      </ul>
    </li>
  );
}

export const ThreadAgentsControl = memo(function ThreadAgentsControl({
  state,
  onOpenAgents,
}: {
  state: AgentControlState;
  onOpenAgents: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ariaLabel = agentControlAriaLabel(state);
  const workingLabel =
    state.liveCount > 0
      ? `${state.liveCount} ${state.liveCount === 1 ? "agent" : "agents"} working`
      : null;

  return (
    <Popover onOpenChange={(nextOpen) => setOpen(nextOpen)}>
      <Tooltip disabled={open}>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  aria-label={ariaLabel}
                  data-toolbar-control=""
                  data-thread-agents-control=""
                />
              }
            />
          }
        >
          <Bot
            aria-hidden
            className={cn("size-3.5", state.liveCount > 0 ? "text-info-foreground" : null)}
          />
          <span className={cn("tabular-nums", state.allSettled ? "text-success" : null)}>
            {state.settled}/{state.total}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="top">
          {workingLabel ? `${ariaLabel} · ${workingLabel}` : ariaLabel}
        </TooltipPopup>
      </Tooltip>
      <PopoverPopup
        align="end"
        side="bottom"
        sideOffset={6}
        className="min-w-64 max-w-80"
        padding="compact"
      >
        <div className="flex items-baseline gap-2 px-1.5 pb-1.5">
          <PopoverTitle className="sr-only">Agents</PopoverTitle>
          <span aria-hidden className="text-xs font-medium text-muted-foreground">
            Agents
          </span>
          <span className="ml-auto shrink-0 font-mono text-[.65rem] tabular-nums text-muted-foreground/80">
            {workingLabel ? (
              <span className="text-info-foreground">{state.liveCount} working</span>
            ) : null}
            {workingLabel && state.settled > 0 ? " · " : null}
            {state.settled > 0 ? `${state.settled} settled` : null}
          </span>
        </div>
        <ul className="max-h-80 space-y-px overflow-y-auto">
          {state.groups.map((group, index) => (
            <AgentGroupSection key={group.workflow?.id ?? `direct-${index}`} group={group} />
          ))}
        </ul>
        <div className="mt-1.5 border-t border-border/60 pt-1.5">
          {/* Base UI runs external handlers before its own, so the panel opens
              and then the popover closes. */}
          <PopoverClose
            onClick={onOpenAgents}
            render={<Button variant="ghost" size="sm" className="w-full justify-start" />}
          >
            <Bot aria-hidden className="size-3.5" />
            Open agents panel
          </PopoverClose>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
