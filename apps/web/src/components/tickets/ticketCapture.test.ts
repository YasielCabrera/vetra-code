import {
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  type ReviewCommentContextRecord,
  type ThreadContextRecord,
  type TicketSummary,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  draftOutcome,
  ticketCaptureMarkdown,
  ticketCaptureSelection,
  type TicketCaptureItem,
  type TicketDraftAnalyzer,
} from "./ticketCapture";

const ENVIRONMENT_ID = EnvironmentId.make("env-1");
const THREAD_ID = ThreadId.make("thread-1");

const quote: TicketCaptureItem = {
  type: "quote",
  citation: {
    version: 1,
    environmentId: ENVIRONMENT_ID,
    threadId: THREAD_ID,
    messageId: MessageId.make("message-1"),
    text: "The cart total is NaN\nwhen it is empty.",
    start: 4,
    end: 42,
    prefix: "",
    suffix: "",
  },
};

const reviewRecord: ReviewCommentContextRecord = {
  version: 1,
  kind: "review-comment",
  contextId: ComposerContextId.make("review-comment_file-comment-1"),
  label: "cart.ts L3 to L4",
  sectionId: "file:src/cart.ts",
  sectionTitle: "File comment",
  filePath: "src/cart.ts",
  startIndex: 2,
  endIndex: 3,
  rangeLabel: "L3 to L4",
  text: "Divides by zero",
  diff: "const average = total / items.length;\nreturn average;",
  fenceLanguage: "ts",
};

const threadRecord: ThreadContextRecord = {
  version: 1,
  kind: "thread",
  contextId: ComposerContextId.make("thread_thread-1"),
  label: "Checkout bugs",
  environmentId: ENVIRONMENT_ID,
  threadId: THREAD_ID,
  title: "Checkout bugs",
};

describe("ticketCaptureSelection", () => {
  it("carries files and records as inline references with their records", () => {
    expect(
      ticketCaptureSelection([
        { type: "file", path: "src/cart.ts" },
        { type: "context", record: reviewRecord },
        { type: "context", record: threadRecord },
      ]),
    ).toEqual({
      text: [
        "[cart.ts](src/cart.ts)",
        "[cart.ts L3 to L4](vetra-context://v1/review-comment/review-comment_file-comment-1)",
        "[Checkout bugs](vetra-context://v1/thread/thread_thread-1)",
      ].join("\n\n"),
      context: { version: 1, records: [reviewRecord, threadRecord] },
    });
  });

  it("sends a quote as its citation link with no context records", () => {
    const selection = ticketCaptureSelection([quote]);
    expect(selection.context).toBeUndefined();
    expect(selection.text).toMatch(
      /^\[[^\]]+\]\(vetra-citation:\/\/v1\/env-1\/thread-1\/message-1\?text=The\+cart\+total/,
    );
  });
});

describe("ticketCaptureMarkdown", () => {
  it("writes quotes as blockquotes and code ranges as fenced blocks, leaving threads to links", () => {
    expect(
      ticketCaptureMarkdown([
        quote,
        { type: "context", record: reviewRecord },
        { type: "context", record: threadRecord },
        { type: "file", path: "src/total.ts" },
      ]),
    ).toBe(
      [
        "> The cart total is NaN\n> when it is empty.",
        "`src/cart.ts` L3 to L4",
        "```ts\nconst average = total / items.length;\nreturn average;\n```",
        "Divides by zero",
        "`src/total.ts`",
      ].join("\n\n"),
    );
  });
});

describe("draftOutcome", () => {
  const filed: Pick<TicketSummary, "title" | "createdBy"> = {
    title: "Cart total is NaN",
    createdBy: { type: "agent", threadId: THREAD_ID },
  };
  const byHand: Pick<TicketSummary, "title" | "createdBy"> = {
    title: "Written by hand",
    createdBy: { type: "user" },
  };
  const RUN_ID = RunId.make("run-1");
  const running = {
    type: "present",
    shell: {
      latestRun: {
        runId: RUN_ID,
        status: "running",
        requestedAt: "2026-10-01T00:00:00.000Z",
        startedAt: "2026-10-01T00:00:01.000Z",
        completedAt: null,
        assistantMessageId: null,
      },
      runtime: {
        status: "running",
        activeRunId: RUN_ID,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: null,
        lastError: null,
        updatedAt: "2026-10-01T00:00:01.000Z",
      },
    },
  } satisfies TicketDraftAnalyzer;
  const completed = {
    type: "present",
    shell: {
      latestRun: {
        runId: RUN_ID,
        status: "completed",
        requestedAt: "2026-10-01T00:00:00.000Z",
        startedAt: "2026-10-01T00:00:01.000Z",
        completedAt: "2026-10-01T00:01:00.000Z",
        assistantMessageId: null,
      },
      runtime: {
        status: "idle",
        activeRunId: null,
        providerInstanceId: ProviderInstanceId.make("codex"),
        providerName: null,
        lastError: null,
        updatedAt: "2026-10-01T00:01:00.000Z",
      },
    },
  } satisfies TicketDraftAnalyzer;

  it("waits for an unloaded shell or an analyzer still working", () => {
    expect(draftOutcome([byHand], THREAD_ID, { type: "loading" })).toBeNull();
    expect(draftOutcome([byHand], THREAD_ID, running)).toBeNull();
    expect(draftOutcome([byHand], THREAD_ID, running, [])).toBeNull();
    expect(
      draftOutcome([byHand], THREAD_ID, {
        type: "present",
        shell: { latestRun: null, runtime: null },
      }),
    ).toBeNull();
  });

  it("reports the ticket the analyzer filed, even before its turn ends", () => {
    expect(draftOutcome([byHand, filed], THREAD_ID, running)).toEqual({
      type: "filed",
      ticket: filed,
    });
  });

  it("requests authoritative confirmation when the shell settles before the ticket delta", () => {
    expect(draftOutcome([byHand], THREAD_ID, completed)).toEqual({
      type: "confirming",
      runId: "run-1",
    });
    expect(draftOutcome([byHand], THREAD_ID, completed, [filed])).toEqual({
      type: "filed",
      ticket: filed,
    });
    expect(draftOutcome([byHand, filed], THREAD_ID, completed)).toEqual({
      type: "filed",
      ticket: filed,
    });
  });

  it("reports no ticket only after a fresh snapshot confirms absence", () => {
    expect(draftOutcome([byHand], THREAD_ID, completed, [])).toEqual({
      type: "abandoned",
    });
    expect(draftOutcome([byHand], ThreadId.make("thread-2"), completed, [filed])).toEqual({
      type: "abandoned",
    });
  });

  it("waits until runtime releases the run, even after the completed shell arrives", () => {
    expect(
      draftOutcome(
        [],
        THREAD_ID,
        {
          type: "present",
          shell: { latestRun: completed.shell.latestRun, runtime: running.shell.runtime },
        },
        [],
      ),
    ).toBeNull();
  });

  it("stops watching a removed analyzer or environment instead of waiting for its shell", () => {
    expect(draftOutcome([], THREAD_ID, { type: "removed" })).toEqual({
      type: "removed",
    });
    expect(draftOutcome([filed], THREAD_ID, { type: "removed" })).toEqual({
      type: "removed",
    });
  });
});
