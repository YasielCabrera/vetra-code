import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { DocumentTypePicker } from "./DocumentTypePicker";
import { documentTypeOptions } from "./documentTypeOptions";

const options = documentTypeOptions([{ id: "acme/invoice", name: "Customer invoice" }]);

describe("DocumentTypePicker", () => {
  it("shows the friendly name and exact ID for a selected project model", () => {
    const markup = renderToStaticMarkup(
      <DocumentTypePicker
        id="document-type"
        value="acme/invoice"
        options={options}
        catalogStatus="ready"
        invalid={false}
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Customer invoice");
    expect(markup).toContain("acme/invoice");
  });

  it("preserves an existing custom type that is not in the catalog", () => {
    const markup = renderToStaticMarkup(
      <DocumentTypePicker
        id="document-type"
        value="partner/contract"
        options={options}
        catalogStatus="ready"
        invalid={false}
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Custom document type");
    expect(markup).toContain("partner/contract");
  });

  it("prompts for a selection when the filter is empty", () => {
    const markup = renderToStaticMarkup(
      <DocumentTypePicker
        id="document-type"
        value=""
        options={options}
        catalogStatus="loading"
        invalid={false}
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Choose document type…");
  });
});
