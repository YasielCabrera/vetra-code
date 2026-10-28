import { describe, expect, it } from "vite-plus/test";

import {
  VETRA_MCP_TOOL_NAMES,
  resolveT3McpSummaryAction,
  resolveT3McpToolDefinition,
  resolveT3McpToolPresentation,
} from "./t3McpToolPresentation.ts";

describe("resolveT3McpToolPresentation", () => {
  it("recognizes every Vetra Code tool across provider prefixes and completion suffixes", () => {
    for (const tool of VETRA_MCP_TOOL_NAMES) {
      const presentation = resolveT3McpToolPresentation(tool);
      for (const prefix of [
        "mcp__vetra-code__",
        "mcp__vetra_code__",
        "mcp__vetracode__",
        "Vetra-code.",
        "vetra_code/",
        "vetracode:",
        "mcp_vetra-code_",
        "Vetra Code ",
        "vetra-code · ",
      ]) {
        expect(resolveT3McpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveT3McpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });

  it("pretty prints explicit ticket plan comment reopening", () => {
    expect(resolveT3McpToolPresentation("mcp__vetra-code__t3_ticket_plan_reopen_comment")).toEqual({
      displayName: "Reopen a ticket plan comment",
      logo: "vetra-code",
    });
  });

  it("matches OpenCode 2's per-thread server names, whose thread ids hold underscores", () => {
    expect(
      resolveT3McpToolPresentation("vetra-code-thread_opencode2-adapter_delegate_task")
        ?.displayName,
    ).toBe("Delegate a child task");
    expect(
      resolveT3McpToolPresentation("vetra-code-thread_opencode2-adapter_not_a_tool"),
    ).toBeNull();
  });
});

describe("resolveT3McpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolveT3McpToolDefinition("mcp__vetra-code__preview_act", { action: "type" })?.labels,
    ).toEqual(resolveT3McpToolDefinition("preview_type")?.labels);
    expect(resolveT3McpToolDefinition("t3_thread_transfer", { action: "fork" })?.displayName).toBe(
      resolveT3McpToolDefinition("t3_thread_fork")?.displayName,
    );
    expect(resolveT3McpToolDefinition("preview_act", { action: "unknown" })?.labels[2]).toBe(
      "Used",
    );
  });
});

describe("resolveT3McpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(resolveT3McpSummaryAction("mcp__vetra-code__t3_queue", { action: "list" })).toBe(
      "queue-list",
    );
    expect(resolveT3McpSummaryAction("t3_queue", { action: "edit" })).toBe("queue-edit");
    expect(resolveT3McpSummaryAction("t3_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveT3McpSummaryAction("t3_thread_configure", {})).toBe("thread-configuration");
    expect(resolveT3McpSummaryAction("schedule_task", { scheduledTaskId: "task-1" })).toBe(
      "schedule-update",
    );
    expect(resolveT3McpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
