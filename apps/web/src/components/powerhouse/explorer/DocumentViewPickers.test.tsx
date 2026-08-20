import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { BranchPicker, ScopePicker } from "./DocumentViewPickers";

describe("BranchPicker", () => {
  it("shows Powerhouse's friendly default and exact branch value", () => {
    const markup = renderToStaticMarkup(
      <BranchPicker id="branch" value="main" invalid={false} onChange={vi.fn()} />,
    );

    expect(markup).toContain("Main branch");
    expect(markup).toContain("main");
  });

  it("preserves a custom branch", () => {
    const markup = renderToStaticMarkup(
      <BranchPicker id="branch" value="review" invalid={false} onChange={vi.fn()} />,
    );

    expect(markup).toContain("Custom branch");
    expect(markup).toContain("review");
  });

  it("prompts for a branch when the filter is empty", () => {
    const markup = renderToStaticMarkup(
      <BranchPicker id="branch" value="" invalid={false} onChange={vi.fn()} />,
    );

    expect(markup).toContain("Choose branch…");
  });
});

describe("ScopePicker", () => {
  it("renders selected default and custom scopes as removable chips", () => {
    const markup = renderToStaticMarkup(
      <ScopePicker id="scopes" value="global, private" invalid={false} onChange={vi.fn()} />,
    );

    expect(markup).toContain("global");
    expect(markup).toContain("private");
    expect(markup).toContain("Add scope…");
    expect(markup.match(/aria-label="Remove"/g)).toHaveLength(2);
  });

  it("prompts for scopes when the filter is empty", () => {
    const markup = renderToStaticMarkup(
      <ScopePicker id="scopes" value="" invalid={false} onChange={vi.fn()} />,
    );

    expect(markup).toContain("Choose scopes…");
    expect(markup).toContain('aria-label="Open scope options"');
  });
});
