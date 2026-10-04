import {
  ComposerContextId,
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TicketId,
  TicketPlanId,
  type ProviderOptionDescriptor,
  type ServerProviderModel,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { describe, expect, it } from "vite-plus/test";

import { threadContextRecord } from "../../lib/composerContextRecords";
import {
  prepareTicketDraftPaste,
  ticketDraftModelSelection,
  ticketDraftPayload,
  ticketManualPrefill,
} from "./createTicketDraft.logic";
import { ticketCaptureSelection, type TicketCaptureItem } from "./ticketCapture";
import { ticketContextRecord, ticketPlanContextRecord } from "./ticketContextRecord";

const environmentId = EnvironmentId.make("env-1");
const otherEnvironmentId = EnvironmentId.make("env-2");
const thread = threadContextRecord(
  { environmentId, threadId: ThreadId.make("thread-1") },
  "Checkout bug",
);
const otherThread = threadContextRecord(
  { environmentId, threadId: ThreadId.make("thread-2") },
  "Old investigation",
);
const foreignThread = threadContextRecord(
  { environmentId: otherEnvironmentId, threadId: ThreadId.make("thread-3") },
  "Other server",
);
const ticket = ticketContextRecord({
  environmentId,
  ticket: {
    id: TicketId.make("ticket-1"),
    number: 42,
    title: "Cart total",
    linkRefs: [],
    plans: [],
  },
});
const capture: ReadonlyArray<TicketCaptureItem> = [
  { type: "context", record: thread },
  { type: "file", path: "src/cart.ts" },
];
const captureText = ticketCaptureSelection(capture).text;
const fileLink = serializeComposerFileLink("src/cart.ts");

const driverKind = ProviderDriverKind.make("codex");
const instanceId = ProviderInstanceId.make("codex");
const otherInstanceId = ProviderInstanceId.make("claude");

function agentModel(): ReadonlyArray<ServerProviderModel> {
  const agent: ProviderOptionDescriptor = {
    id: "agent",
    label: "Agent",
    type: "select",
    options: [
      { id: "build", label: "Build", isDefault: true },
      { id: "plan", label: "Plan" },
    ],
  };
  return [
    {
      slug: "gpt-test",
      name: "GPT Test",
      isCustom: false,
      isDefault: true,
      capabilities: { optionDescriptors: [agent] },
    },
  ];
}

describe("ticketDraftPayload", () => {
  it("keeps captured chips in the selection and mention records that are still in the prompt", () => {
    const drafted = ticketDraftPayload(
      `${captureText}\n\nInvestigate ${formatComposerContextReference(thread)} and ${formatComposerContextReference(ticket)}`,
      capture,
      [thread, ticket, otherThread],
    );
    expect(drafted).toEqual({
      instruction: `Investigate ${formatComposerContextReference(thread)} and ${formatComposerContextReference(ticket)}`,
      selection: {
        text: captureText,
        context: { version: 1, records: [thread, ticket] },
      },
    });
  });

  it("drops a captured chip deleted from the prompt, including a record still held beside it", () => {
    const drafted = ticketDraftPayload(
      captureText.replace(formatComposerContextReference(thread), ""),
      capture,
      [thread, ticket],
    );
    expect(drafted).toEqual({
      instruction: "",
      selection: { text: fileLink },
    });
  });

  it("does not send a mention removed from the prompt", () => {
    expect(ticketDraftPayload("Investigate the cart", [], [ticket, otherThread])).toEqual({
      instruction: "Investigate the cart",
      selection: { text: "" },
    });
  });

  it("carries a typed mention without a captured selection", () => {
    expect(ticketDraftPayload(formatComposerContextReference(ticket), [], [ticket])).toEqual({
      instruction: formatComposerContextReference(ticket),
      selection: { text: "", context: { version: 1, records: [ticket] } },
    });
  });
});

describe("ticketManualPrefill", () => {
  it("uses readable mention labels and the captured files that are still in the prompt", () => {
    expect(
      ticketManualPrefill(
        `${captureText}\n\nInvestigate ${formatComposerContextReference(ticket)}\nReproduce the empty cart failure.`,
        capture,
      ),
    ).toEqual({
      title: "Investigate T-42 Cart total",
      body: "Reproduce the empty cart failure.\n\n`src/cart.ts`",
    });
  });

  it("omits a captured file the user deleted", () => {
    expect(
      ticketManualPrefill(`${formatComposerContextReference(thread)}\n\nTitle line`, capture),
    ).toEqual({
      title: "Title line",
      body: "",
    });
  });
});

describe("prepareTicketDraftPaste", () => {
  it("keeps threads and tickets from this environment", () => {
    const text = `See ${formatComposerContextReference(thread)}`;
    expect(prepareTicketDraftPaste({ text, records: [thread], environmentId })).toMatchObject({
      text,
      records: [thread],
      droppedAttachment: false,
      droppedOther: false,
    });
  });

  it("replaces pasted files with their labels and keeps the surrounding mention", () => {
    const image = {
      version: 1 as const,
      kind: "image" as const,
      contextId: ComposerContextId.make("img_shot"),
      label: "shot.png",
      attachmentId: "att-shot",
      name: "shot.png",
      mimeType: "image/png",
      sizeBytes: 12,
    };
    const text = `${formatComposerContextReference(image)} ${formatComposerContextReference(thread)}`;
    const prepared = prepareTicketDraftPaste({
      text,
      records: [image, thread, foreignThread],
      environmentId,
    });
    expect(prepared.droppedAttachment).toBe(true);
    expect(prepared.droppedOther).toBe(true);
    expect(prepared.text).toBe(`shot.png ${formatComposerContextReference(thread)}`);
    expect(prepared.records).toEqual([thread]);
    expect(prepared.rewrittenIds.get(foreignThread.contextId)).toBeUndefined();
  });

  it("turns a pasted plan into its label, since an analyzer files tickets and never implements plans", () => {
    const plan = ticketPlanContextRecord({
      environmentId,
      ticket: { id: TicketId.make("ticket-1") },
      plan: {
        planId: TicketPlanId.make("plan-1"),
        ref: "T-42/P1",
        number: 1,
        title: "Auth migration",
        status: "active",
        revision: 3,
        openCommentCount: 0,
        createdBy: { type: "user" },
        updatedBy: { type: "user" },
        updatedAt: "2026-10-01T00:00:00.000Z",
      },
    });
    const text = `${formatComposerContextReference(plan)} ${formatComposerContextReference(ticket)}`;
    const prepared = prepareTicketDraftPaste({ text, records: [plan, ticket], environmentId });
    expect([prepared.text, prepared.records, prepared.droppedOther]).toEqual([
      `T-42/P1 Auth migration ${formatComposerContextReference(ticket)}`,
      [ticket],
      true,
    ]);
  });
});

describe("ticketDraftModelSelection", () => {
  it("uses the stored model and heals options the provider cannot dispatch", () => {
    expect(
      ticketDraftModelSelection({
        instanceId,
        driverKind,
        models: agentModel(),
        stored: {
          instanceId,
          model: "gpt-test",
          options: [
            { id: "agent", value: "plan" },
            { id: "not-a-real-option", value: "x" },
          ],
        },
        planModeEnabled: false,
      }),
    ).toEqual({
      instanceId,
      model: "gpt-test",
      options: [{ id: "agent", value: "build" }],
    });
  });

  it("falls back to the instance default when the stored selection is for another instance", () => {
    expect(
      ticketDraftModelSelection({
        instanceId,
        driverKind,
        models: agentModel(),
        stored: { instanceId: otherInstanceId, model: "claude-sonnet" },
        planModeEnabled: false,
      }),
    ).toEqual({ instanceId, model: "gpt-test" });
  });

  it("returns null when the instance has no model to launch", () => {
    expect(
      ticketDraftModelSelection({
        instanceId,
        driverKind,
        models: [],
        stored: null,
        planModeEnabled: false,
      }),
    ).toBeNull();
  });
});
