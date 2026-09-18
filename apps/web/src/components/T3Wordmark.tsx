import type { SVGProps } from "react";

/**
 * The Vetra quadrant mark. Callers that sit on a coloured backdrop pass
 * `fill="currentColor"` so the mark inherits the surrounding text colour;
 * everywhere else it keeps the brand green.
 */
export function T3Wordmark({ fill = "#04C161", ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 81 81" {...props}>
      <path
        d="M0 49.754a5.57 5.57 0 0 1 5.572-5.572h3.384c15.388 0 27.862 12.474 27.862 27.862v3.383A5.57 5.57 0 0 1 31.245 81H5.572A5.57 5.57 0 0 1 0 75.427zM31.245 0a5.57 5.57 0 0 1 5.573 5.572v3.384c0 15.388-12.474 27.862-27.862 27.862H5.572A5.57 5.57 0 0 1 0 31.246V5.572A5.57 5.57 0 0 1 5.572 0zM81 31.246a5.57 5.57 0 0 1-5.573 5.572h-3.383c-15.388 0-27.862-12.474-27.862-27.862V5.573A5.57 5.57 0 0 1 49.754 0h25.673A5.57 5.57 0 0 1 81 5.573zM49.755 81a5.573 5.573 0 0 1-5.573-5.573v-3.383c0-15.388 12.474-27.862 27.862-27.862h3.384A5.57 5.57 0 0 1 81 49.754v25.674A5.57 5.57 0 0 1 75.427 81z"
        fill={fill}
      />
    </svg>
  );
}
