import type {
  ComposerContextRecord,
  ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  ReviewCommentContextRecord,
  ServerProviderModel,
  ThreadContextRecord,
  TicketContextRecord,
  TicketLaunchDraftInput,
} from "@t3tools/contracts";
import {
  assistantCitationsToPlainText,
  serializeAssistantCitation,
} from "@t3tools/shared/assistantCitations";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  replaceComposerContextReferences,
} from "@t3tools/shared/composerContextReferences";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { createModelSelection } from "@t3tools/shared/model";

import { getComposerProviderState } from "../chat/composerProviderState";
import {
  ticketCaptureMarkdown,
  ticketCaptureSelection,
  type TicketCaptureItem,
} from "./ticketCapture";

export type TicketPromptRecord =
  | ThreadContextRecord
  | TicketContextRecord
  | ReviewCommentContextRecord;

/**
 * The same token `ticketCapture` puts in the selection. A chip the user deletes no longer
 * contains it, so the launch must not keep sending that item.
 */
function captureItemText(item: TicketCaptureItem): string {
  switch (item.type) {
    case "quote":
      return serializeAssistantCitation(item.citation);
    case "file":
      return serializeComposerFileLink(item.path);
    case "context":
      return formatComposerContextReference(item.record);
  }
}

function withoutFirstToken(
  text: string,
  token: string,
): { readonly text: string; readonly found: boolean } {
  if (token.length === 0) return { text, found: false };
  const index = text.indexOf(token);
  if (index < 0) return { text, found: false };
  return { text: `${text.slice(0, index)}${text.slice(index + token.length)}`, found: true };
}

function tidyInstruction(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitCapturedPrompt(
  prompt: string,
  items: ReadonlyArray<TicketCaptureItem>,
): { readonly instruction: string; readonly kept: ReadonlyArray<TicketCaptureItem> } {
  const kept: TicketCaptureItem[] = [];
  let instruction = prompt;
  for (const item of items) {
    const next = withoutFirstToken(instruction, captureItemText(item));
    if (!next.found) continue;
    kept.push(item);
    instruction = next.text;
  }
  return { instruction: tidyInstruction(instruction), kept };
}

/**
 * Instruction is what the user typed. Selection is the captured chips still in the prompt.
 * Records for a chip deleted from the editor are omitted; records for `@` and `#` mentions
 * still in the prompt are attached to the same message context the server projects.
 */
export function ticketDraftPayload(
  prompt: string,
  items: ReadonlyArray<TicketCaptureItem>,
  promptRecords: ReadonlyArray<TicketPromptRecord>,
): { readonly instruction: string; readonly selection: TicketLaunchDraftInput["selection"] } {
  const { instruction, kept } = splitCapturedPrompt(prompt, items);
  const selection = ticketCaptureSelection(kept);
  const referenced = new Set(
    collectComposerContextReferences(prompt).map((reference) => reference.contextId),
  );
  const records = new Map(
    (selection.context?.records ?? []).map((record) => [record.contextId, record]),
  );
  for (const record of promptRecords) {
    if (referenced.has(record.contextId)) records.set(record.contextId, record);
  }
  return {
    instruction,
    selection: {
      text: selection.text,
      ...(records.size === 0 ? {} : { context: { version: 1, records: [...records.values()] } }),
    },
  };
}

export function ticketManualPrefill(prompt: string, items: ReadonlyArray<TicketCaptureItem>) {
  const { instruction, kept } = splitCapturedPrompt(prompt, items);
  const readable = assistantCitationsToPlainText(
    replaceComposerContextReferences(instruction, (reference) => reference.label),
  );
  const [firstLine = "", ...rest] = readable.trim().split("\n");
  return {
    title: firstLine.trim(),
    body: [rest.join("\n").trim(), ticketCaptureMarkdown(kept)]
      .filter((part) => part.length > 0)
      .join("\n\n"),
  };
}

export function mergeTicketPromptRecords(
  current: ReadonlyArray<TicketPromptRecord>,
  incoming: ReadonlyArray<TicketPromptRecord>,
): TicketPromptRecord[] {
  const byId = new Map(current.map((record) => [record.contextId, record]));
  for (const record of incoming) byId.set(record.contextId, record);
  return [...byId.values()];
}

/**
 * Clipboard context the draft can send. Files and images have no attachment channel on
 * `tickets.launchDraft`, and a thread or ticket from another environment cannot be read.
 * Dropped references become their labels so the paste does not disappear.
 */
export function prepareTicketDraftPaste(input: {
  readonly text: string;
  readonly records: ReadonlyArray<ComposerContextRecord>;
  readonly environmentId: ThreadContextRecord["environmentId"];
}): {
  readonly text: string;
  readonly records: ReadonlyArray<TicketPromptRecord>;
  readonly rewrittenIds: ReadonlyMap<string, string>;
  readonly droppedAttachment: boolean;
  readonly droppedOther: boolean;
} {
  const accepted: TicketPromptRecord[] = [];
  const rewrittenIds = new Map<string, string>();
  const droppedIds = new Set<string>();
  let droppedAttachment = false;
  let droppedOther = false;
  for (const record of input.records) {
    if (record.kind === "image" || record.kind === "file") {
      droppedAttachment = true;
      droppedIds.add(record.contextId);
      continue;
    }
    if (!isPromptRecord(record)) {
      droppedOther = true;
      droppedIds.add(record.contextId);
      continue;
    }
    if (record.kind !== "review-comment" && record.environmentId !== input.environmentId) {
      droppedOther = true;
      droppedIds.add(record.contextId);
      continue;
    }
    accepted.push(record);
    rewrittenIds.set(record.contextId, record.contextId);
  }
  return {
    text:
      droppedIds.size === 0
        ? input.text
        : replaceComposerContextReferences(input.text, (occurrence) =>
            droppedIds.has(occurrence.contextId) ? occurrence.label : occurrence.source,
          ),
    records: accepted,
    rewrittenIds,
    droppedAttachment,
    droppedOther,
  };
}

/** Plans stay out: their record tells the agent to implement the plan, not to file a ticket. */
function isPromptRecord(record: ComposerContextRecord): record is TicketPromptRecord {
  return (
    (record.kind === "thread" || record.kind === "ticket" || record.kind === "review-comment") &&
    !("payload" in record)
  );
}

function defaultModelSlug(models: ReadonlyArray<ServerProviderModel>): string | undefined {
  return (
    models.find((model) => model.isDefault && !model.isCustom)?.slug ??
    models.find((model) => !model.isCustom)?.slug ??
    models[0]?.slug
  );
}

/**
 * Project default, then a selectable instance's own default. Options are the ones this
 * provider can dispatch: a stored plan-mode value is healed, and unknown ids are dropped.
 * The analyzer is not a plan-mode turn, so plan options are never offered.
 */
export function ticketDraftModelSelection(input: {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly stored: ModelSelection | null;
  readonly planModeEnabled: boolean;
}): ModelSelection | null {
  const sameInstance = input.stored?.instanceId === input.instanceId;
  const model = sameInstance ? input.stored?.model : defaultModelSlug(input.models);
  if (!model) return null;
  const { modelOptionsForDispatch } = getComposerProviderState({
    provider: input.driverKind,
    model,
    models: input.models,
    modelOptions: sameInstance ? input.stored?.options : undefined,
    planModeEnabled: input.planModeEnabled,
  });
  return createModelSelection(input.instanceId, model, modelOptionsForDispatch);
}
