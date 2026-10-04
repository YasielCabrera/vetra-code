import type { EnvironmentTicket, ScopedTicketRef } from "@t3tools/client-runtime/state/tickets";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  TicketCreateInput,
  TicketGitHubSource,
  TicketGitHubSourceRef,
  TicketLinkKind,
  TicketLinkTarget,
  TicketMoveInput,
  TicketPlanComment,
  TicketPlanCommentInput,
  TicketPlanCreateInput,
  TicketPlanId,
  TicketPlanSummary,
  TicketPlanUpdateInput,
  TicketPlanWriteResult,
  TicketStatusDefinition,
  TicketStatusId,
  TicketStatusSet,
  TicketStatusUpsertInput,
  TicketSummary,
  TicketUpdateInput,
  TicketWriteResult,
} from "@t3tools/contracts";
import { keyBetween } from "@t3tools/shared/fractionalIndex";
import { useCallback, useMemo } from "react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { TICKET_REVISION_CONFLICT } from "../components/tickets/ticketDocument.logic";
import { formatTicketRef } from "../components/tickets/ticketRefs";
import { readLocalApi } from "../localApi";
import { readTicketBoard, ticketEnvironment } from "../state/tickets";
import { useAtomCommand } from "../state/use-atom-command";

function isRevisionConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    (error._tag === "TicketRevisionConflictError" ||
      error._tag === "TicketPlanRevisionConflictError")
  );
}

/**
 * Asks before a status change would close or reopen a GitHub ticket's issue. True for local
 * tickets, for hidden ones (the server leaves their issue alone), and for changes that leave the
 * issue's state as it is.
 */
export async function confirmGitHubStateChange(
  ticket: EnvironmentTicket,
  to: TicketStatusDefinition,
): Promise<boolean> {
  if (ticket.kind !== "github" || ticket.hiddenAt !== null) return true;
  const closing = to.category === "closed";
  if ((ticket.github.state === "closed") === closing) return true;
  const issue = `${ticket.github.repository}#${ticket.github.number}`;
  return (
    (await readLocalApi()?.dialogs.confirm(
      `Move ${formatTicketRef(ticket)} to ${to.name}?\nThis ${closing ? "closes" : "reopens"} ${issue} on GitHub.`,
    )) ?? true
  );
}

export function useTicketActions() {
  const options = { reportFailure: false } as const;
  const createTicket = useAtomCommand(ticketEnvironment.create, options);
  const updateTicket = useAtomCommand(ticketEnvironment.update, options);
  const moveTicket = useAtomCommand(ticketEnvironment.move, options);
  const deleteTicket = useAtomCommand(ticketEnvironment.delete, options);
  const linkTicket = useAtomCommand(ticketEnvironment.link, options);
  const unlinkTicket = useAtomCommand(ticketEnvironment.unlink, options);
  const commentTicket = useAtomCommand(ticketEnvironment.comment, options);
  const upsertTicketStatus = useAtomCommand(ticketEnvironment.upsertStatus, options);
  const reorderTicketStatuses = useAtomCommand(ticketEnvironment.reorderStatuses, options);
  const deleteTicketStatus = useAtomCommand(ticketEnvironment.deleteStatus, options);
  const setTicketHidden = useAtomCommand(ticketEnvironment.setHidden, options);
  const upsertSource = useAtomCommand(ticketEnvironment.upsertGitHubSource, options);
  const removeSource = useAtomCommand(ticketEnvironment.removeGitHubSource, options);
  const refreshIssue = useAtomCommand(ticketEnvironment.refreshGitHubIssue, options);
  const syncSource = useAtomCommand(ticketEnvironment.syncGitHubSource, options);
  const createTicketPlan = useAtomCommand(ticketEnvironment.createPlan, options);
  const updateTicketPlan = useAtomCommand(ticketEnvironment.updatePlan, options);
  const deleteTicketPlan = useAtomCommand(ticketEnvironment.deletePlan, options);
  const addTicketPlanComment = useAtomCommand(ticketEnvironment.addPlanComment, options);
  const reopenTicketPlanComment = useAtomCommand(ticketEnvironment.reopenPlanComment, options);
  const deleteTicketPlanComment = useAtomCommand(ticketEnvironment.deletePlanComment, options);

  const settle = useCallback(
    <A>(title: string, result: AtomCommandResult<A, unknown>): A | null => {
      if (result._tag === "Success") return result.value;
      if (isAtomCommandInterrupted(result)) return null;
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title,
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return null;
    },
    [],
  );

  const create = useCallback(
    async (environmentId: EnvironmentId, input: TicketCreateInput) =>
      settle("Could not create the ticket", await createTicket({ environmentId, input })),
    [createTicket, settle],
  );

  /** A stale `expectedRevision` resolves to `TICKET_REVISION_CONFLICT` without a toast. */
  const update = useCallback(
    async (
      ref: ScopedTicketRef,
      input: Omit<TicketUpdateInput, "ticketId">,
    ): Promise<TicketWriteResult | typeof TICKET_REVISION_CONFLICT | null> => {
      const result = await updateTicket({
        environmentId: ref.environmentId,
        input: { ...input, ticketId: ref.ticketId },
      });
      if (result._tag === "Failure" && isRevisionConflict(squashAtomCommandFailure(result))) {
        return TICKET_REVISION_CONFLICT;
      }
      return settle("Could not save the ticket", result);
    },
    [settle, updateTicket],
  );

  /**
   * Moves the ticket to `sortKey` in `statusId`, or without one to the end, where a newly arrived
   * ticket goes. A stale `expectedRevision` resolves to `TICKET_REVISION_CONFLICT` without a toast.
   */
  const move = useCallback(
    async (
      ref: ScopedTicketRef,
      input: Omit<TicketMoveInput, "ticketId" | "sortKey"> & { readonly sortKey?: string },
    ): Promise<TicketSummary | typeof TICKET_REVISION_CONFLICT | null> => {
      const sortKey =
        input.sortKey ??
        keyBetween(
          readTicketBoard()
            .tickets.filter(
              (other) =>
                other.environmentId === ref.environmentId &&
                other.statusId === input.statusId &&
                other.id !== ref.ticketId,
            )
            .reduce<string | null>(
              (last, other) => (last === null || other.sortKey > last ? other.sortKey : last),
              null,
            ),
          null,
        );
      const result = await moveTicket({
        environmentId: ref.environmentId,
        input: { ...input, ticketId: ref.ticketId, sortKey },
      });
      if (result._tag === "Failure" && isRevisionConflict(squashAtomCommandFailure(result))) {
        return TICKET_REVISION_CONFLICT;
      }
      return settle("Could not change the status", result);
    },
    [moveTicket, settle],
  );

  const confirmAndDelete = useCallback(
    async (ticket: EnvironmentTicket) => {
      const confirmed =
        (await readLocalApi()?.dialogs.confirm(
          `Delete ${formatTicketRef(ticket)} "${ticket.title}"?\nIts links, comments and attachments go with it.`,
          { variant: "destructive" },
        )) ?? true;
      if (!confirmed) return false;
      const result = await deleteTicket({
        environmentId: ticket.environmentId,
        input: { ticketId: ticket.id },
      });
      return settle("Could not delete the ticket", result) !== null;
    },
    [deleteTicket, settle],
  );

  const link = useCallback(
    async (ref: ScopedTicketRef, target: TicketLinkTarget) =>
      settle(
        "Could not add the link",
        await linkTicket({
          environmentId: ref.environmentId,
          input: { ticketId: ref.ticketId, target },
        }),
      ),
    [linkTicket, settle],
  );

  const unlink = useCallback(
    async (ref: ScopedTicketRef, kind: TicketLinkKind, targetKey: string) =>
      settle(
        "Could not remove the link",
        await unlinkTicket({
          environmentId: ref.environmentId,
          input: { ticketId: ref.ticketId, kind, targetKey },
        }),
      ),
    [settle, unlinkTicket],
  );

  const comment = useCallback(
    async (ref: ScopedTicketRef, body: string) =>
      settle(
        "Could not add the comment",
        await commentTicket({
          environmentId: ref.environmentId,
          input: { ticketId: ref.ticketId, body },
        }),
      ),
    [commentTicket, settle],
  );

  const upsertStatus = useCallback(
    async (
      environmentId: EnvironmentId,
      input: TicketStatusUpsertInput,
    ): Promise<TicketStatusSet | null> =>
      settle("Could not save the status", await upsertTicketStatus({ environmentId, input })),
    [settle, upsertTicketStatus],
  );

  const reorderStatuses = useCallback(
    async (environmentId: EnvironmentId, statusIds: ReadonlyArray<TicketStatusId>) =>
      settle(
        "Could not reorder the statuses",
        await reorderTicketStatuses({ environmentId, input: { statusIds } }),
      ),
    [reorderTicketStatuses, settle],
  );

  const deleteStatus = useCallback(
    async (environmentId: EnvironmentId, statusId: TicketStatusId, reassignTo: TicketStatusId) =>
      settle(
        "Could not delete the status",
        await deleteTicketStatus({ environmentId, input: { statusId, reassignTo } }),
      ),
    [deleteTicketStatus, settle],
  );

  const setHidden = useCallback(
    async (ref: ScopedTicketRef, hidden: boolean) =>
      settle(
        hidden ? "Could not stop tracking the issue" : "Could not track the issue again",
        await setTicketHidden({
          environmentId: ref.environmentId,
          input: { ticketId: ref.ticketId, hidden },
        }),
      ),
    [setTicketHidden, settle],
  );

  const refreshGitHubIssue = useCallback(
    async (ref: ScopedTicketRef) =>
      settle(
        "Could not refresh the issue",
        await refreshIssue({ environmentId: ref.environmentId, input: { ticketId: ref.ticketId } }),
      ),
    [refreshIssue, settle],
  );

  /** A sync that reached the server but not GitHub still resolves; its error is on the source. */
  const syncGitHubSource = useCallback(
    async (
      environmentId: EnvironmentId,
      ref: TicketGitHubSourceRef,
    ): Promise<TicketGitHubSource | null> => {
      const source = settle(
        `Could not sync ${ref.repository}`,
        await syncSource({ environmentId, input: ref }),
      );
      if (source?.lastError != null) {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: `Could not sync ${ref.repository}`,
            description: source.lastError,
          }),
        );
      }
      return source;
    },
    [settle, syncSource],
  );

  const addGitHubSource = useCallback(
    async (environmentId: EnvironmentId, ref: TicketGitHubSourceRef) => {
      const added = settle(
        `Could not add ${ref.repository}`,
        await upsertSource({ environmentId, input: { ...ref, enabled: true } }),
      );
      if (added !== null) await syncGitHubSource(environmentId, ref);
      return added;
    },
    [settle, syncGitHubSource, upsertSource],
  );

  const setGitHubSourceEnabled = useCallback(
    async (environmentId: EnvironmentId, ref: TicketGitHubSourceRef, enabled: boolean) =>
      settle(
        `Could not update ${ref.repository}`,
        await upsertSource({ environmentId, input: { ...ref, enabled } }),
      ),
    [settle, upsertSource],
  );

  const removeGitHubSource = useCallback(
    async (environmentId: EnvironmentId, ref: TicketGitHubSourceRef, deleteCache: boolean) =>
      settle(
        `Could not remove ${ref.repository}`,
        await removeSource({ environmentId, input: { ...ref, deleteCache } }),
      ),
    [removeSource, settle],
  );

  const createPlan = useCallback(
    async (environmentId: EnvironmentId, input: TicketPlanCreateInput) =>
      settle("Could not create the plan", await createTicketPlan({ environmentId, input })),
    [createTicketPlan, settle],
  );

  /** A stale `expectedRevision` resolves to `TICKET_REVISION_CONFLICT` without a toast. */
  const updatePlan = useCallback(
    async (
      environmentId: EnvironmentId,
      input: TicketPlanUpdateInput,
    ): Promise<TicketPlanWriteResult | typeof TICKET_REVISION_CONFLICT | null> => {
      const result = await updateTicketPlan({ environmentId, input });
      if (result._tag === "Failure" && isRevisionConflict(squashAtomCommandFailure(result))) {
        return TICKET_REVISION_CONFLICT;
      }
      return settle(
        input.status === "archived"
          ? "Could not archive the plan"
          : input.status === "active"
            ? "Could not restore the plan"
            : input.resolveCommentIds !== undefined
              ? "Could not resolve the comment"
              : "Could not save the plan",
        result,
      );
    },
    [settle, updateTicketPlan],
  );

  const confirmDeletePlan = useCallback(
    async (plan: TicketPlanSummary) =>
      (await readLocalApi()?.dialogs.confirm(
        `Delete ${plan.ref} "${plan.title}"?\nIts comments go with it.`,
        { variant: "destructive" },
      )) ?? true,
    [],
  );

  const deletePlan = useCallback(
    async (environmentId: EnvironmentId, planId: TicketPlanId) =>
      settle(
        "Could not delete the plan",
        await deleteTicketPlan({ environmentId, input: { planId } }),
      ) !== null,
    [deleteTicketPlan, settle],
  );

  const addPlanComment = useCallback(
    async (environmentId: EnvironmentId, input: TicketPlanCommentInput) =>
      settle(
        input.parentCommentId === undefined ? "Could not add the comment" : "Could not reply",
        await addTicketPlanComment({ environmentId, input }),
      ),
    [addTicketPlanComment, settle],
  );

  const reopenPlanComment = useCallback(
    async (environmentId: EnvironmentId, planId: TicketPlanId, comment: TicketPlanComment) =>
      settle(
        "Could not reopen the comment",
        await reopenTicketPlanComment({ environmentId, input: { planId, commentId: comment.id } }),
      ),
    [reopenTicketPlanComment, settle],
  );

  const confirmAndDeletePlanComment = useCallback(
    async (environmentId: EnvironmentId, planId: TicketPlanId, comment: TicketPlanComment) => {
      const confirmed =
        (await readLocalApi()?.dialogs.confirm(
          comment.parentId === null
            ? "Delete this comment?\nIts replies go with it."
            : "Delete this reply?",
          { variant: "destructive" },
        )) ?? true;
      if (!confirmed) return false;
      const result = await deleteTicketPlanComment({
        environmentId,
        input: { planId, commentId: comment.id },
      });
      return settle("Could not delete the comment", result) !== null;
    },
    [deleteTicketPlanComment, settle],
  );

  return useMemo(
    () => ({
      create,
      update,
      move,
      confirmAndDelete,
      link,
      unlink,
      comment,
      upsertStatus,
      reorderStatuses,
      deleteStatus,
      setHidden,
      syncGitHubSource,
      refreshGitHubIssue,
      addGitHubSource,
      setGitHubSourceEnabled,
      removeGitHubSource,
      createPlan,
      updatePlan,
      confirmDeletePlan,
      deletePlan,
      addPlanComment,
      reopenPlanComment,
      confirmAndDeletePlanComment,
    }),
    [
      addGitHubSource,
      addPlanComment,
      comment,
      confirmAndDelete,
      confirmAndDeletePlanComment,
      confirmDeletePlan,
      create,
      createPlan,
      deletePlan,
      deleteStatus,
      link,
      move,
      removeGitHubSource,
      reopenPlanComment,
      reorderStatuses,
      setGitHubSourceEnabled,
      setHidden,
      syncGitHubSource,
      refreshGitHubIssue,
      unlink,
      update,
      updatePlan,
      upsertStatus,
    ],
  );
}
