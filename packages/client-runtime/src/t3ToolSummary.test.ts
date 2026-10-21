import { describe, expect, it } from "vite-plus/test";

import { summarizeT3ToolCalls, type T3ToolSummaryCall } from "./t3ToolSummary.ts";

function completed(input: unknown, output?: unknown): T3ToolSummaryCall {
  return { input, output, outcome: "completed" };
}

describe("summarizeT3ToolCalls", () => {
  it("counts distinct tickets whether the result is a detail or a summary", () => {
    expect(
      summarizeT3ToolCalls("ticket-read", [
        completed({ ticket: "T-1" }, { summary: { id: "ticket-1" } }),
        completed({ ticket: "T-1" }, { summary: { id: "ticket-1" } }),
        completed({ ticket: "T-2" }, { summary: { id: "ticket-2" } }),
      ]).label,
    ).toBe("Read 2 tickets");
    expect(
      summarizeT3ToolCalls("ticket-update", [
        completed({ ticket: "T-1" }, { id: "ticket-1" }),
        completed({ ticket: "T-1" }, { id: "ticket-1" }),
      ]).label,
    ).toBe("Updated 1 ticket");
  });

  it("counts distinct plans whether the result nests the plan or is its summary", () => {
    expect(
      summarizeT3ToolCalls("ticket-plan-read", [
        completed({ plan: "T-1/P1" }, { plan: { planId: "plan-1" } }),
        completed({ plan: "T-1/P1" }, { plan: { planId: "plan-1" } }),
        completed({ plan: "T-1/P2" }, { plan: { planId: "plan-2" } }),
      ]).label,
    ).toBe("Read 2 ticket plans");
    expect(
      summarizeT3ToolCalls("ticket-plan-update", [
        completed({ plan: "T-1/P1" }, { planId: "plan-1" }),
        completed({ plan: "plan-1" }, { planId: "plan-1" }),
      ]).label,
    ).toBe("Updated 1 ticket plan");
  });

  it("reads provider result envelopes without treating JSON in the message as result data", () => {
    const result = { messageId: "message-1", threadId: "actual-thread" };
    const json = JSON.stringify(result);
    const outputs = [
      result,
      { structuredContent: result },
      [{ type: "text", text: json }],
      { content: [{ text: { text: json } }], isError: false },
      json,
    ];
    const calls = outputs.map((output) =>
      completed(
        {
          toolName: "t3_thread_send",
          args: { threadId: "input-thread", message: '{"threadId":"fake"}' },
        },
        output,
      ),
    );
    expect(summarizeT3ToolCalls("thread-send", calls).label).toBe("Sent 1 message to 1 thread");
    expect(
      summarizeT3ToolCalls("thread-send", [
        completed({ toolName: "t3_thread_send", args: { threadId: "input-thread" } }),
        completed({ threadId: "input-thread" }),
      ]).label,
    ).toBe("Sent 2 messages to 1 thread");
  });

  it("excludes failed and unfinished sends even if the provider reports completed", () => {
    const calls: T3ToolSummaryCall[] = [
      completed({ threadId: "success" }, { messageId: "ok", threadId: "success" }),
      completed(
        { threadId: "failed" },
        { isError: true, structuredContent: { threadId: "failed" } },
      ),
      completed({ threadId: "failed" }, [
        { type: "text", text: JSON.stringify({ _tag: "OrchestratorMcpFailure" }) },
      ]),
      { input: { threadId: "cancelled" }, output: undefined, outcome: "unfinished" },
    ];
    expect(summarizeT3ToolCalls("thread-send", calls)).toEqual({
      label: "Sent 1 message to 1 thread",
      failedCount: 2,
    });
    expect(summarizeT3ToolCalls("thread-send", [calls[1]!])).toEqual({
      label: "Tried to send 1 message to 1 thread",
      failedCount: 1,
    });
  });

  it("does not confuse a child's failure or wait timeout with failure of the orchestration call", () => {
    const failedChild = { taskId: "task-1", status: "failed", summary: "command not found" };
    expect(
      summarizeT3ToolCalls("delegate", [completed({}, failedChild), completed({}, failedChild)]),
    ).toEqual({
      label: "Delegated 1 task",
      failedCount: 0,
    });
    expect(
      summarizeT3ToolCalls(
        "task-status",
        Array.from({ length: 4 }, () => completed({ taskId: "task-1" }, failedChild)),
      ).label,
    ).toBe("Checked task status 4 times");
    expect(
      summarizeT3ToolCalls("thread-wait", [
        completed({ threadId: "thread-1" }, { threadId: "thread-1", timedOut: true }),
      ]),
    ).toEqual({
      label: "Waited on 1 thread",
      failedCount: 0,
    });
  });
});
