import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const testState = vi.hoisted(() => ({
  codeMirrorProps: null as Record<string, unknown> | null,
  darkEditorTheme: { name: "vetra-code-mirror-dark-theme" },
  darkSyntaxExtension: { name: "one-dark-syntax-extension" },
  darkSyntaxHighlightStyle: null as unknown,
  editorThemeRules: null as Record<string, Record<string, string>> | null,
  foldGutterExtension: { name: "fold-gutter-extension" },
  jsonExtension: { name: "json-extension" },
  lineNumbersExtension: { name: "line-numbers-extension" },
  lightEditorTheme: { name: "vetra-code-mirror-light-theme" },
  oneDarkHighlightStyle: { name: "one-dark-highlight-style" },
  resolvedTheme: "dark" as "light" | "dark",
}));

vi.mock("@codemirror/lang-json", () => ({
  json: () => testState.jsonExtension,
}));

vi.mock("@codemirror/language", () => ({
  foldGutter: () => testState.foldGutterExtension,
  syntaxHighlighting: (style: unknown) => {
    testState.darkSyntaxHighlightStyle = style;
    return testState.darkSyntaxExtension;
  },
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: (props: Record<string, unknown>) => {
    testState.codeMirrorProps = props;
    return null;
  },
  EditorView: {
    theme: (rules: Record<string, Record<string, string>>, options: { dark: boolean }) => {
      testState.editorThemeRules = rules;
      return options.dark ? testState.darkEditorTheme : testState.lightEditorTheme;
    },
  },
  lineNumbers: () => testState.lineNumbersExtension,
  oneDarkHighlightStyle: testState.oneDarkHighlightStyle,
}));

vi.mock("~/hooks/useTheme", () => ({
  useTheme: () => ({ resolvedTheme: testState.resolvedTheme }),
}));

import { JsonStateView } from "./JsonStateView";

describe("JsonStateView", () => {
  beforeEach(() => {
    testState.codeMirrorProps = null;
    testState.resolvedTheme = "dark";
  });

  it("renders read-only JSON with line numbers and fold controls", () => {
    const code = '{\n  "items": [\n    { "id": 1 }\n  ]\n}';
    renderToStaticMarkup(<JsonStateView code={code} />);

    expect(testState.codeMirrorProps).toMatchObject({
      value: code,
      theme: testState.darkEditorTheme,
      extensions: [
        testState.foldGutterExtension,
        testState.lineNumbersExtension,
        testState.jsonExtension,
        testState.darkSyntaxExtension,
      ],
      editable: false,
      readOnly: true,
      basicSetup: {
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        drawSelection: false,
        autocompletion: false,
      },
      "aria-label": "Document state JSON",
    });
    expect(testState.darkSyntaxHighlightStyle).toBe(testState.oneDarkHighlightStyle);
  });

  it("uses the Vetra editor theme instead of CodeMirror's fixed appearance themes", () => {
    testState.resolvedTheme = "light";
    renderToStaticMarkup(<JsonStateView code="{}" />);

    expect(testState.codeMirrorProps).toMatchObject({
      theme: testState.lightEditorTheme,
      extensions: [
        testState.foldGutterExtension,
        testState.lineNumbersExtension,
        testState.jsonExtension,
      ],
    });
    expect(testState.codeMirrorProps?.theme).not.toBe("light");
    expect(testState.codeMirrorProps?.theme).not.toBe("dark");
  });

  it("maps CodeMirror surfaces and interaction states to app theme tokens", () => {
    expect(testState.editorThemeRules).toMatchObject({
      "&": {
        backgroundColor: "var(--code-background)",
        color: "var(--code-foreground)",
      },
      ".cm-content": {
        caretColor: "var(--ring)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--code-background)",
        color: "color-mix(in srgb, var(--code-foreground) 45%, transparent)",
      },
      ".cm-foldPlaceholder": {
        color: "var(--code-foreground)",
      },
      ".cm-selectionMatch": {
        backgroundColor: "color-mix(in srgb, var(--primary) 16%, transparent)",
      },
      ".cm-panels, .cm-tooltip": {
        backgroundColor: "var(--popover)",
        color: "var(--popover-foreground)",
      },
    });
  });
});
