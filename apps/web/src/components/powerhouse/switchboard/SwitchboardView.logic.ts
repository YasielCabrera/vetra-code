import "culori/css";
import { converter, formatHex, parse } from "culori/fn";

export interface SwitchboardThemeTokens {
  readonly css: Readonly<Record<string, string>>;
  readonly monaco: Readonly<{
    background: string;
    foreground: string;
    surface: string;
    muted: string;
    border: string;
    primary: string;
    secondary: string;
    info: string;
    success: string;
    warning: string;
    error: string;
    selection: string;
  }>;
}

interface SwitchboardColors {
  readonly background: string;
  readonly foreground: string;
  readonly surface: string;
  readonly muted: string;
  readonly border: string;
  readonly primary: string;
  readonly secondary: string;
  readonly info: string;
  readonly success: string;
  readonly warning: string;
  readonly error: string;
  readonly selection: string;
}

const toHsl = converter("hsl");

const DEFAULT_THEME_COLORS = {
  light: {
    background: "#f6faf7",
    foreground: "#202722",
    surface: "#ffffff",
    muted: "#68736c",
    border: "#dde7e0",
    primary: "#04c161",
    secondary: "#174c2d",
    info: "#3b82f6",
    success: "#10b981",
    warning: "#f59e0b",
    error: "#ef4444",
    selection: "#e9f7ee",
  },
  dark: {
    background: "#0b1510",
    foreground: "#edf6f0",
    surface: "#111d16",
    muted: "#94a99b",
    border: "#25352b",
    primary: "#20d978",
    secondary: "#94a99b",
    info: "#60a5fa",
    success: "#34d399",
    warning: "#fbbf24",
    error: "#f87171",
    selection: "#183423",
  },
} as const satisfies Record<"light" | "dark", SwitchboardColors>;

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function colorToGraphiqlHsl(value: string, fallback: string): string {
  const color = parse(value) ?? parse(fallback);
  const hsl = color === undefined ? undefined : toHsl(color);
  if (hsl === undefined) return "0, 0%, 0%";
  return `${rounded(hsl.h ?? 0)}, ${rounded((hsl.s ?? 0) * 100)}%, ${rounded((hsl.l ?? 0) * 100)}%`;
}

function colorToHex(value: string, fallback: string): string {
  return formatHex(parse(value) ?? parse(fallback)) ?? fallback;
}

function resolveCssColor(element: HTMLElement, property: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.hidden = true;
  probe.style.color = `var(${property})`;
  element.append(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  return resolved.trim().length === 0 ? fallback : resolved;
}

export function defaultSwitchboardTheme(appearance: "light" | "dark"): SwitchboardThemeTokens {
  const colors = DEFAULT_THEME_COLORS[appearance];
  return switchboardThemeFromColors(colors, colors);
}

export function readSwitchboardTheme(
  element: HTMLElement,
  appearance: "light" | "dark",
): SwitchboardThemeTokens {
  const fallback = DEFAULT_THEME_COLORS[appearance];
  const colors = {
    background: resolveCssColor(element, "--code-background", fallback.background),
    foreground: resolveCssColor(element, "--code-foreground", fallback.foreground),
    surface: resolveCssColor(element, "--card", fallback.surface),
    muted: resolveCssColor(element, "--muted-foreground", fallback.muted),
    border: resolveCssColor(element, "--border", fallback.border),
    primary: resolveCssColor(element, "--primary", fallback.primary),
    secondary: resolveCssColor(element, "--accent-foreground", fallback.secondary),
    info: resolveCssColor(element, "--info", fallback.info),
    success: resolveCssColor(element, "--success", fallback.success),
    warning: resolveCssColor(element, "--warning", fallback.warning),
    error: resolveCssColor(element, "--error", fallback.error),
    selection: resolveCssColor(element, "--accent", fallback.selection),
  };
  return switchboardThemeFromColors(colors, fallback);
}

function switchboardThemeFromColors(
  colors: SwitchboardColors,
  fallback: SwitchboardColors,
): SwitchboardThemeTokens {
  const hex = {
    background: colorToHex(colors.background, fallback.background),
    foreground: colorToHex(colors.foreground, fallback.foreground),
    surface: colorToHex(colors.surface, fallback.surface),
    muted: colorToHex(colors.muted, fallback.muted),
    border: colorToHex(colors.border, fallback.border),
    primary: colorToHex(colors.primary, fallback.primary),
    secondary: colorToHex(colors.secondary, fallback.secondary),
    info: colorToHex(colors.info, fallback.info),
    success: colorToHex(colors.success, fallback.success),
    warning: colorToHex(colors.warning, fallback.warning),
    error: colorToHex(colors.error, fallback.error),
    selection: colorToHex(colors.selection, fallback.selection),
  };
  return {
    css: {
      "--switchboard-color-base": colorToGraphiqlHsl(colors.background, fallback.background),
      "--switchboard-color-neutral": colorToGraphiqlHsl(colors.foreground, fallback.foreground),
      "--switchboard-color-primary": colorToGraphiqlHsl(colors.primary, fallback.primary),
      "--switchboard-color-secondary": colorToGraphiqlHsl(colors.secondary, fallback.secondary),
      "--switchboard-color-tertiary": colorToGraphiqlHsl(colors.info, fallback.info),
      "--switchboard-color-info": colorToGraphiqlHsl(colors.info, fallback.info),
      "--switchboard-color-success": colorToGraphiqlHsl(colors.success, fallback.success),
      "--switchboard-color-warning": colorToGraphiqlHsl(colors.warning, fallback.warning),
      "--switchboard-color-error": colorToGraphiqlHsl(colors.error, fallback.error),
    },
    monaco: hex,
  };
}

export function applySwitchboardPortalTheme(tokens: SwitchboardThemeTokens): void {
  document.body.classList.add("switchboard-theme-bridge");
  for (const [name, value] of Object.entries(tokens.css)) {
    document.body.style.setProperty(name, value);
  }
}

export function normalizeGraphqlHeaders(
  headers: Readonly<Record<string, unknown>> | undefined,
): Record<string, string> | undefined {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === "string") normalized[name] = value;
    else if (typeof value === "number" || typeof value === "boolean") {
      normalized[name] = String(value);
    }
  }
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

export function serializeGraphqlVariables(variables: unknown): string | undefined {
  if (variables === undefined) return undefined;
  const serialized = JSON.stringify(variables);
  if (serialized === undefined) throw new Error("GraphQL variables must be valid JSON.");
  return serialized;
}
