import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { DocumentFilterBar } from "./DocumentFilterBar";
import {
  EMPTY_POWERHOUSE_DOCUMENT_FILTERS,
  type PowerhouseDocumentFilters,
} from "./documentFilters";

const renderBar = (input?: {
  filters?: PowerhouseDocumentFilters;
  currentParentId?: string | null;
}) =>
  renderToStaticMarkup(
    <DocumentFilterBar
      query=""
      filters={input?.filters ?? EMPTY_POWERHOUSE_DOCUMENT_FILTERS}
      currentParentId={input?.currentParentId ?? null}
      onQueryChange={vi.fn()}
      onFiltersChange={vi.fn()}
    />,
  );

describe("DocumentFilterBar", () => {
  it("searches drives before a root-level document filter is active", () => {
    const markup = renderBar();
    expect(markup).toContain('aria-label="Search loaded Powerhouse drives"');
    expect(markup).toContain('placeholder="Search drives…"');
  });

  it("shows active API filters and switches the root search to document results", () => {
    const markup = renderBar({
      filters: {
        ...EMPTY_POWERHOUSE_DOCUMENT_FILTERS,
        type: "powerhouse/todo",
        scopes: ["global"],
      },
    });
    expect(markup).toContain('aria-label="Search loaded Powerhouse documents"');
    expect(markup).toContain("Type: powerhouse/todo");
    expect(markup).toContain("1 scope");
    expect(markup).toContain("Document filters, 2 active");
  });

  it("searches documents inside an open drive without explicit filters", () => {
    const markup = renderBar({ currentParentId: "drive-1" });
    expect(markup).toContain('aria-label="Search loaded Powerhouse documents"');
    expect(markup).toContain('placeholder="Search name, slug, ID, or type…"');
  });
});
