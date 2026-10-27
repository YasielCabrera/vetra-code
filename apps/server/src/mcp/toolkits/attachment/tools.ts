import { McpAttachmentInput } from "./input.ts";
import {
  AttachmentCreateUploadUrlInput,
  McpAttachmentCreateUploadUrlResult,
  AttachmentDeleteInput,
  MessageId,
  RunId,
  ThreadId,
  OrchestrationV2RunStatus,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import { McpSchema, Tool, Toolkit } from "effect/ai";
import * as HttpServer from "effect/http/HttpServer";
import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../../config.ts";
import * as DocumentText from "../../../provider/DocumentText.ts";
import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    ServerConfig.ServerConfig,
    ServerSecretStore.ServerSecretStore,
    FileSystem.FileSystem,
    Crypto.Crypto,
  ],
};
const AttachmentUploadTool = Tool.make("t3_attachment_prepare_upload", {
  ...shared,
  dependencies: [...shared.dependencies, HttpServer.HttpServer],
  description:
    "Get a signed uploadUrl for this environment. POST exactly sizeBytes raw bytes before expiresAt (HTTP 204), then pass attachmentId as id to ticket/plan tools or t3_thread_send_attachments. Browser uploads use relativeUrl. Images: GIF/JPEG/PNG/WebP, 10 MiB each, 80 MiB total. Files/videos: 50 MiB each. Limit: 100 attachments per ticket/plan or 8 per thread send.",
  parameters: Schema.Struct({ upload: AttachmentCreateUploadUrlInput }),
  success: McpAttachmentCreateUploadUrlResult,
}).annotate(Tool.Destructive, true);
const AttachmentDiscardTool = Tool.make("t3_attachment_discard", {
  ...shared,
  description:
    "Discard a pending upload. Claimed thread, ticket and plan copies are never deleted by this operation.",
  parameters: AttachmentDeleteInput,
  success: Schema.Struct({}),
}).annotate(Tool.Destructive, true);
const AttachmentSendTool = Tool.make("t3_thread_send_attachments", {
  ...shared,
  dependencies: [...shared.dependencies, DocumentText.DocumentText],
  description:
    "Send uploaded attachments as a new message to a thread. No retry key. Target modes cannot exceed yours. Success does not mean the provider read them or finished.",
  parameters: Schema.Struct({
    threadId: Schema.optional(ThreadId),
    message: Schema.optional(Schema.String.check(Schema.isMaxLength(120000))),
    attachments: Schema.Array(McpAttachmentInput).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(8),
    ),
  }),
  success: Schema.Struct({
    threadId: ThreadId,
    messageId: MessageId,
    runId: RunId,
    status: OrchestrationV2RunStatus,
  }),
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.listedFor(["orchestration"]));
export const AttachmentToolkit = Toolkit.make(
  AttachmentUploadTool,
  AttachmentDiscardTool,
  AttachmentSendTool,
);
