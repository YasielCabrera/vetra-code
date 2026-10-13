import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  attachmentReferenceIds,
  replaceClaimedAttachmentReferences,
} from "../../lib/attachmentReferences";
import { releaseAttachmentUpload } from "../../lib/attachmentUploadQueue";
import { createNavigationDrafts } from "../../lib/navigationDrafts";
import { stackedThreadToast, toastManager } from "../ui/toast";
import type { PendingTicketUpload } from "./ticketAttachments";
import {
  hasUnsavedBody,
  initialTicketDocument,
  reduceTicketDocument,
  shouldAutosave,
  TICKET_REVISION_CONFLICT,
  type DocumentWriteOutcome,
  type TicketDocumentEvent,
  type TicketDocumentState,
} from "./ticketDocument.logic";

const AUTOSAVE_DELAY_MS = 800;

interface DocumentDraft {
  readonly state: TicketDocumentState;
  readonly latest: { readonly revision: number };
  readonly uploads: ReadonlyArray<PendingTicketUpload>;
}

const navigationDrafts = createNavigationDrafts<DocumentDraft>();

function restoreDocument(state: TicketDocumentState, server: TicketDocumentState["server"]) {
  const next = reduceTicketDocument(
    { ...state, writing: null },
    { type: "serverChanged", ...server },
  );
  return {
    ...next,
    conflict:
      hasUnsavedBody(next) &&
      (next.conflict ||
        (next.server.revision > next.base.revision && next.server.body !== next.base.body)),
  };
}

export type { DocumentWriteOutcome } from "./ticketDocument.logic";

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
  readonly recovery?:
    | {
        readonly key: string;
        readonly title: string;
        readonly reopen: () => void;
      }
    | undefined;
}) {
  const { summary, body, writeBody, fieldConflictTitle } = options;
  const { revision } = summary;
  const [recovered] = useState(() =>
    options.recovery === undefined ? undefined : navigationDrafts.get(options.recovery.key),
  );
  const [state, setState] = useState(() =>
    recovered === undefined
      ? initialTicketDocument({ revision, body })
      : restoreDocument(recovered.value.state, { revision, body }),
  );
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
  const reviewedRef = useRef<{ revision: number; failed: boolean } | null>(null);
  const recoveryStartedRef = useRef(false);
  const recoveryPendingRef = useRef(recovered !== undefined);
  const recoveryEditedRef = useRef(false);

  useEffect(() => {
    if (recovered === undefined || recoveryStartedRef.current) return;
    recoveryStartedRef.current = true;
    if (!navigationDrafts.take(recovered)) {
      recoveryPendingRef.current = false;
      stateRef.current = initialTicketDocument({ revision, body });
      setState(stateRef.current);
      return;
    }
    queueRef.current = recovered.settled.then((snapshot) => {
      const current = stateRef.current;
      let next: TicketDocumentState = { ...snapshot.state, writing: null };
      if (recoveryEditedRef.current) {
        next = reduceTicketDocument(next, { type: "edited", text: current.text });
      }
      stateRef.current = restoreDocument(next, current.server);
      if (snapshot.latest.revision >= latestRef.current.revision) {
        latestRef.current = { ...latestRef.current, ...snapshot.latest };
      }
      for (const upload of snapshot.uploads) {
        pendingUploadsRef.current.set(upload.attachment.id, upload);
      }
      recoveryPendingRef.current = false;
      setState(stateRef.current);
    });
  }, [body, recovered, revision]);

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
    async (
      sentBody: string | null,
      run: DocumentWrite<Summary>,
      pinnedRevision?: number,
    ): Promise<boolean> => {
      const reviewed = reviewedRef.current;
      const expectedRevision =
        pinnedRevision ??
        reviewed?.revision ??
        (sentBody === null ? latestRef.current.revision : stateRef.current.base.revision);
      dispatch({ type: "writeStarted", sentBody, expectedRevision });
      if (
        reviewed !== null &&
        (reviewed.failed ||
          latestRef.current.revision !== reviewed.revision ||
          stateRef.current.base.revision !== reviewed.revision)
      ) {
        reviewed.failed = true;
        dispatch({ type: "writeConflicted" });
        return false;
      }
      const result = await run(expectedRevision);
      if (result === TICKET_REVISION_CONFLICT) {
        if (reviewedRef.current !== null) reviewedRef.current.failed = true;
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
        if (reviewedRef.current !== null) reviewedRef.current.failed = true;
        dispatch({ type: "writeFailed" });
        return false;
      }
      const reviewing = reviewedRef.current;
      const acknowledgement = result.acknowledgement;
      const invalidCommit =
        acknowledgement.kind === "commit" &&
        (acknowledgement.observedRevision !== expectedRevision ||
          (acknowledgement.revision !== expectedRevision &&
            acknowledgement.revision !== expectedRevision + 1));
      const invalidReview =
        reviewing !== null &&
        (reviewing.failed ||
          acknowledgement.kind !== "commit" ||
          expectedRevision !== reviewing.revision ||
          result.summary.revision > acknowledgement.revision ||
          latestRef.current.revision > acknowledgement.revision ||
          stateRef.current.server.revision > acknowledgement.revision);
      if (invalidCommit || invalidReview) {
        if (reviewing !== null) reviewing.failed = true;
        dispatch({ type: "writeConflicted", claimed: result.claimed });
      } else {
        if (reviewing !== null && acknowledgement.kind === "commit") {
          reviewing.revision = acknowledgement.revision;
        }
        keepNewestSummary(result.summary);
        dispatch({ type: "writeLanded", acknowledgement, claimed: result.claimed });
      }
      for (const claim of result.claimed) {
        const upload = pendingUploadsRef.current.get(claim.pendingId);
        if (upload === undefined) continue;
        pendingUploadsRef.current.delete(claim.pendingId);
        releaseAttachmentUpload(upload.localId);
      }
      return !invalidCommit && !invalidReview;
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
        if (
          landed &&
          stateRef.current.base.body ===
            replaceClaimedAttachmentReferences(sentBody, stateRef.current.claimed)
        ) {
          for (const upload of uploads) {
            if (pendingUploadsRef.current.delete(upload.attachment.id)) {
              releaseAttachmentUpload(upload.localId);
            }
          }
        }
        return landed;
      }),
    [enqueue, write, writeBody],
  );

  /** Queues a write without a body; `prepare` runs in turn and returns null to skip it. */
  const writeFields = useCallback(
    (
      prepare: () => DocumentWrite<Summary> | null,
      options?: {
        readonly expectedRevision?: number;
      },
    ) =>
      enqueue(async () => {
        const run = prepare();
        return run === null ? true : write(null, run, options?.expectedRevision);
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
      if (!hasUnsavedBody(current) && current.writing === null && !recoveryPendingRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const leavingRef = useRef<ReturnType<typeof navigationDrafts.stage> | null>(null);
  const leave = useEffectEvent(() => {
    const recovery = options.recovery;
    const snapshot = (): DocumentDraft => ({
      state: stateRef.current,
      latest: latestRef.current,
      uploads: [...pendingUploadsRef.current.values()],
    });
    const staged =
      recovery !== undefined &&
      (hasUnsavedBody(stateRef.current) ||
        stateRef.current.writing !== null ||
        recoveryPendingRef.current)
        ? navigationDrafts.stage(recovery.key, snapshot())
        : null;
    leavingRef.current = staged;
    void saveBody();
    void (async () => {
      let pending;
      do {
        pending = queueRef.current;
        await pending;
      } while (pending !== queueRef.current);
      if (mountedRef.current) {
        if (staged !== null) navigationDrafts.settle(staged, snapshot(), false);
        return;
      }
      const retain = staged !== null && hasUnsavedBody(stateRef.current);
      const referenced = new Set(retain ? attachmentReferenceIds(stateRef.current.text) : []);
      for (const [id, upload] of pendingUploadsRef.current) {
        if (referenced.has(id)) continue;
        releaseAttachmentUpload(upload.localId);
        pendingUploadsRef.current.delete(id);
      }
      if (staged === null) return;
      const owned = navigationDrafts.settle(staged, snapshot(), retain);
      if (!retain || !owned || recovery === undefined) return;
      const toastId = toastManager.add(
        stackedThreadToast({
          type: "info",
          title: recovery.title,
          description: "Your unsaved changes are available when you return.",
          actionProps: {
            children: "Reopen",
            onClick: () => {
              toastManager.close(toastId);
              recovery.reopen();
            },
          },
        }),
      );
    })();
  });
  useEffect(() => {
    mountedRef.current = true;
    if (leavingRef.current !== null) navigationDrafts.take(leavingRef.current);
    return () => {
      mountedRef.current = false;
      leave();
    };
  }, []);

  return {
    state,
    /** The editor's text right now, without subscribing to it. */
    readText: useCallback(() => stateRef.current.text, []),
    /** The newest summary, without subscribing to it. */
    readLatest: useCallback(() => latestRef.current, []),
    readBase: useCallback(() => stateRef.current.base, []),
    edit: useCallback(
      (text: string) => {
        recoveryEditedRef.current = true;
        dispatch({ type: "edited", text });
      },
      [dispatch],
    ),
    reload: useCallback(() => {
      void enqueue(async () => {
        dispatch({ type: "reload" });
        for (const upload of pendingUploadsRef.current.values()) {
          releaseAttachmentUpload(upload.localId);
        }
        pendingUploadsRef.current.clear();
      });
    }, [dispatch, enqueue]),
    keepMine: useCallback(() => {
      void enqueue(async () => dispatch({ type: "keepMine" }));
      void saveBody();
    }, [dispatch, enqueue, saveBody]),
    /** Waits for queued writes and saves the current body; false if the body cannot save. */
    flush: saveBody,
    flushReviewed: async (commitTitle: () => Promise<boolean>): Promise<number | null> => {
      const reviewed = { revision: stateRef.current.base.revision, failed: false };
      reviewedRef.current = reviewed;
      try {
        if (
          stateRef.current.conflict ||
          latestRef.current.revision !== reviewed.revision ||
          !(await commitTitle()) ||
          !(await saveBody()) ||
          reviewed.failed ||
          stateRef.current.conflict ||
          hasUnsavedBody(stateRef.current) ||
          stateRef.current.base.revision !== reviewed.revision ||
          latestRef.current.revision !== reviewed.revision
        ) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: fieldConflictTitle,
              description: "Review the latest plan and try marking it Ready again.",
            }),
          );
          return null;
        }
        return reviewed.revision;
      } finally {
        reviewedRef.current = null;
      }
    },
    /** Holds an upload for the save that references it; false once the page has closed. */
    addPendingUpload: useCallback((upload: PendingTicketUpload) => {
      if (mountedRef.current) pendingUploadsRef.current.set(upload.attachment.id, upload);
      return mountedRef.current;
    }, []),
    writeFields,
  };
}
