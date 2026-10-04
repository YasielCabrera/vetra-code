import { TICKET_BODY_MAX_CHARS, TicketError, type TicketPlanEdit } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/**
 * Applies find-and-replace edits in order. Each `find` must occur exactly once in the text the
 * earlier edits left, so an edit never lands somewhere its author did not mean.
 */
export const applyPlanEdits = (
  body: string,
  edits: ReadonlyArray<TicketPlanEdit>,
): Effect.Effect<string, TicketError> => {
  let text = body;
  for (const [index, edit] of edits.entries()) {
    const at = text.indexOf(edit.find);
    if (at === -1) {
      return Effect.fail(
        new TicketError({
          message: `Edit ${index + 1} matched nothing: its find text is not in the plan.`,
        }),
      );
    }
    if (text.includes(edit.find, at + 1)) {
      return Effect.fail(
        new TicketError({
          message: `Edit ${index + 1} matched more than once: add surrounding text to its find text so it matches once.`,
        }),
      );
    }
    text = text.slice(0, at) + edit.replace + text.slice(at + edit.find.length);
  }
  if (text.length > TICKET_BODY_MAX_CHARS) {
    return Effect.fail(
      new TicketError({ message: "The edits would make the plan longer than 100,000 characters." }),
    );
  }
  return Effect.succeed(text);
};
