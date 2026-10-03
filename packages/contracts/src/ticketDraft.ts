import * as Schema from "effect/Schema";

import { ProjectId, ThreadId } from "./baseSchemas.ts";
import { PROVIDER_SEND_TURN_MAX_INPUT_CHARS } from "./chatAttachment.ts";
import { OrchestrationMessageContext } from "./composerContext.ts";
import { ModelSelection } from "./modelSelection.ts";

export const TicketLaunchDraftInput = Schema.Struct({
  projectId: ProjectId,
  /** The thread the selection came from; the drafted ticket links it. */
  sourceThreadId: Schema.optional(ThreadId),
  /** What the user wants the ticket to be about. May be empty when a selection says enough. */
  instruction: Schema.String.check(Schema.isMaxLength(4_000)),
  /** The selection as a composer message carries it: text with inline references, and their records. */
  selection: Schema.Struct({
    text: Schema.String.check(Schema.isMaxLength(PROVIDER_SEND_TURN_MAX_INPUT_CHARS)),
    context: Schema.optional(OrchestrationMessageContext),
  }),
  modelSelection: ModelSelection,
});
export type TicketLaunchDraftInput = typeof TicketLaunchDraftInput.Type;

export const TicketLaunchDraftResult = Schema.Struct({ threadId: ThreadId });
export type TicketLaunchDraftResult = typeof TicketLaunchDraftResult.Type;
