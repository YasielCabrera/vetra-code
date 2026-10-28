import type { EnvironmentId, PullRequestLinkedThreadsResult } from "@t3tools/contracts";

import { dispatchCommandPalette, isCommandPaletteMounted } from "./commandPaletteStore";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

export interface CommandPaletteOpenDetail {
  readonly open?: "add-project" | "new-thread-in";
  /**
   * Only meaningful with `add-project`. `select` suppresses the usual
   * "start a thread in it" ending and publishes the project instead, so a form
   * can reuse the import-source flow to fill in a field.
   */
  readonly completion?: "open-thread" | "select";
  readonly query?: string;
  readonly linkedThreads?: CommandPaletteLinkedThreads;
}

export function openCommandPalette(detail: CommandPaletteOpenDetail = {}): void {
  // With no palette on screen (e.g. /pair) the request is dropped; kept in the
  // store, it would pop a stale palette once the app shell mounts.
  if (!isCommandPaletteMounted()) return;
  if (detail.open === "new-thread-in") {
    dispatchCommandPalette({ _tag: "OpenNewThreadIn" });
  } else if (detail.open === "add-project") {
    dispatchCommandPalette({
      _tag: "OpenAddProject",
      ...(detail.completion ? { completion: detail.completion } : {}),
    });
  } else if (detail.query !== undefined) {
    dispatchCommandPalette({
      _tag: "OpenSearch",
      query: detail.query,
      ...(detail.linkedThreads ? { linkedThreads: detail.linkedThreads } : {}),
    });
  } else {
    dispatchCommandPalette({ _tag: "SetOpen", open: true });
  }
}

const COMMAND_PALETTE_PROJECT_SELECTED_EVENT = "vetra:command-palette-project-selected";

export interface CommandPaletteProjectSelectedDetail {
  readonly environmentId: string;
  readonly projectId: string;
}

/** Announce the project an `add-project` flow settled on, new or existing. */
export function publishCommandPaletteProjectSelected(
  detail: CommandPaletteProjectSelectedDetail,
): void {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_PROJECT_SELECTED_EVENT, { detail }));
}

export function onCommandPaletteProjectSelected(
  listener: (detail: CommandPaletteProjectSelectedDetail) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<CommandPaletteProjectSelectedDetail>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(COMMAND_PALETTE_PROJECT_SELECTED_EVENT, handler);
  return () => window.removeEventListener(COMMAND_PALETTE_PROJECT_SELECTED_EVENT, handler);
}

/** Read at event time so consumers do not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  );
}
