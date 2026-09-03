import type { CSSProperties } from "react";

import { VETRA_PIERRE_FOLDER_ICON_CSS } from "~/pierre-icons";

/** Shadow-root overrides that make a Pierre file tree read as part of the app chrome. */
export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 12px;
    --trees-status-added-override: var(--success);
    --trees-status-deleted-override: var(--destructive);
  }
  button[data-type='item'] { border-radius: 5px; }
  [data-item-contains-git-change='true'] > [data-item-section='content'] {
    color: var(--trees-git-modified-color);
    font-weight: var(--trees-font-weight-semibold);
  }
  ${VETRA_PIERRE_FOLDER_ICON_CSS}
`;

/** Host styles that keep a Pierre tree on the active color scheme and foreground. */
export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--contrast-foreground)",
  };
}
