import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { DocumentFilterBar } from "./DocumentFilterBar";
import {
  EMPTY_POWERHOUSE_DOCUMENT_FILTERS,
  type PowerhouseDocumentFilters,
} from "./documentFilters";
import { documentTypeOptions } from "./documentTypeOptions";

const renderBar = (input?: {
  filters?: PowerhouseDocumentFilters;
  currentParentId?: string | null;
}) =>
  renderToStaticMarkup(
    <DocumentFilterBar
      query=""
      filters={input?.filters ?? EMPTY_POWERHOUSE_DOCUMENT_FILTERS}
      currentParentId={input?.currentParentId ?? null}
      documentTypeOptions={documentTypeOptions([])}
      documentTypeCatalogStatus="ready"
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

  it("shows field, operator, and value controls for active API filters", () => {
    const markup = renderBar({
      filters: {
        ...EMPTY_POWERHOUSE_DOCUMENT_FILTERS,
        type: "powerhouse/todo",
        scopes: ["global"],
      },
    });
    expect(markup).toContain('aria-label="Search loaded Powerhouse documents"');
    expect(markup).toContain('aria-label="Edit Document type filter, is powerhouse/todo"');
    expect(markup).toContain('aria-label="Remove Document type filter"');
    expect(markup).toContain('aria-label="Edit Scopes filter, uses global"');
    expect(markup).toContain('aria-label="Remove Scopes filter"');
    expect(markup).toContain("Document filters, 2 active");
  });

  it("searches documents inside an open drive without explicit filters", () => {
    const markup = renderBar({ currentParentId: "drive-1" });
    expect(markup).toContain('aria-label="Search loaded Powerhouse documents"');
    expect(markup).toContain('placeholder="Search name, slug, ID, or type…"');
  });
});
