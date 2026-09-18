import { useGraphiQL, useMonaco } from "@graphiql/react";
import { explorerPlugin } from "@graphiql/plugin-explorer";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import { getOperationAST, type ExecutionResult } from "graphql";
import { GraphiQL, type GraphiQLProps } from "graphiql";
import "graphiql/setup-workers/vite";
import "graphiql/style.css";
import "@graphiql/plugin-explorer/style.css";
import { Braces } from "lucide-react";
import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { useTheme } from "~/hooks/useTheme";
import { powerhouseEnvironment } from "~/state/powerhouse";
import { useAtomCommand } from "~/state/use-atom-command";

import { displayReactorUrl } from "../PowerhousePanel.logic";
import { PowerhousePanelLoading } from "../PowerhousePanelPrimitives";
import { useReactorQuery } from "../powerhouseQuery";
import { ReactorConnectionCard } from "../explorer/ReactorConnectionCard";
import {
  applySwitchboardPortalTheme,
  defaultSwitchboardTheme,
  isSwitchboardSettingsShortcut,
  normalizeGraphqlHeaders,
  readSwitchboardTheme,
  serializeGraphqlVariables,
  shouldShowSwitchboardResponsePlaceholder,
  type SwitchboardThemeTokens,
} from "./SwitchboardView.logic";
import { createSwitchboardStorage } from "./switchboardStorage";
import "./SwitchboardView.css";

const SWITCHBOARD_PLUGINS = [explorerPlugin()];
const SWITCHBOARD_MONACO_THEMES = {
  light: "vetra-switchboard-light",
  dark: "vetra-switchboard-dark",
} as const;
const DEFAULT_QUERY = `query SwitchboardSystem {
  system {
    version
    gitHash
    gitUrl
  }
}`;

function stripHash(color: string): string {
  return color.startsWith("#") ? color.slice(1) : color;
}

function SwitchboardMonacoTheme({
  appearance,
  tokens,
}: {
  appearance: "light" | "dark";
  tokens: SwitchboardThemeTokens["monaco"];
}) {
  const monaco = useMonaco((state) => state.monaco);

  useLayoutEffect(() => {
    if (monaco === undefined) return;
    const themeName = SWITCHBOARD_MONACO_THEMES[appearance];
    monaco.editor.defineTheme(themeName, {
      base: appearance === "dark" ? "vs-dark" : "vs",
      inherit: true,
      colors: {
        "editor.background": tokens.background,
        "editor.foreground": tokens.foreground,
        "editorCursor.foreground": tokens.primary,
        "editorLineNumber.foreground": tokens.muted,
        "editorLineNumber.activeForeground": tokens.foreground,
        "editor.selectionBackground": tokens.selection,
        "editor.inactiveSelectionBackground": tokens.surface,
        "editorIndentGuide.background1": tokens.border,
        "editorIndentGuide.activeBackground1": tokens.muted,
        "editorWidget.background": tokens.surface,
        "editorWidget.border": tokens.border,
        "editorHoverWidget.background": tokens.surface,
        "editorHoverWidget.border": tokens.border,
        "editorSuggestWidget.background": tokens.surface,
        "editorSuggestWidget.border": tokens.border,
        "editorSuggestWidget.foreground": tokens.foreground,
        "editorSuggestWidget.selectedBackground": tokens.selection,
        focusBorder: tokens.primary,
        "input.background": tokens.background,
        "input.border": tokens.border,
        "input.foreground": tokens.foreground,
      },
      rules: [
        { token: "comment", foreground: stripHash(tokens.muted), fontStyle: "italic" },
        { token: "keyword", foreground: stripHash(tokens.primary) },
        { token: "string", foreground: stripHash(tokens.success) },
        { token: "number", foreground: stripHash(tokens.warning) },
        { token: "type.identifier.gql", foreground: stripHash(tokens.info) },
        { token: "field.identifier.gql", foreground: stripHash(tokens.foreground) },
        { token: "argument.identifier.gql", foreground: stripHash(tokens.secondary) },
      ],
    });
    monaco.editor.setTheme(themeName);
  }, [appearance, monaco, tokens]);

  return null;
}

function SwitchboardMonacoTypography({
  typography,
}: {
  typography: SwitchboardThemeTokens["typography"];
}) {
  const headerEditor = useGraphiQL((state) => state.headerEditor);
  const queryEditor = useGraphiQL((state) => state.queryEditor);
  const responseEditor = useGraphiQL((state) => state.responseEditor);
  const variableEditor = useGraphiQL((state) => state.variableEditor);

  useLayoutEffect(() => {
    for (const editor of [headerEditor, queryEditor, responseEditor, variableEditor]) {
      editor?.updateOptions(typography);
    }
  }, [headerEditor, queryEditor, responseEditor, typography, variableEditor]);

  return null;
}

function SwitchboardResponsePlaceholder() {
  const visible = useGraphiQL((state) =>
    shouldShowSwitchboardResponsePlaceholder({
      response: state.tabs[state.activeTabIndex]?.response ?? null,
      isFetching: state.isFetching,
      fetchError: state.fetchError,
      validationErrorCount: state.validationErrors.length,
    }),
  );

  if (!visible) return null;
  return (
    <div className="switchboard-response-placeholder" role="status">
      <span className="switchboard-response-placeholder-icon">
        <Braces aria-hidden />
      </span>
      <span>Run an operation to view its response</span>
    </div>
  );
}

function suppressSwitchboardSettingsShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
  if (isSwitchboardSettingsShortcut(event)) event.stopPropagation();
}

interface SwitchboardViewProps {
  environmentId: EnvironmentId;
  cwd: string;
  projectPath: string;
  surfaceId: string;
  panelProjectKey: string;
  overrideUrl: string | null;
  onSetOverride: (url: string | null) => void;
}

export default function SwitchboardView({
  environmentId,
  cwd,
  projectPath,
  surfaceId,
  panelProjectKey,
  overrideUrl,
  onSetOverride,
}: SwitchboardViewProps) {
  const probe = useReactorQuery(
    powerhouseEnvironment.reactorProbe({
      environmentId,
      input: {
        cwd,
        ...(projectPath.length === 0 ? {} : { projectPath }),
        ...(overrideUrl === null ? {} : { overrideUrl }),
      },
    }),
  );
  const connection = probe.isFailure ? null : probe.data;

  if (connection === null && probe.isPending) {
    return (
      <PowerhousePanelLoading
        label={
          overrideUrl === null
            ? "Looking for a reactor…"
            : `Connecting to ${displayReactorUrl(overrideUrl)}…`
        }
      />
    );
  }

  if (connection === null) {
    return (
      <ReactorConnectionCard
        error={probe.error}
        otherError={probe.otherError}
        overrideUrl={overrideUrl}
        onSetOverride={onSetOverride}
        onRetry={probe.refresh}
      />
    );
  }

  return (
    <ConnectedSwitchboard
      key={connection.url}
      environmentId={environmentId}
      url={connection.url}
      surfaceId={surfaceId}
      panelProjectKey={panelProjectKey}
    />
  );
}

function ConnectedSwitchboard({
  environmentId,
  url,
  surfaceId,
  panelProjectKey,
}: {
  environmentId: EnvironmentId;
  url: string;
  surfaceId: string;
  panelProjectKey: string;
}) {
  const execute = useAtomCommand(powerhouseEnvironment.reactorExecuteGraphql, {
    reportFailure: false,
  });
  const { resolvedTheme } = useTheme();
  const rootRef = useRef<HTMLDivElement>(null);
  const [themeTokens, setThemeTokens] = useState(() => defaultSwitchboardTheme(resolvedTheme));
  const storage = useMemo(
    () => createSwitchboardStorage(surfaceId, panelProjectKey),
    [panelProjectKey, surfaceId],
  );

  useLayoutEffect(() => {
    const element = rootRef.current;
    if (element === null) return;
    const refreshTheme = () => {
      const next = readSwitchboardTheme(element, resolvedTheme);
      applySwitchboardPortalTheme(next);
      setThemeTokens(next);
    };
    refreshTheme();

    // Theme previews update semantic variables in place without changing the
    // selected theme id, so follow root palette mutations as well as React state.
    const observer = new MutationObserver(refreshTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme-id"],
    });
    return () => observer.disconnect();
  }, [resolvedTheme]);

  const fetcher = useCallback<GraphiQLProps["fetcher"]>(
    async (params, options) => {
      const operationName = params.operationName?.trim() || undefined;
      const operation =
        options?.documentAST === undefined
          ? null
          : getOperationAST(options.documentAST, operationName);
      if (operation?.operation === "subscription") {
        throw new Error("Switchboard subscriptions require a streaming transport.");
      }
      const variablesJson = serializeGraphqlVariables(params.variables);
      const headers = normalizeGraphqlHeaders(options?.headers);
      const result = await execute({
        environmentId,
        input: {
          url,
          query: params.query,
          ...(operationName === undefined ? {} : { operationName }),
          ...(variablesJson === undefined ? {} : { variablesJson }),
          ...(headers === undefined ? {} : { headers }),
        },
      });
      if (result._tag === "Failure") {
        const failure = squashAtomCommandFailure(result);
        throw failure instanceof Error ? failure : new Error("The Switchboard request failed.");
      }
      return result.value.response as ExecutionResult;
    },
    [environmentId, execute, url],
  );

  return (
    <div
      ref={rootRef}
      className="h-full min-h-0 bg-background"
      style={themeTokens.css as CSSProperties}
      onKeyDownCapture={suppressSwitchboardSettingsShortcut}
    >
      <GraphiQL
        fetcher={fetcher}
        plugins={SWITCHBOARD_PLUGINS}
        storage={storage}
        defaultQuery={DEFAULT_QUERY}
        defaultEditorToolsVisibility={false}
        shouldPersistHeaders={false}
        showPersistHeadersSettings={false}
        forcedTheme={resolvedTheme}
        editorTheme={SWITCHBOARD_MONACO_THEMES}
        className="switchboard-graphiql"
      >
        <GraphiQL.Logo>{null}</GraphiQL.Logo>
        <GraphiQL.Footer>
          <SwitchboardResponsePlaceholder />
        </GraphiQL.Footer>
        <SwitchboardMonacoTheme appearance={resolvedTheme} tokens={themeTokens.monaco} />
        <SwitchboardMonacoTypography typography={themeTokens.typography} />
      </GraphiQL>
    </div>
  );
}
