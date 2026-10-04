import type { ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import type {
  EnvironmentId,
  TicketDetail,
  TicketPlan,
  TicketPlanWriteResult,
  TicketStatusId,
  TicketSummary,
  TicketUpdateInput,
  TicketWriteResult,
} from "@t3tools/contracts";
import { useCallback, useEffect, useRef } from "react";

import { TICKET_REVISION_CONFLICT, useTicketActions } from "../../hooks/useTicketActions";
import {
  type DocumentUpload,
  type DocumentWriteOutcome,
  useAutosavedDocument,
} from "./useAutosavedDocument";

type FieldUpdate = Pick<TicketUpdateInput, "title" | "labels" | "removeAttachmentIds">;

const withUploads = (uploads: ReadonlyArray<DocumentUpload>) =>
  uploads.length > 0 ? { attachments: uploads } : {};

const planWriteLanded = (
  result: TicketPlanWriteResult | typeof TICKET_REVISION_CONFLICT | null,
): DocumentWriteOutcome =>
  result === null || result === TICKET_REVISION_CONFLICT
    ? result
    : { revision: result.plan.revision, claimed: result.attachments };

/** The detail page's writes to one ticket: its description, title, labels, attachments and status. */
export function useTicketDocument(ref: ScopedTicketRef, detail: TicketDetail) {
  const { update, move } = useTicketActions();
  // The newest summary from either the stream or a write's reply, which can arrive first.
  const latestRef = useRef(detail.summary);
  const noteSummary = useCallback((summary: TicketSummary) => {
    if (summary.revision >= latestRef.current.revision) latestRef.current = summary;
  }, []);
  useEffect(() => noteSummary(detail.summary), [detail.summary, noteSummary]);

  const landed = useCallback(
    (result: TicketWriteResult | typeof TICKET_REVISION_CONFLICT | null): DocumentWriteOutcome => {
      if (result === null || result === TICKET_REVISION_CONFLICT) return result;
      noteSummary(result.ticket);
      return { revision: result.ticket.revision, claimed: result.attachments };
    },
    [noteSummary],
  );

  const doc = useAutosavedDocument({
    revision: detail.summary.revision,
    body: detail.body,
    writeBody: useCallback(
      async (expectedRevision, body, uploads) =>
        landed(await update(ref, { expectedRevision, body, ...withUploads(uploads) })),
      [landed, ref, update],
    ),
    fieldConflictTitle: "The ticket changed before your edit saved",
  });
  const { writeFields } = doc;

  /** Applies `next` to the newest labels, so back-to-back edits build on each other. */
  const saveLabels = useCallback(
    (next: (labels: ReadonlyArray<string>) => ReadonlyArray<string>) =>
      writeFields(() => {
        const latest = latestRef.current;
        const labels = next(latest.labels);
        if (labels.join("\n") === latest.labels.join("\n")) return null;
        return async (expectedRevision) => landed(await update(ref, { labels, expectedRevision }));
      }),
    [landed, ref, update, writeFields],
  );

  const saveFields = useCallback(
    (fields: Omit<FieldUpdate, "labels">) =>
      writeFields(
        () => async (expectedRevision) =>
          landed(await update(ref, { ...fields, expectedRevision })),
      ),
    [landed, ref, update, writeFields],
  );

  const setStatus = useCallback(
    (statusId: TicketStatusId) =>
      writeFields(() => async (expectedRevision) => {
        const result = await move(ref, { expectedRevision, statusId });
        if (result === null || result === TICKET_REVISION_CONFLICT) return result;
        noteSummary(result);
        return { revision: result.revision, claimed: [] };
      }),
    [move, noteSummary, ref, writeFields],
  );

  return { ...doc, saveFields, saveLabels, setStatus };
}

/** The plan page's writes to one plan: its body and title, against the plan's own revision. */
export function useTicketPlanDocument(environmentId: EnvironmentId, plan: TicketPlan) {
  const { updatePlan } = useTicketActions();
  const { planId } = plan.summary;

  const doc = useAutosavedDocument({
    revision: plan.summary.revision,
    body: plan.body,
    writeBody: useCallback(
      async (expectedRevision, body, uploads) =>
        planWriteLanded(
          await updatePlan(environmentId, {
            planId,
            expectedRevision,
            body,
            ...withUploads(uploads),
          }),
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
          planWriteLanded(await updatePlan(environmentId, { planId, expectedRevision, title })),
      ),
    [environmentId, planId, updatePlan, writeFields],
  );

  return { ...doc, saveTitle };
}
