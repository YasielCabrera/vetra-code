import {
  ComposerContextId,
  EnvironmentId,
  ThreadId,
  TicketId,
  TicketPlanId,
  type TicketContextRecord,
  type TicketPlanContextRecord,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { formatInlineContextReference } from "./lib/composerContextReferences";
import { threadContextReference } from "./lib/composerContextRecords";
import { threadContextRecord } from "@t3tools/shared/composerContextReferences";

import {
  buildPendingUserInputAnswers,
  carryDisplacedCustomAnswerIntoPrompt,
  derivePendingUserInputProgress,
  projectPendingUserInputAnswer,
  resolvePendingUserInputAnswer,
  setPendingUserInputCustomAnswer,
  threadContextsReferencedByAnswer,
  togglePendingUserInputOptionSelection,
} from "./pendingUserInput";

describe("projectPendingUserInputAnswer", () => {
  const record = threadContextRecord(
    {
      environmentId: EnvironmentId.make("env-answer"),
      threadId: ThreadId.make("reference-thread"),
    },
    "Reference work",
  );

  it("sends thread chips as readable links with the actual thread ID", () => {
    const answer = `Compare ${formatInlineContextReference(threadContextReference(record))}`;
    expect(projectPendingUserInputAnswer(answer, [record])).toBe(
      "Compare [Reference work](vetra-thread://v2/env-answer/reference-thread)",
    );
  });

  // regression: #18789 answers to pending questions lost exact text and option values
  it("preserves option values and exact answer text", () => {
    const options = [" first\t", "second"];
    expect(projectPendingUserInputAnswer(options, [record])).toBe(options);
    expect(projectPendingUserInputAnswer("  Edited answer\n", [record])).toBe("  Edited answer\n");
  });

  it("carries ticket and plan references alongside a thread link", () => {
    const ticket = {
      version: 1,
      kind: "ticket",
      contextId: ComposerContextId.make("ticket_answer"),
      label: "T-42 Login loop",
      environmentId: record.environmentId,
      ticketId: TicketId.make("ticket-answer"),
      ref: "T-42",
      title: "Login loop",
      links: [],
    } satisfies TicketContextRecord;
    const plan = {
      version: 1,
      kind: "ticket-plan",
      contextId: ComposerContextId.make("plan_answer"),
      label: "T-42/P1 Repair login",
      environmentId: record.environmentId,
      ticketId: ticket.ticketId,
      planId: TicketPlanId.make("plan-answer"),
      ref: "T-42/P1",
      title: "Repair login",
      revision: 1,
      reviewStatus: "draft",
      openCommentCount: 0,
    } satisfies TicketPlanContextRecord;
    const answer = [record, ticket, plan]
      .map((context) => formatInlineContextReference(threadContextReference(context)))
      .join(" ");
    const projected = projectPendingUserInputAnswer(answer, [record, ticket, plan]);

    expect(projected).toContain("[Reference work](vetra-thread://v2/env-answer/reference-thread)");
    expect(projected).toContain("ticket: T-42\nticketId: ticket-answer\ntitle: Login loop");
    expect(projected).toContain('t3_ticket_get(ticket="ticket-answer")');
    expect(projected).toContain("plan: T-42/P1\nplanId: plan-answer\nticket: T-42");
    expect(projected).toContain('t3_ticket_plan_get(plan="plan-answer")');
    expect(projected).not.toContain("vetra-context://");
  });
});

describe("threadContextsReferencedByAnswer", () => {
  const kept = threadContextRecord(
    { environmentId: EnvironmentId.make("env-answer"), threadId: ThreadId.make("kept-thread") },
    "Kept work",
  );
  const deleted = threadContextRecord(
    { environmentId: EnvironmentId.make("env-answer"), threadId: ThreadId.make("deleted-thread") },
    "Deleted work",
  );

  it("preserves remaining chips without restoring deleted thread records", () => {
    const answer = `Compare ${formatInlineContextReference(threadContextReference(kept))}`;
    expect(threadContextsReferencedByAnswer(answer, [deleted, kept])).toEqual([kept]);
  });
});

const singleSelectQuestion = {
  id: "scope",
  header: "Scope",
  question: "What should the plan target first?",
  options: [
    {
      label: "Orchestration-first",
      description: "Focus on orchestration first",
    },
  ],
  multiSelect: false,
} as const;

const nativeChoiceQuestion = {
  id: "result",
  header: "Result",
  question: "Which result should be used?",
  options: [
    { value: " first\t", label: "Result", description: "First result" },
    { value: "second", label: "Result", description: "Second result" },
  ],
  allowCustomAnswer: false,
  multiSelect: false,
} as const;

describe("resolvePendingUserInputAnswer", () => {
  it("preserves exact editor text, including a deliberately cleared answer", () => {
    const question = { ...singleSelectQuestion, initialAnswer: "  Proposed message\n" };
    expect(resolvePendingUserInputAnswer(question, { customAnswer: question.initialAnswer })).toBe(
      question.initialAnswer,
    );
    expect(resolvePendingUserInputAnswer(question, { customAnswer: "  Edited message\n\n" })).toBe(
      "  Edited message\n\n",
    );
    expect(resolvePendingUserInputAnswer(question, { customAnswer: "" })).toBe("");
    expect(resolvePendingUserInputAnswer(question, { customAnswer: " \n" })).toBe(" \n");
    expect(
      setPendingUserInputCustomAnswer(
        { selectedOptionValues: ["Orchestration-first"] },
        "",
        question,
      ),
    ).toEqual({ customAnswer: "" });
    const drafts = { scope: { customAnswer: "" } };
    expect(derivePendingUserInputProgress([question], drafts, 0)).toMatchObject({
      customAnswer: "",
      resolvedAnswer: "",
      canAdvance: true,
      isComplete: true,
    });
  });

  it("prefers a custom answer over selected options", () => {
    expect(
      resolvePendingUserInputAnswer(singleSelectQuestion, {
        selectedOptionValues: ["Orchestration-first"],
        customAnswer: "Keep the existing envelope for one release",
      }),
    ).toBe("Keep the existing envelope for one release");
  });

  it("does not replace a required choice with a custom answer", () => {
    expect(
      resolvePendingUserInputAnswer(nativeChoiceQuestion, {
        selectedOptionValues: ["second"],
        customAnswer: "Use another result",
      }),
    ).toBe("second");
  });

  it("does not submit labels or unknown values when an option has a value", () => {
    expect(
      resolvePendingUserInputAnswer(nativeChoiceQuestion, {
        selectedOptionValues: ["Result", "unknown"],
      }),
    ).toBeNull();
  });
});

describe("togglePendingUserInputOptionSelection", () => {
  it("selects and removes options with the same label independently", () => {
    const question = { ...nativeChoiceQuestion, multiSelect: true };
    const firstSelected = togglePendingUserInputOptionSelection(question, undefined, " first\t");
    const bothSelected = togglePendingUserInputOptionSelection(question, firstSelected, "second");

    expect(buildPendingUserInputAnswers([question], { result: bothSelected })).toEqual({
      result: [" first\t", "second"],
    });

    const secondSelected = togglePendingUserInputOptionSelection(
      question,
      bothSelected,
      " first\t",
    );
    expect(buildPendingUserInputAnswers([question], { result: secondSelected })).toEqual({
      result: ["second"],
    });
  });
});

describe("buildPendingUserInputAnswers", () => {
  it("returns a canonical answer map for complete prompts", () => {
    expect(
      buildPendingUserInputAnswers(
        [
          singleSelectQuestion,
          {
            id: "compat",
            header: "Compat",
            question: "How strict should compatibility be?",
            options: [
              {
                label: "Keep current envelope",
                description: "Preserve current wire format",
              },
            ],
            multiSelect: false,
          },
        ],
        {
          scope: {
            selectedOptionValues: ["Orchestration-first"],
          },
          compat: {
            customAnswer: "Keep the current envelope for one release window",
          },
        },
      ),
    ).toEqual({
      scope: "Orchestration-first",
      compat: "Keep the current envelope for one release window",
    });
  });
});

describe("pending user input question progress", () => {
  const questions = [
    singleSelectQuestion,
    {
      id: "compat",
      header: "Compat",
      question: "How strict should compatibility be?",
      options: [
        {
          label: "Keep current envelope",
          description: "Preserve current wire format",
        },
      ],
      multiSelect: false,
    },
  ] as const;

  it("derives the active question and advancement state", () => {
    expect(
      derivePendingUserInputProgress(
        questions,
        {
          scope: {
            selectedOptionValues: ["Orchestration-first"],
          },
        },
        0,
      ),
    ).toMatchObject({
      questionIndex: 0,
      activeQuestion: questions[0],
      selectedOptionValues: ["Orchestration-first"],
      customAnswer: "",
      resolvedAnswer: "Orchestration-first",
      answeredQuestionCount: 1,
      isLastQuestion: false,
      isComplete: false,
      canAdvance: true,
    });
  });
});

it("accepts attachment-only answers after every upload finishes", () => {
  const questions = [
    { id: "spec", header: "Spec", question: "Provide a spec", options: [], multiSelect: false },
  ];
  expect(buildPendingUserInputAnswers(questions, { spec: { attachmentCount: 1 } })).toEqual({
    spec: "",
  });
  expect(
    buildPendingUserInputAnswers(questions, {
      spec: { attachmentCount: 1, attachmentsBlocked: true },
    }),
  ).toBeNull();
  expect(
    buildPendingUserInputAnswers([{ ...questions[0]!, allowCustomAnswer: false }], {
      spec: { attachmentCount: 1 },
    }),
  ).toBeNull();
});

describe("carryDisplacedCustomAnswerIntoPrompt", () => {
  // regression: #12577 clicking a question option discarded typed text
  it("keeps the thread draft when nothing was typed into the answer", () => {
    expect(carryDisplacedCustomAnswerIntoPrompt("draft", undefined)).toBe("draft");
    expect(carryDisplacedCustomAnswerIntoPrompt("draft", "   ")).toBe("draft");
  });

  // regression: #12577 clicking a question option discarded typed text
  it("moves the typed answer into an empty thread draft", () => {
    expect(carryDisplacedCustomAnswerIntoPrompt("", "also rename the flag ")).toBe(
      "also rename the flag",
    );
  });

  it("appends the typed answer after an existing thread draft", () => {
    expect(carryDisplacedCustomAnswerIntoPrompt("first half\n", "second half")).toBe(
      "first half\n\nsecond half",
    );
  });
});
