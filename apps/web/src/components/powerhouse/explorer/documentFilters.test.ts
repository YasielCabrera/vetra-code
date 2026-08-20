import { describe, expect, it } from "vite-plus/test";

import {
  activeDocumentFilterFields,
  clearDocumentFilterField,
  documentFilterCount,
  documentFilterDraft,
  documentMatchesTextSearch,
  emptyDocumentFilterDraftFields,
  filterDocumentsByTextSearch,
  hasExplicitDocumentSearch,
  parseDocumentFilterDraft,
  parseDocumentFilterValues,
  reactorDocumentSearch,
  reactorDocumentView,
  type PowerhouseDocumentFilters,
} from "./documentFilters";

const filters = (
  overrides: Partial<PowerhouseDocumentFilters> = {},
): PowerhouseDocumentFilters => ({
  type: "",
  parentId: "",
  identifiers: [],
  branch: "",
  scopes: [],
  ...overrides,
});

describe("Powerhouse document filters", () => {
  it("parses, trims, and deduplicates comma- or newline-separated values", () => {
    expect(parseDocumentFilterValues(" doc-1, doc-2\ndoc-1, , slug ")).toEqual([
      "doc-1",
      "doc-2",
      "slug",
    ]);
  });

  it("round-trips applied filters through the editable draft", () => {
    const applied = filters({
      type: "powerhouse/todo",
      parentId: "drive-1",
      identifiers: ["doc-1", "todo-slug"],
      branch: "preview",
      scopes: ["global", "local"],
    });
    const parsed = parseDocumentFilterDraft(documentFilterDraft(applied));
    expect(parsed.filters).toEqual(applied);
    expect(parsed.errors).toEqual({ identifiers: null, scopes: null });
  });

  it("keeps selected fields with no value from disappearing on apply", () => {
    const draft = documentFilterDraft(filters({ type: "powerhouse/todo" }));
    expect(emptyDocumentFilterDraftFields(draft, ["type", "parentId", "scopes"])).toEqual([
      "parentId",
      "scopes",
    ]);
  });

  it("uses an explicit parent before the current explorer folder", () => {
    expect(reactorDocumentSearch(filters({ type: "powerhouse/todo" }), "drive-1")).toEqual({
      type: "powerhouse/todo",
      parentId: "drive-1",
    });
    expect(reactorDocumentSearch(filters({ parentId: "another-drive" }), "drive-1")).toEqual({
      parentId: "another-drive",
    });
  });

  it("omits an empty view and includes branch and scopes when set", () => {
    expect(reactorDocumentView(filters())).toBeUndefined();
    expect(
      reactorDocumentView(filters({ branch: "preview", scopes: ["global", "local"] })),
    ).toEqual({ branch: "preview", scopes: ["global", "local"] });
  });

  it("distinguishes root search criteria from view-only filters", () => {
    expect(hasExplicitDocumentSearch(filters({ branch: "preview" }))).toBe(false);
    expect(hasExplicitDocumentSearch(filters({ identifiers: ["doc-1"] }))).toBe(true);
  });

  it("matches every text term across name, slug, id, and type", () => {
    const document = {
      id: "doc-123",
      slug: "quarterly-report",
      name: "Northwind Q4.pdf",
      documentType: "finance/report",
      createdAtUtcIso: null,
      lastModifiedAtUtcIso: null,
    };
    expect(documentMatchesTextSearch(document, "northwind finance")).toBe(true);
    expect(documentMatchesTextSearch(document, "quarterly doc-123")).toBe(true);
    expect(documentMatchesTextSearch(document, "northwind invoice")).toBe(false);
    expect(filterDocumentsByTextSearch([document], "quarterly finance")).toEqual([document]);
    expect(filterDocumentsByTextSearch([document], "invoice")).toEqual([]);
  });

  it("lists active API fields and clears one condition without disturbing the others", () => {
    const applied = filters({
      type: "finance/report",
      identifiers: ["a", "b"],
      scopes: ["global"],
    });
    expect(documentFilterCount(applied)).toBe(3);
    expect(activeDocumentFilterFields(applied)).toEqual(["type", "identifiers", "scopes"]);
    expect(clearDocumentFilterField(applied, "identifiers")).toEqual(
      filters({ type: "finance/report", scopes: ["global"] }),
    );
  });
});
