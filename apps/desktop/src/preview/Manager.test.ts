import { describe } from "vite-plus/test";
import { expect } from "vite-plus/test";
import { it } from "vite-plus/test";
import { vi } from "vite-plus/test";

import * as PreviewManager from "./Manager.ts";

describe("fitPictureInPictureContentSize", () => {
  it("does not collapse toward the minimum size when orientation changes repeatedly", () => {
    const portrait = PreviewManager.fitPictureInPictureContentSize([523, 294], 9 / 16);
    const landscape = PreviewManager.fitPictureInPictureContentSize(portrait, 16 / 9);

    expect(portrait).toEqual([294, 523]);
    expect(landscape).toEqual([523, 294]);
  });
});

describe("isPreviewEditingShortcut", () => {
  const input = (platform: NodeJS.Platform, key: string, overrides: Partial<Electron.Input> = {}) =>
    ({
      type: "keyDown",
      key,
      meta: platform === "darwin",
      control: platform !== "darwin",
      shift: false,
      alt: false,
      ...overrides,
    }) as Electron.Input;

  it("recognizes macOS Paste and Match Style when Option changes the key to a symbol", () => {
    const pasteAndMatchStyle = input("darwin", "◊", { code: "KeyV", alt: true, shift: true });
    expect(PreviewManager.isPreviewEditingShortcut(pasteAndMatchStyle, "darwin")).toBe(true);
    for (const modifiers of [
      { code: "KeyC" },
      { alt: false },
      { shift: false },
      { control: true },
    ]) {
      expect(
        PreviewManager.isPreviewEditingShortcut({ ...pasteAndMatchStyle, ...modifiers }, "darwin"),
      ).toBe(false);
    }
  });
});

describe("previewWindowOpenAction", () => {
  const details = (overrides: {
    readonly url?: string;
    readonly disposition?: Electron.HandlerDetails["disposition"];
  }) => ({
    url: "https://accounts.google.com/o/oauth2/auth",
    disposition: "new-window" as Electron.HandlerDetails["disposition"],
    ...overrides,
  });

  it("opens a real window for scripted popups so the opener survives", () => {
    expect(PreviewManager.previewWindowOpenAction(details({}))).toBe("popup");
    expect(
      PreviewManager.previewWindowOpenAction(details({ url: "http://localhost:5173/auth" })),
    ).toBe("popup");
  });

  it("keeps a form POST with a body on the in-place path", () => {
    const postBody = { data: [], contentType: "application/x-www-form-urlencoded" };
    expect(
      PreviewManager.previewWindowOpenAction({
        ...details({ disposition: "foreground-tab" }),
        postBody,
      }),
    ).toBe("navigate");
  });

  it("does not hand a window to schemes that cannot be hardened", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "vscode://vscode-remote/ssh-remote+box/tmp",
      "not a url",
    ]) {
      expect(PreviewManager.previewWindowOpenAction(details({ url }))).toBe("navigate");
    }
  });

  it("denies a blank window instead of blanking the opener", () => {
    for (const url of ["about:blank", ""]) {
      for (const disposition of ["new-window", "foreground-tab"] as const) {
        expect(PreviewManager.previewWindowOpenAction(details({ url, disposition }))).toBe("deny");
      }
    }
  });
});

const {
  browserWindowConstructor,
  clipboardItemConstructor,
  createFromPath,
  fromId,
  getFocusedWebContents,
  showItemInFolder,
  writeClipboard,
} = vi.hoisted(() => ({
  browserWindowConstructor: vi.fn(),
  clipboardItemConstructor: vi.fn(),
  createFromPath: vi.fn((): { readonly isEmpty: () => boolean; readonly toPNG: () => Buffer } => ({
    isEmpty: () => false,
    toPNG: () => Buffer.from("png"),
  })),
  fromId: vi.fn<(_id?: number) => Electron.WebContents | null>((_id?: number) => null),
  getFocusedWebContents: vi.fn(() => null),
  mkdir: vi.fn((_path: string) => undefined),
  previewSession: { on: vi.fn() },
  showItemInFolder: vi.fn(),
  webviewSend: vi.fn(),
  writeFile: vi.fn((_path: string, _data: Uint8Array) => undefined),
  writeClipboard: vi.fn(async () => undefined),
}));

vi.mock("electron", () => ({
  BrowserWindow: browserWindowConstructor,
  // oxlint-disable-next-line typescript/no-extraneous-class -- This constructor-only mock implements the browser ClipboardItem API.
  ClipboardItem: class {
    constructor(data: Record<string, unknown>) {
      clipboardItemConstructor(data);
    }
  },
  clipboard: {
    write: writeClipboard,
  },
  nativeImage: {
    createFromPath,
  },
  shell: {
    showItemInFolder,
  },
  session: {
    fromPartition: vi.fn(),
  },
  webContents: {
    fromId,
    getFocusedWebContents,
  },
}));
