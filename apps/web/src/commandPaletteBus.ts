import type { EnvironmentId, PullRequestLinkedThreadsResult } from "@vetra-code/contracts";

export interface CommandPaletteLinkedThreads {
  readonly environmentId: EnvironmentId;
  readonly threads: PullRequestLinkedThreadsResult["threads"];
}

// Tiny event bus allowing components to programmatically open the command palette
// without owning its React state.
const COMMAND_PALETTE_OPEN_EVENT = "vetra:open-command-palette";

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

export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  window.dispatchEvent(
    new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, detail ? { detail } : undefined),
  );
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CommandPaletteOpenDetail>).detail ?? {});
  };
  window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
  return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler);
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
