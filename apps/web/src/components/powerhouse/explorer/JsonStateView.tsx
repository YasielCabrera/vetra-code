import { json } from "@codemirror/lang-json";
import { foldGutter, syntaxHighlighting } from "@codemirror/language";
import CodeMirror, { EditorView, lineNumbers, oneDarkHighlightStyle } from "@uiw/react-codemirror";

import { useTheme } from "~/hooks/useTheme";

const VETRA_CODE_MIRROR_THEME_RULES = {
  "&": {
    backgroundColor: "var(--code-background)",
    color: "var(--code-foreground)",
  },
  ".cm-content": {
    caretColor: "var(--ring)",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--ring)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    {
      backgroundColor: "color-mix(in srgb, var(--primary) 24%, transparent)",
    },
  ".cm-gutters": {
    backgroundColor: "var(--code-background)",
    color: "color-mix(in srgb, var(--code-foreground) 45%, transparent)",
    borderRight: "1px solid color-mix(in srgb, var(--code-foreground) 14%, transparent)",
  },
  ".cm-foldGutter": {
    color: "color-mix(in srgb, var(--code-foreground) 62%, transparent)",
  },
  ".cm-foldPlaceholder": {
    backgroundColor: "color-mix(in srgb, var(--code-background) 88%, var(--code-foreground))",
    border: "1px solid color-mix(in srgb, var(--code-foreground) 18%, transparent)",
    color: "var(--code-foreground)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in srgb, var(--primary) 16%, transparent)",
  },
  ".cm-searchMatch": {
    backgroundColor: "color-mix(in srgb, var(--warning) 22%, transparent)",
    outline: "1px solid color-mix(in srgb, var(--warning) 50%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor: "color-mix(in srgb, var(--primary) 24%, transparent)",
  },
  "&.cm-focused .cm-matchingBracket": {
    backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)",
  },
  ".cm-panels, .cm-tooltip": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
  },
  ".cm-panels": {
    borderColor: "var(--border)",
  },
};

const VETRA_CODE_MIRROR_THEMES = {
  light: EditorView.theme(VETRA_CODE_MIRROR_THEME_RULES, { dark: false }),
  dark: EditorView.theme(VETRA_CODE_MIRROR_THEME_RULES, { dark: true }),
};

const JSON_LANGUAGE = json();
const JSON_GUTTERS = [foldGutter(), lineNumbers()];
const JSON_EXTENSIONS = {
  light: [...JSON_GUTTERS, JSON_LANGUAGE],
  dark: [...JSON_GUTTERS, JSON_LANGUAGE, syntaxHighlighting(oneDarkHighlightStyle)],
};

export function JsonStateView({ code }: { code: string }) {
  const { resolvedTheme } = useTheme();

  return (
    <CodeMirror
      value={code}
      theme={VETRA_CODE_MIRROR_THEMES[resolvedTheme]}
      extensions={JSON_EXTENSIONS[resolvedTheme]}
      editable={false}
      readOnly
      basicSetup={{
        lineNumbers: false,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        drawSelection: false,
        autocompletion: false,
      }}
      aria-label="Document state JSON"
      className="text-[length:var(--font-size-code,0.8125rem)] [&_.cm-content]:py-2.5 [&_.cm-editor]:outline-none [&_.cm-foldGutter_.cm-gutterElement]:cursor-pointer [&_.cm-gutterElement]:leading-5 [&_.cm-line]:px-3 [&_.cm-line]:leading-5 [&_.cm-lineNumbers_.cm-gutterElement]:px-2 [&_.cm-scroller]:font-mono"
    />
  );
}
