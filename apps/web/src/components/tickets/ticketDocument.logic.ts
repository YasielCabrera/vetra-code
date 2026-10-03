import type { TicketClaimedAttachment } from "@t3tools/contracts";

import { replaceClaimedAttachmentReferences } from "../../lib/attachmentReferences";

interface RevisionedBody {
  readonly revision: number;
  readonly body: string;
}

/**
 * The detail page's copy of one ticket's body. A body save names `base.revision`, so the page
 * never trips over its own saves, while a write by anyone else since `base` comes back as a
 * conflict. Title, label and status writes name the newest revision the page has seen instead:
 * the user made them against the fields on screen, and they leave the body alone.
 */
export interface TicketDocumentState {
  /** What the editor holds. Unsaved while it differs from `base.body`. */
  readonly text: string;
  /** The server state `text` was last in step with. */
  readonly base: RevisionedBody;
  /** The newest state the server has sent. */
  readonly server: RevisionedBody;
  /** A write in flight: the body it carried (null when it carried none) and the revision it named. */
  readonly writing: {
    readonly sentBody: string | null;
    readonly expectedRevision: number;
  } | null;
  /** The body of the last save that failed. Autosave waits for another edit before retrying. */
  readonly failedText: string | null;
  /** A body save hit someone else's body change; the user picks reload or keep mine. */
  readonly conflict: boolean;
  /** Claims survive upload release, because editor undo can still contain pending ids. */
  readonly claimed: ReadonlyArray<TicketClaimedAttachment>;
}

export type TicketDocumentEvent =
  | { readonly type: "edited"; readonly text: string }
  | { readonly type: "serverChanged"; readonly revision: number; readonly body: string }
  | {
      readonly type: "writeStarted";
      readonly sentBody: string | null;
      readonly expectedRevision: number;
    }
  | {
      readonly type: "writeLanded";
      readonly revision: number;
      readonly claimed: ReadonlyArray<TicketClaimedAttachment>;
    }
  | { readonly type: "writeFailed" }
  | { readonly type: "writeConflicted" }
  /** Drop local edits and take what the server has. */
  | { readonly type: "reload" }
  /** Keep local edits and write them over the server's newer revision. */
  | { readonly type: "keepMine" };

export function initialTicketDocument(server: RevisionedBody): TicketDocumentState {
  return {
    text: server.body,
    base: server,
    server,
    writing: null,
    failedText: null,
    conflict: false,
    claimed: [],
  };
}

export function hasUnsavedBody(state: TicketDocumentState): boolean {
  return state.text !== state.base.body;
}

export function shouldAutosave(state: TicketDocumentState): boolean {
  return (
    hasUnsavedBody(state) &&
    !state.conflict &&
    state.writing === null &&
    state.text !== state.failedText
  );
}

/**
 * Catches `base` up to a newer server revision once no write is in flight. A revision that left
 * the body alone (a status, label or title change) is taken even over unsaved text, and clears a
 * conflict it caused; a new body is taken only when there is nothing local to lose.
 */
function settle(state: TicketDocumentState): TicketDocumentState {
  if (state.writing !== null || state.server.revision <= state.base.revision) return state;
  if (state.server.body === state.base.body) {
    return { ...state, base: state.server, conflict: false };
  }
  if (hasUnsavedBody(state)) return state;
  return { ...state, text: state.server.body, base: state.server, conflict: false };
}

function reload(state: TicketDocumentState): TicketDocumentState {
  return { ...state, text: state.server.body, base: state.server, conflict: false };
}

export function reduceTicketDocument(
  state: TicketDocumentState,
  event: TicketDocumentEvent,
): TicketDocumentState {
  switch (event.type) {
    case "edited": {
      const text = replaceClaimedAttachmentReferences(event.text, state.claimed);
      return settle({
        ...state,
        text,
        conflict: text === state.base.body ? false : state.conflict,
      });
    }
    case "serverChanged":
      if (
        event.revision < state.server.revision ||
        (event.revision === state.server.revision && event.body === state.server.body)
      ) {
        return state;
      }
      return settle({
        ...state,
        server: {
          revision: event.revision,
          body: replaceClaimedAttachmentReferences(event.body, state.claimed),
        },
      });
    case "writeStarted":
      return {
        ...state,
        writing: { sentBody: event.sentBody, expectedRevision: event.expectedRevision },
      };
    case "writeLanded": {
      const claimed = [
        ...new Map(
          [...state.claimed, ...event.claimed].map((claim) => [claim.pendingId, claim]),
        ).values(),
      ];
      const sentBody = state.writing?.sentBody ?? null;
      // A field write past someone else's change leaves `base` behind, so their body still counts.
      const followsBase = state.writing?.expectedRevision === state.base.revision;
      return settle({
        ...state,
        claimed,
        writing: null,
        text: replaceClaimedAttachmentReferences(state.text, claimed),
        server: {
          ...state.server,
          body: replaceClaimedAttachmentReferences(state.server.body, claimed),
        },
        base: !followsBase
          ? state.base
          : {
              revision: event.revision,
              body:
                sentBody === null
                  ? state.base.body
                  : replaceClaimedAttachmentReferences(sentBody, claimed),
            },
      });
    }
    case "writeFailed":
      return {
        ...state,
        writing: null,
        failedText: state.writing?.sentBody ?? state.failedText,
      };
    case "writeConflicted":
      return settle({
        ...state,
        writing: null,
        conflict: state.conflict || (state.writing?.sentBody ?? null) !== null,
      });
    case "reload":
      return reload(state);
    case "keepMine":
      return hasUnsavedBody(state)
        ? { ...state, base: state.server, conflict: false }
        : reload(state);
  }
}
