import type { ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import type {
  TicketClaimedAttachment,
  TicketDetail,
  TicketStatusId,
  TicketSummary,
  TicketUpdateInput,
} from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { TICKET_REVISION_CONFLICT, useTicketActions } from "../../hooks/useTicketActions";
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

type FieldUpdate = Pick<TicketUpdateInput, "title" | "labels" | "removeAttachmentIds">;

type WriteResult =
  | { readonly ticket: TicketSummary; readonly claimed: ReadonlyArray<TicketClaimedAttachment> }
  | typeof TICKET_REVISION_CONFLICT
  | null;

/**
 * Owns the detail page's writes to one ticket. They run one at a time, each naming the revision
 * `TicketDocumentState` describes, the body autosaves after a pause, and uploads ride along with
 * the save whose body first references them.
 */
export function useTicketDocument(ref: ScopedTicketRef, detail: TicketDetail) {
  const { update, move } = useTicketActions();
  const [state, setState] = useState(() =>
    initialTicketDocument({ revision: detail.summary.revision, body: detail.body }),
  );
  const stateRef = useRef(state);
  const dispatch = useCallback((event: TicketDocumentEvent) => {
    stateRef.current = reduceTicketDocument(stateRef.current, event);
    setState(stateRef.current);
  }, []);
  // The newest summary from either the stream or a write's reply, which can arrive first.
  const latestRef = useRef(detail.summary);
  const noteSummary = useCallback((summary: TicketSummary) => {
    if (summary.revision >= latestRef.current.revision) latestRef.current = summary;
  }, []);
  const pendingUploadsRef = useRef(new Map<string, PendingTicketUpload>());
  const mountedRef = useRef(true);
  const queueRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    noteSummary(detail.summary);
    dispatch({ type: "serverChanged", revision: detail.summary.revision, body: detail.body });
  }, [detail.body, detail.summary, dispatch, noteSummary]);

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
      run: (expectedRevision: number) => Promise<WriteResult>,
    ): Promise<boolean> => {
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
              title: "The ticket changed before your edit saved",
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
      noteSummary(result.ticket);
      dispatch({ type: "writeLanded", revision: result.ticket.revision, claimed: result.claimed });
      return true;
    },
    [dispatch, noteSummary],
  );

  const writeUpdate = useCallback(
    (fields: (latest: TicketSummary) => FieldUpdate | null, withBody: boolean) =>
      enqueue(async (current) => {
        if (withBody && current.conflict) return false;
        if (withBody && !hasUnsavedBody(current)) return true;
        const fieldUpdate = fields(latestRef.current);
        if (fieldUpdate === null) return true;
        const sentBody = withBody ? current.text : null;
        const uploads =
          sentBody === null
            ? []
            : attachmentReferenceIds(sentBody).flatMap((id) => {
                const upload = pendingUploadsRef.current.get(id);
                return upload === undefined ? [] : [upload];
              });
        const landed = await write(sentBody, async (expectedRevision) => {
          const result = await update(ref, {
            ...fieldUpdate,
            expectedRevision,
            ...(sentBody === null ? {} : { body: sentBody }),
            ...(uploads.length > 0
              ? { attachments: uploads.map((upload) => upload.attachment) }
              : {}),
          });
          return result === null || result === TICKET_REVISION_CONFLICT
            ? result
            : { ticket: result.ticket, claimed: result.attachments };
        });
        if (landed) {
          for (const upload of uploads) {
            pendingUploadsRef.current.delete(upload.attachment.id);
            releaseAttachmentUpload(upload.localId);
          }
        }
        return landed;
      }),
    [enqueue, ref, update, write],
  );

  const saveBody = useCallback(() => {
    if (!hasUnsavedBody(stateRef.current) || stateRef.current.conflict) return;
    void writeUpdate(() => ({}), true);
  }, [writeUpdate]);

  /** Applies `next` to the newest labels, so back-to-back edits build on each other. */
  const saveLabels = useCallback(
    (next: (labels: ReadonlyArray<string>) => ReadonlyArray<string>) =>
      writeUpdate((latest) => {
        const labels = next(latest.labels);
        return labels.join("\n") === latest.labels.join("\n") ? null : { labels };
      }, false),
    [writeUpdate],
  );

  const saveFields = useCallback(
    (fields: Omit<FieldUpdate, "labels">) => writeUpdate(() => fields, false),
    [writeUpdate],
  );

  const setStatus = useCallback(
    (statusId: TicketStatusId) =>
      enqueue(() =>
        write(null, async (expectedRevision) => {
          const result = await move(ref, { expectedRevision, statusId });
          return result === null || result === TICKET_REVISION_CONFLICT
            ? result
            : { ticket: result, claimed: [] };
        }),
      ),
    [enqueue, move, ref, write],
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
    saveFields,
    saveLabels,
    setStatus,
  };
}
