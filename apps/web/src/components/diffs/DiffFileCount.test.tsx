import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DiffFileCount } from "./DiffFileCount";

function renderFileCount(count: number, truncated = false): string {
  return renderToStaticMarkup(<DiffFileCount count={count} truncated={truncated} />);
}

describe("DiffFileCount", () => {
  it("uses a singular label for one changed file", () => {
    const markup = renderFileCount(1);

    expect(markup).toContain("1 file</span>");
    expect(markup).toContain('aria-label="1 changed file"');
    expect(markup).toContain('aria-hidden="true"');
  });

  it("uses a plural label and locale formatting for multiple changed files", () => {
    const markup = renderFileCount(1_234);

    expect(markup).toContain("1,234 files</span>");
    expect(markup).toContain('aria-label="1,234 changed files"');
  });

  it("shows a lower bound and explanation for truncated previews", () => {
    const markup = renderFileCount(12, true);
    const explanation = "At least 12 changed files; diff preview is truncated";

    expect(markup).toContain("12+ files</span>");
    expect(markup).toContain(`aria-label="${explanation}"`);
  });

  it("renders nothing when no changed files are available", () => {
    expect(renderFileCount(0)).toBe("");
  });
});
