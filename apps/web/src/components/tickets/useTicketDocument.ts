import type { ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import type {
  EnvironmentId,
  TicketDetail,
  TicketPlan,
  TicketPlanReviewStatus,
  TicketPlanStatus,
  TicketPlanSummary,
  TicketPlanWriteResult,
  TicketStatusId,
  TicketSummary,
  TicketUpdateInput,
  TicketWriteResult,
} from "@t3tools/contracts";
import { useCallback, useRef, useState } from "react";

import { useTicketActions } from "../../hooks/useTicketActions";
import { TICKET_REVISION_CONFLICT } from "./ticketDocument.logic";
import {
  type DocumentUpload,
  type DocumentWriteOutcome,
  useAutosavedDocument,
} from "./useAutosavedDocument";

type FieldUpdate = Pick<TicketUpdateInput, "title" | "labels" | "removeAttachmentIds">;

const withUploads = (uploads: ReadonlyArray<DocumentUpload>) =>
  uploads.length > 0 ? { attachments: uploads } : {};

function ticketOutcome(
  result: TicketWriteResult | typeof TICKET_REVISION_CONFLICT | null,
): DocumentWriteOutcome<TicketSummary> {
  if (result === null || result === TICKET_REVISION_CONFLICT) return result;
  return {
    summary: result.ticket,
    acknowledgement: { kind: "legacy", revision: result.ticket.revision },
    claimed: result.attachments,
  };
}

function planOutcome(
  result: TicketPlanWriteResult | typeof TICKET_REVISION_CONFLICT | null,
  purpose: "content" | "metadata",
): DocumentWriteOutcome<TicketPlanSummary> {
  if (result === null || result === TICKET_REVISION_CONFLICT) return result;
  return {
    summary: result.plan,
    acknowledgement:
      purpose === "metadata"
        ? { kind: "metadata" }
        : result.contentCommit === undefined
          ? { kind: "unverified" }
          : { kind: "commit", ...result.contentCommit },
    claimed: result.attachments,
  };
}

/** The detail page's writes to one ticket: its description, title, labels, attachments and status. */
export function useTicketDocument(ref: ScopedTicketRef, detail: TicketDetail) {
  const { update, move } = useTicketActions();
  const doc = useAutosavedDocument({
    summary: detail.summary,
    body: detail.body,
    writeBody: useCallback(
      async (expectedRevision, body, uploads) =>
        ticketOutcome(await update(ref, { expectedRevision, body, ...withUploads(uploads) })),
      [ref, update],
    ),
    fieldConflictTitle: "The ticket changed before your edit saved",
  });
  const { writeFields, readLatest } = doc;

  /** Applies `next` to the newest labels, so back-to-back edits build on each other. */
  const saveLabels = useCallback(
    (next: (labels: ReadonlyArray<string>) => ReadonlyArray<string>) =>
      writeFields(() => {
        const latest = readLatest();
        const labels = next(latest.labels);
        if (labels.join("\n") === latest.labels.join("\n")) return null;
        return async (expectedRevision) =>
          ticketOutcome(await update(ref, { labels, expectedRevision }));
      }),
    [readLatest, ref, update, writeFields],
  );

  const saveFields = useCallback(
    (fields: Omit<FieldUpdate, "labels">) =>
      writeFields(
        () => async (expectedRevision) =>
          ticketOutcome(await update(ref, { ...fields, expectedRevision })),
      ),
    [ref, update, writeFields],
  );

  const saveTitle = useCallback((title: string) => saveFields({ title }), [saveFields]);

  const setStatus = useCallback(
    (statusId: TicketStatusId) =>
      writeFields(() => async (expectedRevision) => {
        const result = await move(ref, { expectedRevision, statusId });
        if (result === null || result === TICKET_REVISION_CONFLICT) return result;
        return {
          summary: result,
          acknowledgement: { kind: "legacy", revision: result.revision },
          claimed: [],
        };
      }),
    [move, ref, writeFields],
  );

  return { ...doc, saveFields, saveLabels, saveTitle, setStatus };
}

export function useTicketPlanDocument(environmentId: EnvironmentId, plan: TicketPlan) {
  const { updatePlan } = useTicketActions();
  const { planId } = plan.summary;
  const doc = useAutosavedDocument<TicketPlanSummary>({
    summary: plan.summary,
    body: plan.body,
    writeBody: useCallback(
      async (expectedRevision, body, uploads) =>
        planOutcome(
          await updatePlan(environmentId, {
            planId,
            expectedRevision,
            body,
            ...withUploads(uploads),
          }),
          "content",
        ),
      [environmentId, planId, updatePlan],
    ),
    fieldConflictTitle: "The plan changed before your edit saved",
  });
  const { writeFields } = doc;

  const saveTitle = useCallback(
    (title: string) =>
      writeFields(
        () => async (expectedRevision) =>
          planOutcome(
            await updatePlan(environmentId, {
              planId,
              expectedRevision,
              title,
            }),
            "content",
          ),
      ),
    [environmentId, planId, updatePlan, writeFields],
  );

  const setStatus = useCallback(
    (status: TicketPlanStatus) =>
      writeFields(
        () => async (expectedRevision) =>
          planOutcome(
            await updatePlan(environmentId, { planId, expectedRevision, status }),
            "metadata",
          ),
      ),
    [environmentId, planId, updatePlan, writeFields],
  );

  const setReviewStatus = useCallback(
    (reviewStatus: TicketPlanReviewStatus, expectedRevision: number) =>
      writeFields(
        () => async () =>
          planOutcome(
            await updatePlan(environmentId, { planId, expectedRevision, reviewStatus }),
            "metadata",
          ),
        { expectedRevision },
      ),
    [environmentId, planId, updatePlan, writeFields],
  );

  return { ...doc, saveTitle, setStatus, setReviewStatus };
}

export function usePlanStatus(options: {
  readonly doc: ReturnType<typeof useTicketPlanDocument>;
  /** Saves the title draft; false when it did not save. */
  readonly commitTitle: () => Promise<boolean>;
  readonly uploading: boolean;
  readonly summary: Pick<TicketPlanSummary, "status" | "revision">;
  readonly onArchived: () => void;
}) {
  const { doc, commitTitle, uploading, summary, onArchived } = options;
  const [changing, setChanging] = useState(false);
  const changingRef = useRef(false);
  const setStatus = async (status: TicketPlanStatus) => {
    if (changingRef.current || uploading) return;
    changingRef.current = true;
    setChanging(true);
    try {
      if (status === "archived" && (!(await commitTitle()) || !(await doc.flush()))) return;
      if (!(await doc.setStatus(status))) return;
      if (status === "archived") onArchived();
      else await doc.flush();
    } finally {
      changingRef.current = false;
      setChanging(false);
    }
  };
  const setReviewStatus = async (reviewStatus: TicketPlanReviewStatus) => {
    if (changingRef.current || uploading) return;
    changingRef.current = true;
    setChanging(true);
    const displayedRevision =
      summary.status === "archived" ? summary.revision : doc.readBase().revision;
    try {
      const reviewedRevision =
        reviewStatus === "ready" && summary.status !== "archived"
          ? await doc.flushReviewed(commitTitle)
          : displayedRevision;
      if (reviewedRevision === null) return;
      await doc.setReviewStatus(reviewStatus, reviewedRevision);
    } finally {
      changingRef.current = false;
      setChanging(false);
    }
  };
  return { changing, setStatus, setReviewStatus };
}
