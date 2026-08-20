import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../SdlBlock", () => ({
  SdlBlock: ({ code, lineNumbers }: { code: string; lineNumbers?: boolean }) => (
    <pre data-testid="sdl-block" data-line-numbers={lineNumbers === true ? "true" : "false"}>
      {code}
    </pre>
  ),
}));

import { ModelSchemaView } from "./ModelSchemaView";

describe("ModelSchemaView", () => {
  it("keeps SDL as the default and offers the diagram as an alternate presentation", () => {
    const html = renderToStaticMarkup(
      <ModelSchemaView title="Global state" code="type Todo { id: ID! }" />,
    );

    expect(html).toContain("Global state");
    expect(html).toContain("GraphQL");
    expect(html).toContain('aria-label="Show SDL"');
    expect(html).toContain('aria-label="Show Diagram"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("type Todo { id: ID! }");
    expect(html).toContain('data-line-numbers="true"');
  });

  it("does not offer an unusable diagram action for an empty schema", () => {
    const html = renderToStaticMarkup(<ModelSchemaView title="Global state" code="  " />);

    expect(html).toContain("No global state schema.");
    expect(html).not.toContain("Schema presentation");
    expect(html).not.toContain("Show Diagram");
  });
});
