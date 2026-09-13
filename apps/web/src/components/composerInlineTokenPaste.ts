import { ComposerContextId } from "@vetra-code/contracts";
import type { AssistantCitation, ComposerContextClipboardFragment } from "@vetra-code/contracts";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  decodeComposerContextFragment,
  decodeComposerContextClipboardHtml,
} from "@vetra-code/shared/composerContextClipboard";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  replaceComposerContextReferences,
} from "@vetra-code/shared/composerContextReferences";
import type { ComposerInlineToken } from "@vetra-code/shared/composerInlineTokens";
import {
  $createLineBreakNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  PASTE_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from "lexical";

import { collectComposerPromptInlineTokens } from "../composer-editor-mentions";

interface ComposerInlineTokenPasteOptions {
  createMentionNode: (path: string) => LexicalNode;
  createPowerhouseNode: (
    token: Extract<ComposerInlineToken, { type: "powerhouse" }>,
  ) => LexicalNode;
  createCitationNode: (citation: AssistantCitation, source: string) => LexicalNode;
  createContextReferenceNode: (reference: {
    kind: string;
    contextId: string;
    label: string;
  }) => LexicalNode;
  getExpandedAbsoluteOffsetForPoint: (node: LexicalNode, pointOffset: number) => number;
  /**
   * Imports the records behind a structured paste into the draft. Returns the ids that had
   * to change (a re-attached binary gets a fresh local id) so the pasted links follow.
   */
  importContextFragment?: (
    fragment: ComposerContextClipboardFragment,
  ) => ReadonlyMap<string, string>;
}

/**
 * Mentions and Powerhouse references are recognised by their surrounding
 * whitespace; a citation carries its own delimiters and needs no padding.
 */
function isWhitespaceBoundedToken<T extends { readonly type: string }>(
  token: T | undefined,
): token is Extract<T, { type: "mention" | "powerhouse" }> {
  return token?.type === "mention" || token?.type === "powerhouse";
}

export function registerComposerInlineTokenPaste(
  editor: LexicalEditor,
  options: ComposerInlineTokenPasteOptions,
): () => void {
  return editor.registerCommand(
    PASTE_COMMAND,
    (event) => {
      if (!(event instanceof ClipboardEvent) || event.clipboardData === null) {
        return false;
      }
      if (event.clipboardData.files.length > 0) {
        return false;
      }
      const pastedText = event.clipboardData.getData("text/plain");
      if (pastedText.length === 0) {
        return false;
      }
      const text = importPastedComposerText(event.clipboardData, options.importContextFragment);
      // Token grammar requires trailing whitespace; a virtual newline lets a
      // token at the very end of the pasted text still parse.
      const tokens = collectComposerPromptInlineTokens(`${text}\n`).filter(
        (token) =>
          (token.type === "mention" ||
            token.type === "powerhouse" ||
            token.type === "citation" ||
            token.type === "context-reference") &&
          token.end <= text.length,
      );
      if (tokens.length === 0) {
        return false;
      }

      // Lexical command listeners already run inside an editor update. Starting
      // a nested update here queues the token insertion until after this
      // listener returns, which lets the plain-text paste handler run as well.
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) {
        return false;
      }
      const nodes: LexicalNode[] = [];
      const appendText = (value: string) => {
        const lines = value.split("\n");
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index] ?? "";
          if (line.length > 0) {
            nodes.push($createTextNode(line));
          }
          if (index < lines.length - 1) {
            nodes.push($createLineBreakNode());
          }
        }
      };
      const firstToken = tokens[0];
      if (isWhitespaceBoundedToken(firstToken) && firstToken.start === 0) {
        const startPoint = selection.isBackward() ? selection.focus : selection.anchor;
        const insertionOffset = options.getExpandedAbsoluteOffsetForPoint(
          startPoint.getNode(),
          startPoint.offset,
        );
        const precedingChar = $getRoot()
          .getTextContent()
          .slice(insertionOffset - 1, insertionOffset);
        if (precedingChar.length > 0 && !/\s/.test(precedingChar)) {
          nodes.push($createTextNode(" "));
        }
      }
      let cursor = 0;
      for (const token of tokens) {
        if (token.start < cursor) {
          continue;
        }
        if (token.start > cursor) {
          appendText(text.slice(cursor, token.start));
        }
        nodes.push(
          token.type === "powerhouse"
            ? options.createPowerhouseNode(token)
            : token.type === "citation"
              ? options.createCitationNode(token.citation, token.source)
              : token.type === "context-reference"
                ? options.createContextReferenceNode({
                    kind: token.kind,
                    contextId: token.contextId,
                    label: token.label,
                  })
                : options.createMentionNode(token.value),
        );
        cursor = token.end;
      }
      if (cursor < text.length) {
        appendText(text.slice(cursor));
      } else if (isWhitespaceBoundedToken(tokens.at(-1))) {
        // Keep the serialized prompt valid: whitespace-bounded tokens need
        // trailing whitespace, so a paste ending in one gets the same
        // trailing space the autocomplete inserts.
        nodes.push($createTextNode(" "));
      }
      selection.insertNodes(nodes);
      event.preventDefault();
      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
}

/** Clipboard records referenced by the copied text, including dependent screenshots. */
export function readPastedComposerContext(
  clipboardData: Pick<DataTransfer, "getData">,
): ComposerContextClipboardFragment | null {
  const pastedText = clipboardData.getData("text/plain");
  // Only records whose links are in the pasted text get imported; a fragment may carry
  // more (it was built for a larger copy) and must not start transfers for those.
  const decodedFragment =
    decodeComposerContextFragment(clipboardData.getData(COMPOSER_CONTEXT_CLIPBOARD_MIME)) ??
    decodeComposerContextClipboardHtml(clipboardData.getData("text/html"));
  if (decodedFragment === null) return null;
  const pastedIds = new Set<string>(
    collectComposerContextReferences(pastedText).map((occurrence) => occurrence.contextId),
  );
  for (const record of decodedFragment.records) {
    if (
      record.kind === "preview-annotation" &&
      !("payload" in record) &&
      pastedIds.has(record.contextId) &&
      record.screenshotContextId
    ) {
      pastedIds.add(record.screenshotContextId);
    }
  }
  return {
    ...decodedFragment,
    records: decodedFragment.records.filter((record) => pastedIds.has(record.contextId)),
  };
}

/** Imports the same structured clipboard payload for focused paste and paste-to-focus. */
export function importPastedComposerText(
  clipboardData: Pick<DataTransfer, "getData">,
  importContextFragment?: ComposerInlineTokenPasteOptions["importContextFragment"],
): string {
  const pastedText = clipboardData.getData("text/plain");
  const fragment = importContextFragment ? readPastedComposerContext(clipboardData) : null;
  const rewrittenIds =
    fragment && fragment.records.length > 0 ? importContextFragment!(fragment) : null;
  const text =
    rewrittenIds && rewrittenIds.size > 0
      ? replaceComposerContextReferences(pastedText, (occurrence) => {
          const nextId = rewrittenIds.get(occurrence.contextId);
          return nextId
            ? formatComposerContextReference({
                ...occurrence,
                contextId: ComposerContextId.make(nextId),
                kind: occurrence.kind === "element" ? "preview-annotation" : occurrence.kind,
              })
            : occurrence.source;
        })
      : pastedText;
  return text;
}
