import {
  fileAttachmentTooLargeMessage,
  formatAttachmentSize,
} from "@t3tools/client-runtime/state/attachments";
import {
  type ChatFileAttachment,
  type ChatImageAttachment,
  type EnvironmentId,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES,
  type TicketAttachment,
} from "@t3tools/contracts";
import { FileIcon, XIcon } from "lucide-react";
import { useMemo } from "react";

import { useAssetUrlState } from "../../assets/assetUrls";
import {
  awaitAttachmentUploads,
  readAttachmentUpload,
  releaseAttachmentUpload,
  startAttachmentUpload,
} from "../../lib/attachmentUploadQueue";
import { attachmentReferenceMarkdown } from "../../lib/attachmentReferences";
import { prepareImageForAttachment } from "../../lib/imageCompression";
import { randomUUID } from "../../lib/utils";
import { ChatMarkdownAssetImage, type ChatMarkdownAttachmentReference } from "../ChatMarkdown";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

/** A finished upload the server has not claimed yet, named in the body by its pending id. */
export interface PendingTicketUpload {
  /** The upload queue's key, released once the ticket has claimed the file. */
  readonly localId: string;
  readonly attachment: ChatImageAttachment | ChatFileAttachment;
}

type TicketUploadResult =
  | { readonly status: "uploaded"; readonly upload: PendingTicketUpload; readonly markdown: string }
  | { readonly status: "failed"; readonly message: string };

const isSupportedImage = (file: File) =>
  (PROVIDER_SEND_TURN_SUPPORTED_IMAGE_MIME_TYPES as ReadonlyArray<string>).includes(file.type);

async function uploadTicketFile(
  environmentId: EnvironmentId,
  file: File,
): Promise<TicketUploadResult> {
  const localId = randomUUID();
  let source: Parameters<typeof startAttachmentUpload>[0]["image"];
  if (isSupportedImage(file)) {
    const prepared = await prepareImageForAttachment(file, PROVIDER_SEND_TURN_MAX_IMAGE_BYTES);
    if (!prepared.ok) {
      return { status: "failed", message: `'${file.name}' could not be attached as an image.` };
    }
    source = {
      type: "image",
      id: localId,
      name: prepared.file.name || "image",
      mimeType: prepared.file.type,
      sizeBytes: prepared.file.size,
      previewUrl: URL.createObjectURL(prepared.file),
      file: prepared.file,
    };
  } else {
    if (file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES) {
      return {
        status: "failed",
        message: fileAttachmentTooLargeMessage(file.name, PROVIDER_SEND_TURN_MAX_FILE_BYTES),
      };
    }
    if (file.size === 0) return { status: "failed", message: `'${file.name}' is empty.` };
    source = {
      type: "file",
      id: localId,
      name: file.name || "file",
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      file,
    };
  }
  startAttachmentUpload({ environmentId, image: source });
  await awaitAttachmentUploads([localId]);
  const upload = readAttachmentUpload(localId);
  if (source.type === "image") URL.revokeObjectURL(source.previewUrl);
  if (upload?.status !== "ready") {
    releaseAttachmentUpload(localId);
    return { status: "failed", message: `'${source.name}' did not finish uploading.` };
  }
  const attachment: ChatImageAttachment | ChatFileAttachment =
    source.type === "image"
      ? {
          type: "image",
          id: upload.attachmentId,
          name: source.name,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
        }
      : {
          type: "file",
          id: upload.attachmentId,
          name: source.name,
          mimeType: source.mimeType,
          sizeBytes: source.sizeBytes,
        };
  return {
    status: "uploaded",
    upload: { localId, attachment },
    markdown: attachmentReferenceMarkdown({
      attachmentId: upload.attachmentId,
      name: source.name,
      embed: source.type === "image" || source.mimeType.startsWith("video/"),
    }),
  };
}

/**
 * Uploads pasted or dropped files, toasting the ones that failed; resolves to their markdown.
 * `keep` takes each finished upload, or returns false when its form is gone, which releases it.
 */
export async function uploadTicketFiles(
  environmentId: EnvironmentId,
  files: ReadonlyArray<File>,
  keep: (upload: PendingTicketUpload) => boolean,
): Promise<ReadonlyArray<string>> {
  const results = await Promise.all(files.map((file) => uploadTicketFile(environmentId, file)));
  const snippets: string[] = [];
  for (const result of results) {
    if (result.status === "uploaded") {
      if (keep(result.upload)) snippets.push(result.markdown);
      else releaseAttachmentUpload(result.upload.localId);
    } else {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not attach a file",
          description: result.message,
        }),
      );
    }
  }
  return snippets;
}

function attachmentResource(attachment: TicketAttachment) {
  return {
    _tag: "attachment" as const,
    attachmentId: attachment.id,
    ...(attachment.name.trim().length > 0 ? { fileName: attachment.name } : {}),
    ...(attachment.mimeType.trim().length > 0 ? { mimeType: attachment.mimeType } : {}),
  };
}

export function TicketAttachmentChip(props: {
  readonly environmentId: EnvironmentId;
  readonly attachment: TicketAttachment;
  readonly onRemove?: (() => void) | undefined;
}) {
  const resource = useMemo(() => attachmentResource(props.attachment), [props.attachment]);
  const url = useAssetUrlState(props.environmentId, resource);
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border border-border/70 bg-muted/30 py-0.5 ps-2 pe-1 align-middle text-xs">
      <FileIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      <a
        href={url._tag === "Success" ? url.url : undefined}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 truncate text-foreground no-underline hover:underline"
      >
        {props.attachment.name}
      </a>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {formatAttachmentSize(props.attachment.sizeBytes)}
      </span>
      {props.onRemove ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Remove ${props.attachment.name}`}
          onClick={props.onRemove}
        >
          <XIcon aria-hidden />
        </Button>
      ) : null}
    </span>
  );
}

/**
 * How a ticket body draws `vetra-attachment://` references: images and videos inline through
 * signed asset URLs, everything else as a file chip, and a reference to a file the ticket no
 * longer holds as its plain label.
 */
export function TicketAttachmentReference(props: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<TicketAttachment>;
  readonly reference: ChatMarkdownAttachmentReference;
}) {
  const attachment = props.attachments.find(
    (candidate) => candidate.id === props.reference.attachmentId,
  );
  const resource = useMemo(
    () => (attachment === undefined ? null : attachmentResource(attachment)),
    [attachment],
  );
  if (attachment === undefined || resource === null) {
    return <span className="text-muted-foreground">{props.reference.label}</span>;
  }
  const isVideo = attachment.mimeType.startsWith("video/");
  if (props.reference.embed && (attachment.type === "image" || isVideo)) {
    return (
      <ChatMarkdownAssetImage
        environmentId={props.environmentId}
        resource={resource}
        kind={isVideo ? "video" : "image"}
        alt={props.reference.label}
      />
    );
  }
  return <TicketAttachmentChip environmentId={props.environmentId} attachment={attachment} />;
}
