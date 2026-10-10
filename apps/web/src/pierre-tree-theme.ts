import type { CSSProperties } from "react";

import { VETRA_PIERRE_FOLDER_ICON_CSS } from "~/pierre-icons";

/** Shadow-root overrides that make a Pierre file tree read as part of the app chrome. */
export const PIERRE_TREE_UNSAFE_CSS = `
  :host {
    /* Middle-truncation markers mask the filename with the panel background. */
    --trees-bg-override: var(--background);
    --trees-selected-bg-override: color-mix(in srgb, currentColor 12%, transparent);
    --trees-hover-bg-override: color-mix(in srgb, currentColor 7%, transparent);
    --trees-border-color-override: color-mix(in srgb, currentColor 14%, transparent);
    --trees-font-family-override: var(--font-sans);
    --trees-font-size-override: 0.75rem;
    --trees-status-added-override: var(--success);
    --trees-status-deleted-override: var(--destructive);
  }
  button[data-type='item'], button[data-type='item']::before { border-radius: var(--radius-md); }
  [data-item-contains-git-change='true'] > [data-item-section='content'] {
    color: var(--trees-git-modified-color);
    font-weight: var(--trees-font-weight-semibold);
  }
  ${VETRA_PIERRE_FOLDER_ICON_CSS}
  svg[data-icon-name='t3-tree-icon-loading'] { opacity: 0.6; }
  @media (prefers-reduced-motion: no-preference) {
    svg[data-icon-name='t3-tree-icon-loading'] { animation: t3-tree-spin 1s linear infinite; }
  }
  @keyframes t3-tree-spin { to { transform: rotate(360deg); } }
`;

/** Host styles that keep a Pierre tree on the active color scheme and foreground. */
export function pierreTreeStyle(colorScheme: "light" | "dark"): CSSProperties {
  return {
    colorScheme,
    ["--trees-fg-override" as string]: "var(--contrast-foreground)",
  };
}
