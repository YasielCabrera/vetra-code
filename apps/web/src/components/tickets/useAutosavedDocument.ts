import type { TicketClaimedAttachment } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { TICKET_REVISION_CONFLICT } from "../../hooks/useTicketActions";
import { attachmentReferenceIds } from "../../lib/attachmentReferences";
import { releaseAttachmentUpload } from "../../lib/attachmentUploadQueue";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { PendingTicketUpload } from "./ticketAttachments";
import {
  hasUnsavedBody,
  initialTicketDocument,
  reduceTicketDocument,
  shouldAutosave,
  type TicketDocumentEvent,
  type TicketDocumentState,
} from "./ticketDocument.logic";

const AUTOSAVE_DELAY_MS = 800;

/** What a write reports back: the revision it produced and the uploads the server claimed. */
export type DocumentWriteOutcome =
  | { readonly revision: number; readonly claimed: ReadonlyArray<TicketClaimedAttachment> }
  | typeof TICKET_REVISION_CONFLICT
  | null;

/** One server write naming the revision it was made against. */
export type DocumentWrite = (expectedRevision: number) => Promise<DocumentWriteOutcome>;

export type DocumentUpload = PendingTicketUpload["attachment"];

/**
 * Owns a page's writes to one revisioned Markdown document, a ticket's description or a plan.
 * Writes run one at a time, each naming the revision `TicketDocumentState` describes, the body
 * autosaves after a pause, and uploads ride along with the save whose body first references them.
 * Writes that carry no body (a title, labels, a status) go through `writeFields`, so they queue
 * behind the body and name the newest revision the page has seen.
 */
export function useAutosavedDocument(options: {
  readonly revision: number;
  readonly body: string;
  readonly writeBody: (
    expectedRevision: number,
    body: string,
    uploads: ReadonlyArray<DocumentUpload>,
  ) => Promise<DocumentWriteOutcome>;
  /** The toast title when a write without a body loses to someone else's change. */
  readonly fieldConflictTitle: string;
}) {
  const { revision, body, writeBody, fieldConflictTitle } = options;
  const [state, setState] = useState(() => initialTicketDocument({ revision, body }));
  const stateRef = useRef(state);
  const dispatch = useCallback((event: TicketDocumentEvent) => {
    stateRef.current = reduceTicketDocument(stateRef.current, event);
    setState(stateRef.current);
  }, []);
  // The newest revision from either the server or a write's reply, which can arrive first.
  const latestRevisionRef = useRef(revision);
  const pendingUploadsRef = useRef(new Map<string, PendingTicketUpload>());
  const mountedRef = useRef(true);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    latestRevisionRef.current = Math.max(latestRevisionRef.current, revision);
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
    async (sentBody: string | null, run: DocumentWrite): Promise<boolean> => {
      const expectedRevision =
        sentBody === null ? latestRevisionRef.current : stateRef.current.base.revision;
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
      latestRevisionRef.current = Math.max(latestRevisionRef.current, result.revision);
      dispatch({ type: "writeLanded", revision: result.revision, claimed: result.claimed });
      return true;
    },
    [dispatch, fieldConflictTitle],
  );

  const saveBody = useCallback(() => {
    if (!hasUnsavedBody(stateRef.current) || stateRef.current.conflict) return;
    void enqueue(async (current) => {
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
    });
  }, [enqueue, write, writeBody]);

  /** Queues a write without a body; `prepare` runs in turn and returns null to skip it. */
  const writeFields = useCallback(
    (prepare: () => DocumentWrite | null) =>
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

  const saveBodyRef = useRef(saveBody);
  useEffect(() => {
    saveBodyRef.current = saveBody;
  }, [saveBody]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      saveBodyRef.current();
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
    edit: useCallback((text: string) => dispatch({ type: "edited", text }), [dispatch]),
    reload: useCallback(() => dispatch({ type: "reload" }), [dispatch]),
    keepMine: useCallback(() => {
      dispatch({ type: "keepMine" });
      saveBody();
    }, [dispatch, saveBody]),
    /** Holds an upload for the save that references it; false once the page has closed. */
    addPendingUpload: useCallback((upload: PendingTicketUpload) => {
      if (mountedRef.current) pendingUploadsRef.current.set(upload.attachment.id, upload);
      return mountedRef.current;
    }, []),
    writeFields,
  };
}
