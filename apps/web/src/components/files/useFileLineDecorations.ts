import type { EnvironmentId } from "@vetra-code/contracts";
import { countTextLines, fileContentRevision } from "@vetra-code/shared/fileRevision";
import type { FileOptions } from "@pierre/diffs/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useEnvironmentQuery } from "~/state/query";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { projectFileLineDecorations } from "./fileDecorationProjection";
import {
  blameCommitIndexAtLine,
  buildFileLineDecorationIndex,
  deletionCountAfterLine,
  FILE_CHANGE_ADDED,
  FILE_CHANGE_MODIFIED,
  fileChangeAtLine,
  isCurrentBlameAuthor,
  type FileLineDecorationIndex,
} from "./fileLineDecorations";
import { computeLineShift, type FileLineShift } from "./fileLineShift";

type FilePostRender = NonNullable<FileOptions<unknown>["onPostRender"]>;

export interface FileEditorCaretListeners {
  readonly content: HTMLElement;
  readonly dispose: () => void;
}

const VETRA_CHANGE_ATTRIBUTE = "data-vetra-change";
const VETRA_DELETION_ATTRIBUTE = "data-vetra-deletion";
const VETRA_BLAME_INLINE_ATTRIBUTE = "data-vetra-blame-inline";
const VETRA_ACTIVE_LINE_ATTRIBUTE = "data-vetra-active-line";

export const FILE_LINE_DECORATIONS_UNSAFE_CSS = `
  [${VETRA_CHANGE_ATTRIBUTE}]::before {
    content: "";
    user-select: none;
    contain: strict;
    width: 4px;
    height: 100%;
    display: block;
    position: absolute;
    inset: 0 auto 0 0;
  }

  [${VETRA_CHANGE_ATTRIBUTE}="added"]::before {
    background-color: var(--diffs-addition-base);
  }

  [${VETRA_CHANGE_ATTRIBUTE}="modified"]::before {
    background-color: var(--diffs-modified-base);
  }

  [${VETRA_DELETION_ATTRIBUTE}]::after {
    content: "";
    pointer-events: none;
    width: 8px;
    height: 7px;
    background-color: var(--diffs-deletion-base);
    clip-path: polygon(0 0, 100% 50%, 0 100%);
    display: block;
    position: absolute;
    z-index: 3;
    left: 0;
    top: -3px;
  }

  [${VETRA_DELETION_ATTRIBUTE}="below"]::after {
    top: auto;
    bottom: -3px;
  }

  [data-content]:focus > [data-line][${VETRA_ACTIVE_LINE_ATTRIBUTE}][${VETRA_BLAME_INLINE_ATTRIBUTE}]::after {
    content: attr(${VETRA_BLAME_INLINE_ATTRIBUTE}) !important;
    pointer-events: none;
    user-select: none;
    color: var(--diffs-fg-number);
    background: none !important;
    opacity: .72;
    display: inline-block !important;
    width: auto !important;
    height: auto !important;
    max-width: min(60%, 72ch);
    margin-inline-start: 3ch;
    padding: 0;
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
    vertical-align: top;
    position: absolute !important;
    z-index: auto !important;
    inset: auto !important;
  }
`;

function setAttribute(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

function lineFromElement(element: HTMLElement): number | null {
  const lineIndex = Number.parseInt(element.dataset.lineIndex ?? "", 10);
  return Number.isSafeInteger(lineIndex) && lineIndex >= 0 ? lineIndex + 1 : null;
}

export function fileEditorCaretLine(content: HTMLElement): number | null {
  const root = content.getRootNode() as Node & { getSelection?: () => Selection | null };
  const selection = root.getSelection?.() ?? content.ownerDocument.getSelection();
  const focusNode = selection?.focusNode;
  if (!focusNode) return null;
  const focusElement =
    focusNode.nodeType === Node.ELEMENT_NODE ? (focusNode as Element) : focusNode.parentElement;
  const row = focusElement?.closest<HTMLElement>("[data-line][data-line-index]");
  return row && content.contains(row) ? lineFromElement(row) : null;
}

export function installFileEditorCaretListeners(
  fileContainer: HTMLElement,
  handlers: {
    readonly onFocus: () => void;
    readonly onBlur: () => void;
    readonly onCaretMove: () => void;
  },
): FileEditorCaretListeners | null {
  const root = fileContainer.shadowRoot ?? fileContainer;
  const content = root.querySelector<HTMLElement>("[data-content][contenteditable=true]");
  if (!content) return null;
  const onSelectionChange = () => {
    if (content.matches(":focus")) handlers.onCaretMove();
  };

  content.addEventListener("focus", handlers.onFocus);
  content.addEventListener("blur", handlers.onBlur);
  content.addEventListener("keydown", handlers.onCaretMove);
  content.addEventListener("pointerup", handlers.onCaretMove);
  content.ownerDocument.addEventListener("selectionchange", onSelectionChange);
  if (content.matches(":focus")) handlers.onFocus();

  return {
    content,
    dispose: () => {
      content.removeEventListener("focus", handlers.onFocus);
      content.removeEventListener("blur", handlers.onBlur);
      content.removeEventListener("keydown", handlers.onCaretMove);
      content.removeEventListener("pointerup", handlers.onCaretMove);
      content.ownerDocument.removeEventListener("selectionchange", onSelectionChange);
    },
  };
}

function blameLabel(index: FileLineDecorationIndex, line: number): string | null {
  const commitIndex = blameCommitIndexAtLine(index, line);
  if (commitIndex === null) return null;
  const commit = index.commits[commitIndex];
  if (!commit) return null;
  const author = isCurrentBlameAuthor(commit, index.localIdentity)
    ? "You"
    : commit.author || "Unknown";
  const relativeTime =
    commit.authorTime === null
      ? "uncommitted"
      : formatRelativeTimeLabel(new Date(commit.authorTime * 1_000).toISOString());
  return [author, relativeTime, commit.summary].filter((part) => part.length > 0).join(" · ");
}

export function stampFileLineDecorations(
  fileContainer: HTMLElement,
  index: FileLineDecorationIndex,
  fileLineBlameEnabled: boolean,
  activeLine: number | null = null,
): void {
  const root = fileContainer.shadowRoot ?? fileContainer;
  const code = root.querySelector<HTMLElement>("[data-code]");
  if (!code) return;

  const gutter = code.children[0];
  const content = code.children[1];
  if (!(gutter instanceof HTMLElement) || !(content instanceof HTMLElement)) return;

  for (const cell of gutter.children) {
    if (!(cell instanceof HTMLElement) || !cell.hasAttribute("data-column-number")) continue;
    const line = lineFromElement(cell);
    if (line === null) continue;
    const change = fileChangeAtLine(index, line);
    const changeLabel =
      change === FILE_CHANGE_ADDED ? "added" : change === FILE_CHANGE_MODIFIED ? "modified" : null;
    setAttribute(cell, VETRA_CHANGE_ATTRIBUTE, changeLabel);

    const removedAbove = deletionCountAfterLine(index, line - 1);
    const removedBelow = line === index.lineCount ? deletionCountAfterLine(index, line) : 0;
    const removedCount = removedAbove || removedBelow;
    setAttribute(
      cell,
      VETRA_DELETION_ATTRIBUTE,
      removedCount > 0 ? (removedBelow > 0 ? "below" : "above") : null,
    );

    const stateLabel = [
      changeLabel,
      removedCount > 0
        ? `${removedCount} ${removedCount === 1 ? "line" : "lines"} removed ${removedBelow ? "below" : "above"}`
        : null,
    ]
      .filter((label): label is string => label !== null)
      .join(", ");
    setAttribute(cell, "title", stateLabel || null);
    setAttribute(cell, "aria-label", stateLabel ? `Line ${line}, ${stateLabel}` : null);
  }

  for (const row of content.children) {
    if (!(row instanceof HTMLElement) || !row.hasAttribute("data-line")) continue;
    const line = lineFromElement(row);
    if (line === null) continue;
    const isActiveLine = fileLineBlameEnabled && line === activeLine;
    setAttribute(row, VETRA_ACTIVE_LINE_ATTRIBUTE, isActiveLine ? "" : null);
    setAttribute(row, VETRA_BLAME_INLINE_ATTRIBUTE, isActiveLine ? blameLabel(index, line) : null);
  }
}

interface UseFileLineDecorationsInput {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly confirmedContents: string;
  readonly confirmationToken: object | null;
  readonly contents: string;
  readonly headOid: string | null | undefined;
  readonly fileLineBlameEnabled: boolean;
}

export function useFileLineDecorations(input: UseFileLineDecorationsInput): {
  readonly onPostRender: FilePostRender;
  readonly onContentsChange: (contents: string) => void;
  readonly onEditorFocus: () => void;
  readonly onEditorBlur: () => void;
  readonly onCaretLineChange: (line: number | null) => void;
} {
  const revision = useMemo(
    () => fileContentRevision(input.confirmedContents),
    [input.confirmedContents],
  );
  const request = useMemo(
    () => ({
      cwd: input.cwd,
      path: input.relativePath,
      contentRevision: revision,
      ...(input.headOid === undefined ? {} : { headOid: input.headOid }),
    }),
    [input.cwd, input.headOid, input.relativePath, revision],
  );
  const lineChanges = useEnvironmentQuery(
    vcsEnvironment.fileLineChanges({ environmentId: input.environmentId, input: request }),
  );
  const [caretBlameRequested, setCaretBlameRequested] = useState(false);
  const blameRequested = input.fileLineBlameEnabled && caretBlameRequested;
  const blame = useEnvironmentQuery(
    blameRequested
      ? vcsEnvironment.fileBlame({ environmentId: input.environmentId, input: request })
      : null,
  );
  const indexRef = useRef<FileLineDecorationIndex>(
    buildFileLineDecorationIndex(countTextLines(input.confirmedContents), null, null),
  );
  const liveContentsRef = useRef(input.contents);
  const confirmedContentsRef = useRef(input.confirmedContents);
  const confirmationTokenRef = useRef(input.confirmationToken);
  const pendingShiftsRef = useRef<FileLineShift[]>([]);
  const containerRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const activeLineRef = useRef<number | null>(null);
  const fileLineBlameEnabledRef = useRef(input.fileLineBlameEnabled);
  fileLineBlameEnabledRef.current = input.fileLineBlameEnabled;

  const stamp = useCallback(() => {
    const container = containerRef.current;
    if (container) {
      stampFileLineDecorations(
        container,
        indexRef.current,
        fileLineBlameEnabledRef.current,
        activeLineRef.current,
      );
    }
  }, []);
  const scheduleStamp = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      stamp();
    });
  }, [stamp]);

  useEffect(() => {
    if (!input.fileLineBlameEnabled) {
      activeLineRef.current = null;
      setCaretBlameRequested(false);
    }
    scheduleStamp();
  }, [input.fileLineBlameEnabled, scheduleStamp]);

  useEffect(() => {
    if (
      confirmedContentsRef.current === input.confirmedContents &&
      confirmationTokenRef.current === input.confirmationToken
    ) {
      return;
    }
    const renderedShift = computeLineShift(liveContentsRef.current, input.contents);
    if (renderedShift) {
      indexRef.current = projectFileLineDecorations(indexRef.current, renderedShift);
    }
    confirmedContentsRef.current = input.confirmedContents;
    confirmationTokenRef.current = input.confirmationToken;
    liveContentsRef.current = input.contents;
    const pendingShift = computeLineShift(input.confirmedContents, input.contents);
    pendingShiftsRef.current = pendingShift ? [pendingShift] : [];
    scheduleStamp();
  }, [input.confirmationToken, input.confirmedContents, input.contents, scheduleStamp]);

  useEffect(() => {
    if (lineChanges.data === null) return;
    let next = buildFileLineDecorationIndex(
      countTextLines(input.confirmedContents),
      lineChanges.data,
      blame.data,
    );
    for (const shift of pendingShiftsRef.current) {
      next = projectFileLineDecorations(next, shift);
    }
    indexRef.current = next;
    scheduleStamp();
  }, [
    blame.data,
    input.confirmationToken,
    input.confirmedContents,
    lineChanges.data,
    scheduleStamp,
  ]);

  useEffect(() => {
    if (liveContentsRef.current === input.contents) return;
    const shift = computeLineShift(liveContentsRef.current, input.contents);
    liveContentsRef.current = input.contents;
    if (shift) {
      pendingShiftsRef.current.push(shift);
      indexRef.current = projectFileLineDecorations(indexRef.current, shift);
    }
    scheduleStamp();
  }, [input.contents, scheduleStamp]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    [],
  );

  const onContentsChange = useCallback(
    (contents: string) => {
      const shift = computeLineShift(liveContentsRef.current, contents);
      liveContentsRef.current = contents;
      if (shift) {
        pendingShiftsRef.current.push(shift);
        indexRef.current = projectFileLineDecorations(indexRef.current, shift);
      }
      scheduleStamp();
    },
    [scheduleStamp],
  );
  const onEditorFocus = useCallback(() => {
    if (input.fileLineBlameEnabled) setCaretBlameRequested(true);
  }, [input.fileLineBlameEnabled]);
  const onCaretLineChange = useCallback(
    (line: number | null) => {
      if (activeLineRef.current === line) return;
      activeLineRef.current = line;
      scheduleStamp();
    },
    [scheduleStamp],
  );
  const onEditorBlur = useCallback(() => onCaretLineChange(null), [onCaretLineChange]);
  const onPostRender = useCallback<FilePostRender>((fileContainer, _instance, phase) => {
    if (phase === "unmount") {
      if (containerRef.current === fileContainer) containerRef.current = null;
      return;
    }
    containerRef.current = fileContainer;
    stampFileLineDecorations(
      fileContainer,
      indexRef.current,
      fileLineBlameEnabledRef.current,
      activeLineRef.current,
    );
  }, []);

  return {
    onPostRender,
    onContentsChange,
    onEditorFocus,
    onEditorBlur,
    onCaretLineChange,
  };
}
