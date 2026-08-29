import type { BrowserSurfaceRect } from "./browserSurfaceStore";

export interface HostedBrowserWebviewSize {
  readonly width: number;
  readonly height: number;
}

export interface HostedBrowserWebviewWrapperStyle {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly zIndex: number;
  readonly pointerEvents: "auto" | "none";
  readonly borderRadius?: number;
  readonly visibility?: "hidden" | "visible";
}

export const HIDDEN_BROWSER_WEBVIEW_OFFSET = -100_000;

export function resolveHostedBrowserWebviewWrapperStyle(input: {
  readonly active: boolean;
  readonly renderingActive: boolean;
  readonly cornerRadius?: number;
  readonly interactable?: boolean;
  readonly rect: BrowserSurfaceRect | null;
  readonly hiddenSize: HostedBrowserWebviewSize;
}): HostedBrowserWebviewWrapperStyle {
  const {
    active,
    cornerRadius = 0,
    hiddenSize,
    interactable = true,
    rect,
    renderingActive,
  } = input;
  if (active && rect) {
    return {
      left: rect.x,
      top: rect.y,
      width: rect.width,
      height: rect.height,
      zIndex: 30,
      // Electron webviews receive clicks even under higher-z HTML overlays.
      // Callers set interactable=false while a renderer popover is open.
      pointerEvents: interactable ? "auto" : "none",
      ...(cornerRadius > 0 ? { borderRadius: cornerRadius } : {}),
    };
  }

  return {
    left: HIDDEN_BROWSER_WEBVIEW_OFFSET,
    top: HIDDEN_BROWSER_WEBVIEW_OFFSET,
    width: hiddenSize.width,
    height: hiddenSize.height,
    zIndex: -1,
    pointerEvents: "none",
    visibility: renderingActive ? "visible" : "hidden",
  };
}
