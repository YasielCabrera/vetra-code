import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DiffFileCountBadge } from "./DiffFileCountBadge";

function renderBadge(count: number, truncated = false): string {
  return renderToStaticMarkup(<DiffFileCountBadge count={count} truncated={truncated} />);
}

describe("DiffFileCountBadge", () => {
  it("uses a singular label for one changed file", () => {
    const markup = renderBadge(1);

    expect(markup).toContain(">1 file</span>");
    expect(markup).toContain('aria-label="1 changed file"');
    expect(markup).toContain("leading-none");
  });

  it("uses a plural label for multiple changed files", () => {
    const markup = renderBadge(12);

    expect(markup).toContain(">12 files</span>");
    expect(markup).toContain('aria-label="12 changed files"');
  });

  it("shows a lower bound and explanation for truncated previews", () => {
    const markup = renderBadge(12, true);
    const explanation = "At least 12 changed files; diff preview is truncated";

    expect(markup).toContain(">12+ files</span>");
    expect(markup).toContain(`aria-label="${explanation}"`);
    expect(markup).toContain(`title="${explanation}"`);
  });

  it("renders nothing when no changed files are available", () => {
    expect(renderBadge(0)).toBe("");
  });
});
