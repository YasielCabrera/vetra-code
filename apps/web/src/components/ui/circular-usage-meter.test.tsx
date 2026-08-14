import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CircularUsageMeterButton } from "./circular-usage-meter";

describe("CircularUsageMeterButton", () => {
  it("clamps numeric progress while preserving the accessible label", () => {
    const html = renderToStaticMarkup(
      <CircularUsageMeterButton
        value={127.5}
        indicatorColor="#123456"
        aria-label="Weekly allowance 127.5% used"
        data-example="meter"
      />,
    );

    expect(html).toContain('aria-label="Weekly allowance 127.5% used"');
    expect(html).toContain('data-example="meter"');
    expect(html).toContain('data-usage-meter-state="value"');
    expect(html).toContain('data-usage-meter-value="100"');
    expect(html).toContain('stroke="#123456"');
    expect(html).toContain('stroke-dashoffset="0"');
    expect(html).toContain("motion-reduce:transition-none");

    const belowZero = renderToStaticMarkup(
      <CircularUsageMeterButton
        value={-12}
        indicatorColor="#123456"
        aria-label="Allowance below zero"
      />,
    );
    expect(belowZero).toContain('data-usage-meter-value="0"');
  });

  it("renders a static dashed ring when no percentage is available", () => {
    const html = renderToStaticMarkup(
      <CircularUsageMeterButton
        value={null}
        indicatorColor="#123456"
        aria-label="Subscription usage is loading"
      />,
    );

    expect(html).toContain('data-usage-meter-state="neutral"');
    expect(html).not.toContain("data-usage-meter-value");
    expect(html).toContain('stroke-dasharray="1.5 4"');
    expect(html).not.toContain('stroke="#123456"');
    expect(html).not.toContain("animate-");
  });
});
