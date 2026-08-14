import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { UsageTabs } from "./UsageTabs";

describe("UsageTabs", () => {
  it("separates subscriptions and API-equivalent activity into accessible tabs", () => {
    const html = renderToStaticMarkup(
      <UsageTabs
        subscriptions={<div>Subscription content</div>}
        apiEquivalent={<div>API content</div>}
      />,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="Usage views"');
    expect(html).toContain('role="tab"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain(">Subscriptions</button>");
    expect(html).toContain(">API equivalent</button>");
    expect(html.match(/role="tabpanel"/gu)).toHaveLength(2);
    expect(html).toContain("Subscription content");
    expect(html).toContain("API content");
  });
});
