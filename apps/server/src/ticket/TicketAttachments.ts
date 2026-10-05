import {
  ChatImageAttachment,
  ChatFileAttachment,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  TicketError,
  TICKET_BODY_MAX_CHARS,
  getProviderAttachmentLimitError,
  isProviderSendTurnSupportedImageMimeType,
  type AgentTicketLocalAttachment,
  type TicketCreateInput,
  type TicketId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Mime from "effect/unstable/http/Mime";

import { openMediaFile, statMediaFile, streamMediaFile } from "../assets/MediaFile.ts";
import { writeAttachmentFile } from "../assets/writeAttachmentFile.ts";
import {
  attachmentFileExtension,
  createAttachmentId,
  resolveAttachmentPath,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import {
  attachmentIsPendingUpload,
  claimPendingAttachments,
  releaseClaimedAttachments,
} from "../orchestration-v2/AttachmentClaims.ts";

type PendingUpload = NonNullable<TicketCreateInput["attachments"]>[number];
type TicketAttachmentSource = PendingUpload | AgentTicketLocalAttachment;
export type WithAttachmentSources<Input> = Omit<Input, "attachments"> & {
  readonly attachments?: ReadonlyArray<TicketAttachmentSource> | undefined;
};

const decodeLocalAttachment = Schema.decodeUnknownEffect(
  Schema.Union([
    ChatImageAttachment.pipe(
      Schema.fieldsAssign({ name: Schema.toType(ChatImageAttachment.fields.name) }),
    ),
    ChatFileAttachment.pipe(
      Schema.fieldsAssign({ name: Schema.toType(ChatFileAttachment.fields.name) }),
    ),
  ]),
);

const attachmentReferences = /vetra-attachment:\/\/([^\s()[\]<>"'`]+)/g;

const referenceId = (token: string) => token.replace(/[.,;:!?]+$/, "");

const rewriteAttachmentReferences = (body: string, bindings: ReadonlyMap<string, string>) =>
  body.replace(attachmentReferences, (reference, token: string) => {
    const id = referenceId(token);
    const storedId = bindings.get(id);
    return storedId === undefined
      ? reference
      : `vetra-attachment://${storedId}${token.slice(id.length)}`;
  });

export const attachmentReferenceIds = (body: string) =>
  new Set(
    Array.from(body.matchAll(attachmentReferences), (match) =>
      referenceId(match[0].slice("vetra-attachment://".length)),
    ),
  );

const escapeLabel = (name: string) =>
  name
    .replace(/[\\[\]()*_`!<>]/g, "\\$&")
    .replace(/\r/g, "&#13;")
    .replace(/\n/g, "&#10;");

export const attachmentBody = Effect.fn("TicketAttachments.body")(function* (
  body: string,
  claim: Pick<ClaimedTicketAttachments, "bindings" | "localAttachments">,
  appendLocal: boolean,
) {
  let result = rewriteAttachmentReferences(body, claim.bindings);
  if (appendLocal) {
    const referenced = attachmentReferenceIds(result);
    const links = claim.localAttachments
      .filter((attachment) => !referenced.has(attachment.id))
      .map(
        (attachment) =>
          `${attachment.type === "image" || attachment.mimeType.startsWith("video/") ? "!" : ""}[${escapeLabel(attachment.name)}](vetra-attachment://${attachment.id})`,
      );
    if (links.length > 0) result += `${result.length > 0 ? "\n\n" : ""}${links.join("\n\n")}`;
  }
  if (result.length > TICKET_BODY_MAX_CHARS) {
    return yield* new TicketError({
      message: "The final attachment references exceed the 100,000-character body limit.",
    });
  }
  return result;
});

type ClaimedTicketAttachments = Effect.Success<ReturnType<typeof claimTicketAttachments>>;

export const claimTicketAttachments = Effect.fn("TicketAttachments.claim")(function* (
  ticketId: TicketId,
  sources: ReadonlyArray<TicketAttachmentSource>,
) {
  const config = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const claimedPaths: string[] = [];
  let committed = false;
  yield* Effect.addFinalizer(() =>
    committed ? Effect.void : releaseClaimedAttachments(claimedPaths),
  );
  const bindings = new Map<string, string>();
  const references = new Set<string>();
  if (sources.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS)
    return yield* new TicketError({ message: "You can attach up to 100 files per write." });
  for (const source of sources) {
    const reference = "path" in source ? source.ref : source.id;
    if (reference === undefined) continue;
    if (references.has(reference)) {
      return yield* new TicketError({ message: `Duplicate attachment reference '${reference}'.` });
    }
    references.add(reference);
  }
  const claimed = yield* Effect.scoped(
    Effect.gen(function* () {
      const prepared = yield* Effect.forEach(sources, (source) =>
        Effect.gen(function* () {
          if (!("path" in source)) {
            if (!attachmentIsPendingUpload(source)) {
              return yield* new TicketError({
                message: "Ticket attachments must be new uploads or local file paths.",
              });
            }
            return { kind: "pending" as const, source, attachment: source };
          }
          if (!path.isAbsolute(source.path)) {
            return yield* new TicketError({
              message: `Attachment '${source.path}' needs an absolute file path on this server environment.`,
            });
          }
          const canonicalPath = yield* fileSystem
            .realPath(source.path)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new TicketError({ message: `Cannot read attachment '${source.path}'.`, cause }),
              ),
            );
          const file = yield* openMediaFile(canonicalPath).pipe(
            Effect.mapError(
              (cause) =>
                new TicketError({
                  message: `Cannot open attachment '${source.path}' for reading.`,
                  cause,
                }),
            ),
          );
          if (file === null)
            return yield* new TicketError({
              message: `Attachment '${source.path}' must be a regular file.`,
            });
          const sizeBytes = Number(file.info.size);
          if (sizeBytes === 0)
            return yield* new TicketError({ message: `Attachment '${source.path}' is empty.` });
          const name = path.basename(source.path);
          const mimeType = Option.getOrElse(
            Mime.getType(name),
            () => "application/octet-stream",
          ).toLowerCase();
          const type = isProviderSendTurnSupportedImageMimeType(mimeType) ? "image" : "file";
          const id = createAttachmentId(
            `ticket-${ticketId}`,
            type === "file" ? attachmentFileExtension(name) : undefined,
          );
          if (id === null)
            return yield* new TicketError({
              message: "Could not allocate a ticket attachment id.",
            });
          const attachment = yield* decodeLocalAttachment({
            id,
            type,
            name,
            mimeType,
            sizeBytes,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new TicketError({
                  message: `Attachment '${source.path}' exceeds the supported name, type, or size limits (images 10 MiB, files 50 MiB).`,
                  cause,
                }),
            ),
          );
          return { kind: "local" as const, source, file, attachment };
        }),
      );
      const limitError = getProviderAttachmentLimitError(
        prepared.map((source) => source.attachment),
      );
      if (limitError !== undefined) return yield* new TicketError({ message: limitError });
      return yield* Effect.forEach(prepared, (source) =>
        Effect.gen(function* () {
          if (source.kind === "pending") {
            const result = yield* claimPendingAttachments({
              threadId: `ticket-${ticketId}`,
              attachments: [source.attachment],
            }).pipe(
              Effect.tap((claim) => Effect.sync(() => claimedPaths.push(...claim.claimedPaths))),
              Effect.uninterruptible,
              Effect.mapError((cause) => new TicketError({ message: cause.message, cause })),
            );
            const stored = result.attachments[0];
            if (stored === undefined)
              return yield* Effect.die(new Error("A pending claim did not return its attachment."));
            const attachment = { ...source.attachment, id: stored.id, mimeType: stored.mimeType };
            bindings.set(source.source.id, attachment.id);
            return { kind: "pending" as const, attachment, pendingId: source.source.id };
          }
          const destinationPath = resolveAttachmentPath({
            attachmentsDir: config.attachmentsDir,
            attachment: source.attachment,
          });
          if (destinationPath === null)
            return yield* new TicketError({
              message: "Could not resolve the ticket attachment path.",
            });
          const stream = streamMediaFile(source.file, 0n, source.file.info.size + 1n, {
            closeOnDone: false,
          });
          if (stream === null)
            return yield* new TicketError({
              message: `Attachment '${source.source.path}' is too large to read.`,
            });
          claimedPaths.push(destinationPath);
          yield* writeAttachmentFile({
            destinationPath,
            expectedBytes: source.attachment.sizeBytes,
            stream,
          }).pipe(
            Effect.mapError(
              (cause) =>
                new TicketError({
                  message: `Could not copy attachment '${source.source.path}'.`,
                  cause,
                }),
            ),
          );
          const after = yield* statMediaFile(source.source.path, source.file).pipe(
            Effect.mapError(
              (cause) =>
                new TicketError({
                  message: `Could not verify attachment '${source.source.path}'.`,
                  cause,
                }),
            ),
          );
          if (after.size !== source.file.info.size)
            return yield* new TicketError({
              message: `Attachment '${source.source.path}' changed size while being copied.`,
            });
          if (source.source.ref !== undefined)
            bindings.set(source.source.ref, source.attachment.id);
          return { kind: "local" as const, attachment: source.attachment };
        }),
      );
    }),
  );
  return {
    attachments: claimed.map((source) => source.attachment),
    mapping: claimed.flatMap((source) =>
      source.kind === "pending"
        ? [{ pendingId: source.pendingId, attachmentId: source.attachment.id }]
        : [],
    ),
    bindings,
    localAttachments: claimed.flatMap((source) =>
      source.kind === "local" ? [source.attachment] : [],
    ),
    markCommitted: Effect.sync(() => {
      committed = true;
    }),
  };
});
