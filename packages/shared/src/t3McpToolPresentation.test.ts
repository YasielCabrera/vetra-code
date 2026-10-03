import { describe, expect, it } from "vite-plus/test";

import { VETRA_MCP_TOOL_NAMES, resolveT3McpToolPresentation } from "./t3McpToolPresentation.ts";

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
  it("pretty prints Claude and Cursor T3 MCP tool names", () => {
    expect(resolveT3McpToolPresentation("mcp__vetra-code__t3_thread_read")).toEqual({
      displayName: "Read a Vetra Code thread",
      logo: "vetra-code",
    });
  });

  it("pretty prints Codex T3 MCP tool names", () => {
    expect(resolveT3McpToolPresentation("vetra-code.create_threads")).toEqual({
      displayName: "Create Vetra Code threads",
      logo: "vetra-code",
    });
  });

  it("pretty prints thread metadata updates", () => {
    expect(resolveT3McpToolPresentation("mcp__vetra-code__t3_thread_update")).toEqual({
      displayName: "Update Vetra Code thread metadata",
      logo: "vetra-code",
    });
  });

  it("pretty prints bare T3 MCP toolkit names", () => {
    expect(resolveT3McpToolPresentation("list_scheduled_tasks")).toEqual({
      displayName: "List scheduled tasks",
      logo: "vetra-code",
    });
  });

  it("pretty prints worktree T3 MCP tool names", () => {
    expect(resolveT3McpToolPresentation("mcp__vetra-code__t3_worktree_handoff")).toEqual({
      displayName: "Hand off thread to a git worktree",
      logo: "vetra-code",
    });
    expect(resolveT3McpToolPresentation("vetra-code.t3_worktree_status")).toEqual({
      displayName: "Get thread worktree status",
      logo: "vetra-code",
    });
  });

  it("pretty prints preview T3 MCP tool names", () => {
    expect(resolveT3McpToolPresentation("Vetra-code.preview_open")).toEqual({
      displayName: "Open a page in the preview browser",
      logo: "vetra-code",
    });
    expect(resolveT3McpToolPresentation("mcp__vetra-code__preview_status")).toEqual({
      displayName: "Get preview browser status",
      logo: "vetra-code",
    });
  });

  it("matches the separator variants ACP registry agents emit", () => {
    for (const name of [
      "mcp_vetra-code_delegate_task",
      "vetra_code:delegate_task",
      "vetracode/delegate_task",
      "vetra-code delegate_task",
      "Vetra Code delegate_task",
      "vetra-code__delegate_task",
    ]) {
      expect(resolveT3McpToolPresentation(name)?.displayName).toBe("Delegate a child task");
    }
  });

  it("keeps unknown MCP tools on the generic renderer path", () => {
    expect(resolveT3McpToolPresentation("mcp__github__search_issues")).toBeNull();
    expect(resolveT3McpToolPresentation("vetra-code.not_a_real_tool")).toBeNull();
  });
});
