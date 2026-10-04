import type { TicketClaimedAttachment } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { attachmentReferenceIds } from "../../lib/attachmentReferences";
import { releaseAttachmentUpload } from "../../lib/attachmentUploadQueue";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { PendingTicketUpload } from "./ticketAttachments";
import {
  hasUnsavedBody,
  initialTicketDocument,
  reduceTicketDocument,
  shouldAutosave,
  TICKET_REVISION_CONFLICT,
  type TicketDocumentEvent,
  type TicketDocumentState,
} from "./ticketDocument.logic";

const AUTOSAVE_DELAY_MS = 800;

export type DocumentWriteOutcome<Summary> =
  | { readonly summary: Summary; readonly claimed: ReadonlyArray<TicketClaimedAttachment> }
  | typeof TICKET_REVISION_CONFLICT
  | null;

/** One server write naming the revision it was made against. */
export type DocumentWrite<Summary> = (
  expectedRevision: number,
) => Promise<DocumentWriteOutcome<Summary>>;

export type DocumentUpload = PendingTicketUpload["attachment"];

/**
 * Owns a page's writes to one revisioned Markdown document, a ticket's description or a plan.
 * Writes run one at a time, each naming the revision `TicketDocumentState` describes, the body
 * autosaves after a pause, and uploads ride along with the save whose body first references them.
 * Writes that carry no body (a title, labels, a status) go through `writeFields`, so they queue
 * behind the body and name the newest revision the page has seen.
 */
export function useAutosavedDocument<Summary extends { readonly revision: number }>(options: {
  readonly summary: Summary;
  readonly body: string;
  readonly writeBody: (
    expectedRevision: number,
    body: string,
    uploads: ReadonlyArray<DocumentUpload>,
  ) => Promise<DocumentWriteOutcome<Summary>>;
  /** The toast title when a write without a body loses to someone else's change. */
  readonly fieldConflictTitle: string;
}) {
  const { summary, body, writeBody, fieldConflictTitle } = options;
  const { revision } = summary;
  const [state, setState] = useState(() => initialTicketDocument({ revision, body }));
  const stateRef = useRef(state);
  const dispatch = useCallback((event: TicketDocumentEvent) => {
    stateRef.current = reduceTicketDocument(stateRef.current, event);
    setState(stateRef.current);
  }, []);
  const latestRef = useRef(summary);
  const keepNewestSummary = useCallback((next: Summary) => {
    if (next.revision >= latestRef.current.revision) latestRef.current = next;
  }, []);
  const pendingUploadsRef = useRef(new Map<string, PendingTicketUpload>());
  const mountedRef = useRef(true);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => keepNewestSummary(summary), [keepNewestSummary, summary]);
  useEffect(() => {
    dispatch({ type: "serverChanged", revision, body });
  }, [body, dispatch, revision]);

  const enqueue = useCallback(
    <A>(write: (current: TicketDocumentState) => Promise<A>): Promise<A> => {
      const next = queueRef.current.then(() => write(stateRef.current));
      queueRef.current = next.catch(() => undefined);
      return next;
    },
    [],
  );

  const write = useCallback(
    async (sentBody: string | null, run: DocumentWrite<Summary>): Promise<boolean> => {
      const expectedRevision =
        sentBody === null ? latestRef.current.revision : stateRef.current.base.revision;
      dispatch({ type: "writeStarted", sentBody, expectedRevision });
      const result = await run(expectedRevision);
      if (result === TICKET_REVISION_CONFLICT) {
        dispatch({ type: "writeConflicted" });
        if (sentBody === null) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: fieldConflictTitle,
              description: "Someone else edited it at the same time. Try again.",
            }),
          );
        }
        return false;
      }
      if (result === null) {
        dispatch({ type: "writeFailed" });
        return false;
      }
      keepNewestSummary(result.summary);
      dispatch({ type: "writeLanded", revision: result.summary.revision, claimed: result.claimed });
      return true;
    },
    [dispatch, fieldConflictTitle, keepNewestSummary],
  );

  const saveBody = useCallback(
    () =>
      enqueue(async (current) => {
        if (current.conflict) return false;
        if (!hasUnsavedBody(current)) return true;
        const sentBody = current.text;
        const uploads = attachmentReferenceIds(sentBody).flatMap((id) => {
          const upload = pendingUploadsRef.current.get(id);
          return upload === undefined ? [] : [upload];
        });
        const landed = await write(sentBody, (expectedRevision) =>
          writeBody(
            expectedRevision,
            sentBody,
            uploads.map((upload) => upload.attachment),
          ),
        );
        if (landed) {
          for (const upload of uploads) {
            pendingUploadsRef.current.delete(upload.attachment.id);
            releaseAttachmentUpload(upload.localId);
          }
        }
        return landed;
      }),
    [enqueue, write, writeBody],
  );

  /** Queues a write without a body; `prepare` runs in turn and returns null to skip it. */
  const writeFields = useCallback(
    (prepare: () => DocumentWrite<Summary> | null) =>
      enqueue(async () => {
        const run = prepare();
        return run === null ? true : write(null, run);
      }),
    [enqueue, write],
  );

  useEffect(() => {
    if (!shouldAutosave(state)) return;
    const timer = window.setTimeout(saveBody, AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [saveBody, state]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const current = stateRef.current;
      if (!hasUnsavedBody(current) && current.writing === null) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const saveBodyRef = useRef(saveBody);
  useEffect(() => {
    saveBodyRef.current = saveBody;
  }, [saveBody]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void saveBodyRef.current();
      const pendingUploads = pendingUploadsRef.current;
      void queueRef.current.then(() => {
        for (const upload of pendingUploads.values()) releaseAttachmentUpload(upload.localId);
        pendingUploads.clear();
      });
    };
  }, []);

  return {
    state,
    /** The editor's text right now, without subscribing to it. */
    readText: useCallback(() => stateRef.current.text, []),
    /** The newest summary, without subscribing to it. */
    readLatest: useCallback(() => latestRef.current, []),
    edit: useCallback((text: string) => dispatch({ type: "edited", text }), [dispatch]),
    reload: useCallback(() => dispatch({ type: "reload" }), [dispatch]),
    keepMine: useCallback(() => {
      dispatch({ type: "keepMine" });
      void saveBody();
    }, [dispatch, saveBody]),
    /** Waits for queued writes and saves the current body; false if the body cannot save. */
    flush: saveBody,
    /** Holds an upload for the save that references it; false once the page has closed. */
    addPendingUpload: useCallback((upload: PendingTicketUpload) => {
      if (mountedRef.current) pendingUploadsRef.current.set(upload.attachment.id, upload);
      return mountedRef.current;
    }, []),
    writeFields,
  };
}
