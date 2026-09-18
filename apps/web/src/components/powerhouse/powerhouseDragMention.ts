import {
  serializePowerhouseReference,
  type PowerhouseReferenceKind,
} from "@t3tools/shared/composerInlineTokens";
import type { PowerhouseReactorDocumentSummary } from "@t3tools/contracts";

import {
  COMPOSER_MENTION_DRAG_TYPE,
  composerMentionFromTreePath,
} from "~/components/chat/composerMentionDrag";

import { documentDisplayName } from "./PowerhousePanel.logic";

interface PowerhouseRowDragTransfer {
  setData(format: string, data: string): void;
  effectAllowed: string;
}

export interface PowerhouseRowDragEvent {
  readonly dataTransfer: PowerhouseRowDragTransfer | null;
}

export interface PowerhouseRowDragProps {
  draggable?: true;
  onDragStart?: (event: PowerhouseRowDragEvent) => void;
}

const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;

/**
 * A reactor item has no path to link, so a reference names it in text instead.
 * The composer owns the reference grammar; this decides which of a reactor
 * summary's facts are worth carrying, leaving out any that would only repeat
 * the addressable token.
 */
export function powerhouseReactorMention(input: {
  readonly kind: PowerhouseReferenceKind;
  readonly item: PowerhouseReactorDocumentSummary;
  /** Breadcrumb names from the drive down to the item's parent; empty for a drive row. */
  readonly crumbNames: ReadonlyArray<string>;
  readonly reactorUrl: string;
}): string {
  const { kind, item, crumbNames, reactorUrl } = input;
  // documentDisplayName falls back to the slug and then the id, either of which
  // the reference already carries elsewhere.
  const name = documentDisplayName(item);
  const slug = item.slug?.trim() ?? "";
  return serializePowerhouseReference({
    kind,
    id: item.id,
    name: name === item.id ? "" : name,
    // Only a leaf's type says anything its kind has not.
    documentType: kind === "doc" ? item.documentType : "",
    // Switchboard addresses drives by slug, so it is the actionable field.
    slug: slug !== item.id && slug !== name ? slug : "",
    path: crumbNames.join("/"),
    reactorUrl,
  });
}

/**
 * Workspace-relative path of a model's directory, resolved lexically. Null when
 * the configured models directory is absolute or climbs out of the workspace —
 * such a project has no rows to drag, so no reference can be honest about it.
 */
export function powerhouseModelDirectoryPath(input: {
  /** Workspace-relative project directory; empty when the workspace root is the project. */
  readonly projectPath: string;
  /** As configured, so it may be `./document-models` or `document-models`. */
  readonly documentModelsDir: string;
  readonly directoryName: string;
}): string | null {
  // Configs are POSIX by convention, but a Windows author may well write
  // `.\document-models`. A drive letter or a UNC prefix is a real escape and
  // stays rejected; a plain separator is not.
  const configured = input.documentModelsDir.replaceAll("\\", "/");
  if (configured.startsWith("/") || WINDOWS_DRIVE_PATH_REGEX.test(configured)) {
    return null;
  }
  const segments: string[] = [];
  for (const segment of `${input.projectPath}/${configured}/${input.directoryName}`.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.pop() === undefined) return null;
      continue;
    }
    segments.push(segment);
  }
  return segments.length === 0 ? null : segments.join("/");
}

/**
 * Models get a mention of their whole directory, not of the `<name>.json`
 * inside it: the JSON is only the specification, and the generated types and
 * reducers beside it are part of the same model.
 */
export function powerhouseModelMention(input: {
  readonly projectPath: string;
  readonly documentModelsDir: string;
  readonly directoryName: string;
}): string | null {
  const path = powerhouseModelDirectoryPath(input);
  return path === null ? null : composerMentionFromTreePath(path);
}

/**
 * Row drag wiring, spread onto the row button. Rows carry no drop target of
 * their own; the drag exists so the composer can pick the reference up.
 */
export function powerhouseRowDragProps(mention: string | null): PowerhouseRowDragProps {
  if (mention === null) {
    return {};
  }
  return {
    draggable: true,
    onDragStart: (event) => {
      if (event.dataTransfer === null) return;
      // The composer answers "move"; naming any other effect here makes the
      // browser cancel the drop without firing it.
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(COMPOSER_MENTION_DRAG_TYPE, mention);
    },
  };
}
