import { describe, expect, it } from "vite-plus/test";

import {
  customDocumentViewValue,
  filterDocumentViewOptions,
  POWERHOUSE_BRANCH_OPTIONS,
  POWERHOUSE_SCOPE_OPTIONS,
} from "./documentViewOptions";

describe("documentViewOptions", () => {
  it("exposes Powerhouse's canonical branch", () => {
    expect(POWERHOUSE_BRANCH_OPTIONS).toEqual([
      { value: "main", label: "Main branch", group: "default" },
    ]);
  });

  it("groups model and system scopes without hiding their exact values", () => {
    expect(POWERHOUSE_SCOPE_OPTIONS.map(({ value }) => value)).toEqual([
      "global",
      "local",
      "document",
      "auth",
      "header",
    ]);
    expect(POWERHOUSE_SCOPE_OPTIONS.filter(({ group }) => group === "model")).toHaveLength(2);
    expect(POWERHOUSE_SCOPE_OPTIONS.filter(({ group }) => group === "system")).toHaveLength(3);
  });

  it("searches friendly labels and exact view values", () => {
    expect(filterDocumentViewOptions(POWERHOUSE_SCOPE_OPTIONS, "lifecycle")).toEqual([
      { value: "document", label: "Document lifecycle", group: "system" },
    ]);
    expect(filterDocumentViewOptions(POWERHOUSE_SCOPE_OPTIONS, "local state")).toEqual([
      { value: "local", label: "Local state", group: "model" },
    ]);
  });

  it("offers a trimmed custom value only when it is not already known", () => {
    const knownValues = POWERHOUSE_SCOPE_OPTIONS.map(({ value }) => value);
    expect(customDocumentViewValue(knownValues, "  private  ")).toBe("private");
    expect(customDocumentViewValue(knownValues, "global")).toBeNull();
    expect(customDocumentViewValue(knownValues, "   ")).toBeNull();
  });
});
