import { describe, expect, it } from "vite-plus/test";

import {
  colorToGraphiqlHsl,
  defaultSwitchboardTheme,
  isSwitchboardSettingsShortcut,
  normalizeGraphqlHeaders,
  resolveSwitchboardEditorTypography,
  serializeGraphqlVariables,
  shouldShowSwitchboardResponsePlaceholder,
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

  it("maps configured code typography to Monaco editor measurements", () => {
    expect(
      resolveSwitchboardEditorTypography({
        fontFamily: '  "JetBrains Mono", monospace  ',
        fontSize: "17px",
      }),
    ).toEqual({
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 17,
      lineHeight: 26,
    });

    expect(resolveSwitchboardEditorTypography({ fontFamily: "", fontSize: "invalid" })).toEqual({
      fontFamily: '"SF Mono", "SFMono-Regular", Menlo, Consolas, "Liberation Mono", monospace',
      fontSize: 13,
      lineHeight: 20,
    });
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

  it("recognizes only GraphiQL's modified-comma settings shortcut", () => {
    expect(isSwitchboardSettingsShortcut({ key: ",", metaKey: true, ctrlKey: false })).toBe(true);
    expect(isSwitchboardSettingsShortcut({ key: ",", metaKey: false, ctrlKey: true })).toBe(true);
    expect(isSwitchboardSettingsShortcut({ key: ",", metaKey: false, ctrlKey: false })).toBe(false);
    expect(isSwitchboardSettingsShortcut({ key: ".", metaKey: true, ctrlKey: false })).toBe(false);
  });

  it("shows the response cue only for an idle empty active tab", () => {
    const idleEmptyResponse = {
      response: null,
      isFetching: false,
      fetchError: null,
      validationErrorCount: 0,
    };

    expect(shouldShowSwitchboardResponsePlaceholder(idleEmptyResponse)).toBe(true);
    expect(
      shouldShowSwitchboardResponsePlaceholder({ ...idleEmptyResponse, response: "  \n" }),
    ).toBe(true);
    expect(
      shouldShowSwitchboardResponsePlaceholder({ ...idleEmptyResponse, isFetching: true }),
    ).toBe(false);
    expect(
      shouldShowSwitchboardResponsePlaceholder({ ...idleEmptyResponse, fetchError: "Offline" }),
    ).toBe(false);
    expect(
      shouldShowSwitchboardResponsePlaceholder({
        ...idleEmptyResponse,
        validationErrorCount: 1,
      }),
    ).toBe(false);
    expect(
      shouldShowSwitchboardResponsePlaceholder({ ...idleEmptyResponse, response: '{"data":{}}' }),
    ).toBe(false);
  });
});
