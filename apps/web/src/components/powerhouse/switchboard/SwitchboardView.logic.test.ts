import { describe, expect, it } from "vite-plus/test";

import {
  colorToGraphiqlHsl,
  defaultSwitchboardTheme,
  normalizeGraphqlHeaders,
  serializeGraphqlVariables,
} from "./SwitchboardView.logic";

describe("Switchboard GraphiQL bridge", () => {
  it("converts design-system colors to the HSL channels GraphiQL expects", () => {
    expect(colorToGraphiqlHsl("#ff0000", "#000000")).toBe("0, 100%, 50%");
    expect(colorToGraphiqlHsl("not-a-color", "#00ff00")).toBe("120, 100%, 50%");
  });

  it("provides distinct light and dark editor surfaces", () => {
    const light = defaultSwitchboardTheme("light");
    const dark = defaultSwitchboardTheme("dark");
    expect(light.monaco.background).toBe("#f6faf7");
    expect(dark.monaco.background).toBe("#0b1510");
    expect(light.css["--switchboard-color-primary"]).not.toBe(
      dark.css["--switchboard-color-primary"],
    );
  });

  it("normalizes header-editor primitives without retaining unsupported values", () => {
    expect(
      normalizeGraphqlHeaders({
        Authorization: "Bearer token",
        "X-Retry": 2,
        "X-Enabled": true,
        ignored: { nested: true },
      }),
    ).toEqual({
      Authorization: "Bearer token",
      "X-Retry": "2",
      "X-Enabled": "true",
    });
  });

  it("serializes variables for the bounded wire contract", () => {
    expect(serializeGraphqlVariables({ id: "document-1" })).toBe('{"id":"document-1"}');
    expect(serializeGraphqlVariables(undefined)).toBeUndefined();
  });
});
