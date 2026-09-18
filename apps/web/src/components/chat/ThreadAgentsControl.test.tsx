import type {
  AgentControlState,
  RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { AgentPopoverRow, ThreadAgentsControl } from "./ThreadAgentsControl";

function agent(overrides: Partial<RuntimeSubagent> & { id: string }): RuntimeSubagent {
  return {
    kind: "subagent",
    title: overrides.id,
    role: null,
    model: null,
    effort: null,
    status: "running",
    activationCount: 1,
    usage: null,
    progress: null,
    lastToolName: null,
    result: null,
    error: null,
    outputFile: null,
    parentAgentId: null,
    agentIndex: null,
    phaseIndex: null,
    phaseTitle: null,
    attempt: null,
    workflowName: null,
    phases: [],
    runHandles: null,
    recentActivity: [],
    firstSeenAt: "2026-08-01T10:00:00.000Z",
    startedAt: "2026-08-01T10:00:00.000Z",
    completedAt: null,
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

const IN_PROGRESS: AgentControlState = {
  settled: 2,
  total: 5,
  allSettled: false,
  liveCount: 3,
  groups: [
    {
      workflow: agent({
        id: "wf-1",
        kind: "workflow",
        title: "coordinator",
        workflowName: "review-changes",
      }),
      settled: 2,
      agents: [
        agent({ id: "a-1", title: "Inspect code", status: "completed" }),
        agent({ id: "a-2", title: "Write tests", status: "completed" }),
        agent({ id: "a-3", title: "Open a PR", progress: "reading diff" }),
      ],
    },
    {
      workflow: null,
      settled: 0,
      agents: [
        agent({ id: "d-1", title: "Marlow", role: "explorer" }),
        agent({ id: "d-2", title: "Kurtz", status: "failed", error: "timed out" }),
      ],
    },
  ],
};

const ALL_SETTLED: AgentControlState = {
  settled: 2,
  total: 2,
  allSettled: true,
  liveCount: 0,
  groups: [
    {
      workflow: null,
      settled: 2,
      agents: [
        agent({ id: "d-1", title: "Inspect code", status: "completed" }),
        agent({ id: "d-2", title: "Write tests", status: "completed" }),
      ],
    },
  ],
};

function buttonTag(html: string, ariaLabel: string) {
  return html.match(new RegExp(`<button[^>]*aria-label="${ariaLabel}"[^>]*>`))?.[0];
}

describe("ThreadAgentsControl", () => {
  it("wraps the full agent title instead of truncating it", () => {
    const title = "Explore portal/company-discovery and document every integration boundary";
    const html = renderToStaticMarkup(
      <AgentPopoverRow agent={agent({ id: "long-title", title, role: "Explore" })} />,
    );
    const titleTag = html.match(new RegExp(`<span class="([^"]*)">${title}</span>`));

    expect(titleTag).toBeDefined();
    expect(titleTag?.[1]).toContain("whitespace-normal");
    expect(titleTag?.[1]).toContain("wrap-anywhere");
    expect(titleTag?.[1]).not.toContain("truncate");
  });

  it("shows settled of total on an unfinished roster", () => {
    const html = renderToStaticMarkup(
      <ThreadAgentsControl state={IN_PROGRESS} onOpenAgents={() => {}} />,
    );

    expect(buttonTag(html, "Agents 2 of 5")).toBeDefined();
    expect(html).toContain("data-thread-agents-control");
    expect(html).toContain("2/5");
  });

  it("marks a fully settled roster without hiding the count", () => {
    const html = renderToStaticMarkup(
      <ThreadAgentsControl state={ALL_SETTLED} onOpenAgents={() => {}} />,
    );

    expect(buttonTag(html, "All agents finished")).toBeDefined();
    expect(html).toContain("2/2");
    expect(html).toContain("text-success");
  });
});
