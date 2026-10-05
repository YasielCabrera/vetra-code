import { type ChatAttachment, MessageId, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as HttpServer from "effect/unstable/http/HttpServer";
import * as Upload from "../../../assets/AttachmentUpload.ts";
import * as Claims from "../../../orchestration-v2/AttachmentClaims.ts";
import * as ThreadMessageIntake from "../../../orchestration-v2/ThreadMessageIntake.ts";
import {
  newCommandId,
  readMutationCaller,
  readWritableThread,
  unavailable,
} from "../../threadAccess.ts";
import { AttachmentToolkit } from "./tools.ts";
import { providerHttpOrigin } from "../../httpOrigin.ts";

export function resolveAttachmentReferences(
  requested: ReadonlyArray<ChatAttachment>,
  stored: ReadonlyArray<ChatAttachment>,
) {
  const owned = new Map(stored.map((attachment) => [attachment.id, attachment]));
  return Effect.forEach(requested, (attachment) => {
    const canonical = Claims.attachmentIsPendingUpload(attachment)
      ? attachment
      : owned.get(attachment.id);
    return canonical === undefined
      ? Effect.fail(
          new OrchestratorMcpFailure({
            code: "invalid_request",
            message: "Attachments must be pending uploads or already belong to the target thread.",
          }),
        )
      : Effect.succeed(canonical);
  });
}

export const AttachmentHandlersLive = AttachmentToolkit.toLayer({
  t3_attachment_prepare_upload: (input) =>
    Effect.gen(function* () {
      yield* readMutationCaller();
      const httpServer = yield* HttpServer.HttpServer;
      const origin = providerHttpOrigin(httpServer.address);
      if (Result.isFailure(origin)) {
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: origin.failure.message,
        });
      }
      const issued = yield* Upload.issueAttachmentUploadUrl(input.upload).pipe(
        Effect.mapError(unavailable),
      );
      return { ...issued, uploadUrl: new URL(issued.relativeUrl, origin.success).href };
    }),
  t3_attachment_discard: (input) =>
    Effect.gen(function* () {
      yield* readMutationCaller();
      yield* Upload.deletePendingAttachment(input.attachmentId);
      return {};
    }),
  t3_thread_send_attachments: (input) =>
    Effect.gen(function* () {
      const { caller, projection, scope } = yield* readWritableThread(input.threadId, ["messages"]);
      if (projection.thread.archivedAt !== null)
        return yield* new OrchestratorMcpFailure({
          code: "invalid_request",
          message: "Unarchive the target thread before sending attachments.",
        });
      const attachments = yield* resolveAttachmentReferences(
        input.attachments,
        projection.messages.flatMap((message) => message.attachments),
      );
      const commandId = yield* newCommandId();
      const messageId = MessageId.make(commandId);
      const result = yield* ThreadMessageIntake.sendToThread({
        projectId: caller.projectId,
        threadId: projection.thread.id,
        commandId,
        messageId,
        senderThreadId: scope.threadId,
        text: input.message ?? "",
        attachments,
        mode: "auto",
        createdBy: "agent",
        creationSource: "mcp",
      }).pipe(
        Effect.mapError((error) =>
          error._tag === "AttachmentClaimError"
            ? new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message })
            : unavailable(),
        ),
      );
      return {
        threadId: projection.thread.id,
        messageId,
        runId: result.run.id,
        status: result.run.status,
      };
    }),
});
