import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { DiffLineStat } from "./DiffLineStat";

describe("DiffLineStat", () => {
  it("shows full locale-formatted line totals", () => {
    const markup = renderToStaticMarkup(<DiffLineStat additions={2_827} deletions={1_800} />);

    expect(markup).toContain("+2,827</span>");
    expect(markup).toContain("-1,800</span>");
  });

  it("omits an empty line summary", () => {
    expect(renderToStaticMarkup(<DiffLineStat additions={0} deletions={0} />)).toBe("");
  });
});
