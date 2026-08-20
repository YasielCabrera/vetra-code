import { describe, expect, it } from "vite-plus/test";

import {
  customDocumentTypeValue,
  documentTypeOptions,
  filterDocumentTypeOptions,
} from "./documentTypeOptions";

describe("documentTypeOptions", () => {
  it("puts built-in drive and folder types before project models", () => {
    const options = documentTypeOptions([
      { id: "powerhouse/todo", name: "Todo" },
      { id: "acme/invoice", name: "Invoice" },
    ]);

    expect(options.map(({ value }) => value)).toEqual([
      "powerhouse/document-drive",
      "powerhouse/reactor-drive",
      "powerhouse/folder",
      "acme/invoice",
      "powerhouse/todo",
    ]);
    expect(options.slice(3)).toEqual([
      { value: "acme/invoice", label: "Invoice", source: "model" },
      { value: "powerhouse/todo", label: "Todo", source: "model" },
    ]);
  });

  it("deduplicates exact identifiers and keeps built-in labels authoritative", () => {
    const options = documentTypeOptions([
      { id: "powerhouse/folder", name: "Custom folder label" },
      { id: "acme/invoice", name: "Invoice" },
      { id: "acme/invoice", name: "Duplicate invoice" },
    ]);

    expect(options.filter(({ value }) => value === "powerhouse/folder")).toEqual([
      { value: "powerhouse/folder", label: "Folder", source: "system" },
    ]);
    expect(options.filter(({ value }) => value === "acme/invoice")).toHaveLength(1);
  });

  it("searches friendly labels and exact type identifiers", () => {
    const options = documentTypeOptions([{ id: "acme/invoice", name: "Customer invoice" }]);

    expect(filterDocumentTypeOptions(options, "customer").map(({ value }) => value)).toEqual([
      "acme/invoice",
    ]);
    expect(
      filterDocumentTypeOptions(options, "powerhouse reactor").map(({ value }) => value),
    ).toEqual(["powerhouse/reactor-drive"]);
  });

  it("offers a trimmed custom value only when it is not already known", () => {
    const options = documentTypeOptions([{ id: "acme/invoice", name: "Invoice" }]);

    expect(customDocumentTypeValue(options, "  partner/contract  ")).toBe("partner/contract");
    expect(customDocumentTypeValue(options, "acme/invoice")).toBeNull();
    expect(customDocumentTypeValue(options, "   ")).toBeNull();
  });
});
