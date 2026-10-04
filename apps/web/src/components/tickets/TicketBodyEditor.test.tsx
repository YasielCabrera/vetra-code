// @vitest-environment jsdom

import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { act, useLayoutEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import TicketBodyEditor from "./TicketBodyEditor";

vi.mock("../../lib/utils", async () => {
  const { cx } = await import("class-variance-authority");
  return { cn: cx };
});

let root: Root;
let container: HTMLDivElement;
let currentBody: string;
let setBody: (body: string) => void;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type HarnessProps = { initialBody: string } & Partial<
  Pick<Parameters<typeof TicketBodyEditor>[0], "disabled" | "onFiles" | "onUploadingChange">
>;

function Harness({ initialBody, disabled = false, onFiles, onUploadingChange }: HarnessProps) {
  const [body, set] = useState(initialBody);
  useLayoutEffect(() => {
    currentBody = body;
    setBody = set;
  }, [body]);
  return (
    <TicketBodyEditor
      value={body}
      onChange={set}
      onFiles={onFiles ?? (async () => ["![shot](vetra-attachment://pending-shot)"])}
      disabled={disabled}
      {...(onUploadingChange ? { onUploadingChange } : {})}
      placeholder="Description"
      ariaLabel="Description"
      minHeight="12rem"
    />
  );
}

async function renderEditor(body: string, options: Omit<HarnessProps, "initialBody"> = {}) {
  await act(async () => root.render(<Harness initialBody={body} {...options} />));
}

function richEditor() {
  const element = container.querySelector<TiptapEditorHTMLElement>(".tiptap");
  if (!element?.editor) throw new Error("Rich editor was not rendered");
  return element.editor;
}

function sourceEditor() {
  const element = container.querySelector("textarea");
  if (!element) throw new Error("Source editor was not rendered");
  return element;
}

async function clickMode(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === label,
  );
  if (!button) throw new Error(`Missing mode: ${label}`);
  await act(async () => button.click());
}

async function editSource(body: string) {
  const textarea = sourceEditor();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      textarea,
      body,
    );
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("TicketBodyEditor", () => {
  it("keeps an upload pending through insertion and finishes it when editing is disabled", async () => {
    let completeUpload = (_snippets: ReadonlyArray<string>) => {};
    const upload = new Promise<ReadonlyArray<string>>((complete) => {
      completeUpload = complete;
    });
    const uploadingStates: Array<{ uploading: boolean; body: string }> = [];
    const onFiles = () => upload;
    const onUploadingChange = (uploading: boolean) =>
      uploadingStates.push({ uploading, body: currentBody });
    await renderEditor("Base", { onFiles, onUploadingChange });
    uploadingStates.length = 0;
    await act(async () => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          files: [new File(["image"], "shot.png", { type: "image/png" })],
          getData: () => "",
        },
      });
      richEditor().view.dom.dispatchEvent(event);
    });
    expect(uploadingStates).toEqual([{ uploading: true, body: "Base" }]);
    await renderEditor("Base", { disabled: true, onFiles, onUploadingChange });
    await act(async () => completeUpload(["![shot](vetra-attachment://pending-shot)"]));
    expect(currentBody).toContain("vetra-attachment://pending-shot");
    expect(uploadingStates.at(-1)).toEqual({ uploading: false, body: currentBody });
  });

  it("keeps an external table in source mode until an explicit, synchronized switch to Write", async () => {
    await renderEditor("Initial paragraph");
    const staleEditor = richEditor();
    await act(async () => setBody("|a|b|\n|-|-|\n|1|2|"));
    expect(sourceEditor().value).toBe(currentBody);
    await act(async () => staleEditor.commands.insertContent("X"));
    expect(currentBody).toBe("|a|b|\n|-|-|\n|1|2|");

    await editSource("My new plain description");
    expect(sourceEditor().value).toBe("My new plain description");
    await act(async () => setBody("A newer external description"));
    expect(sourceEditor().value).toBe("A newer external description");

    await clickMode("Write");
    const editor = richEditor();
    expect(editor.getText()).toBe("A newer external description");
    await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!"));
    expect(currentBody).toBe("A newer external description!");
  });

  it("keeps attachment claims out of undo history and canonicalizes undo and redo", async () => {
    await renderEditor("Base");
    const editor = richEditor();
    await act(async () => {
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, {
        type: "image",
        attrs: { src: "vetra-attachment://pending-shot", alt: "shot" },
      });
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    await act(async () => setBody(currentBody.replace("pending-shot", "ticket-shot")));

    await act(async () => editor.commands.undo());
    expect(currentBody).toBe("Base");
    await act(async () => editor.commands.redo());
    expect(currentBody).toContain("vetra-attachment://ticket-shot");
    expect(currentBody).not.toContain("pending-shot");

    await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!"));
    await act(async () => editor.commands.undo());
    expect(currentBody).toContain("vetra-attachment://ticket-shot");
    expect(currentBody).not.toContain("pending-shot");
  });

  it("undoes an image clipboard paste after its autosave claims the upload", async () => {
    await renderEditor("Base");
    const editor = richEditor();
    await act(async () => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          files: [new File(["image"], "shot.png", { type: "image/png" })],
          getData: () => "",
        },
      });
      editor.view.dom.dispatchEvent(event);
    });
    expect(currentBody).toContain("vetra-attachment://pending-shot");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 1000);
    await act(async () => setBody(currentBody.replace("pending-shot", "ticket-shot")));
    await act(async () => editor.commands.undo());
    expect(currentBody).toBe("Base");
    await act(async () => editor.commands.redo());
    expect(currentBody).toContain("vetra-attachment://ticket-shot");
    expect(currentBody).not.toContain("pending-shot");
  });

  it("canonicalizes attachment links and source edits for the document lifetime", async () => {
    await renderEditor("[spec](vetra-attachment://pending-spec)");
    const editor = richEditor();
    await act(async () => setBody("[spec](vetra-attachment://ticket-spec)"));
    await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!"));
    await act(async () => editor.commands.undo());
    expect(currentBody).toBe("[spec](vetra-attachment://ticket-spec)");
    await clickMode("Markdown");
    await editSource("[spec](vetra-attachment://pending-spec)\n\nUndo in source");
    expect(currentBody).toBe("[spec](vetra-attachment://ticket-spec)\n\nUndo in source");
  });

  it.each([
    "\\# literal heading\n\n\\- literal bullet\n\n1\\. literal number",
    "~~~~md\n```nested\nimportant\n```\n~~~~",
  ])("preserves Markdown structure and exact source when editing %s", async (body) => {
    await renderEditor(body);
    expect(currentBody).toBe(body);
    const rich = container.querySelector<TiptapEditorHTMLElement>(".tiptap")?.editor;
    if (rich) {
      const original = rich.markdown?.parse(body);
      expect(rich.markdown?.parse(rich.getMarkdown())).toEqual(original);
      await act(async () => rich.commands.insertContentAt(rich.state.doc.content.size - 1, "!"));
      expect(rich.markdown?.parse(currentBody)).toEqual(rich.markdown?.parse(rich.getMarkdown()));
      expect(rich.markdown?.parse(currentBody)?.content?.map((node) => node.type)).toEqual(
        original?.content?.map((node) => node.type),
      );
    } else {
      expect(sourceEditor().value).toBe(body);
      await editSource(`${body}\n\nAn edit`);
      expect(currentBody).toBe(`${body}\n\nAn edit`);
      await clickMode("Write");
      expect(sourceEditor().value).toBe(currentBody);
    }
  });

  it("keeps untouched Markdown byte-exact through mode switches and undo", async () => {
    const body = "## Heading\r\n\r\nAn _italic_ line.  \r\nNext\r\n";
    await renderEditor(body);
    await clickMode("Markdown");
    expect(sourceEditor().value).toBe(body.replaceAll("\r\n", "\n"));
    expect(currentBody).toBe(body);
    await clickMode("Write");
    const editor = richEditor();
    await act(async () => editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!"));
    await act(async () => editor.commands.undo());
    expect(currentBody).toBe(body);
  });

  it("checks Markdown on paste and entering Write, without parsing on keystrokes", async () => {
    await renderEditor("Base");
    const editor = richEditor();
    if (!editor.markdown) throw new Error("Markdown extension was not initialized");
    const lexer = vi.spyOn(editor.markdown.instance, "lexer");
    const parse = vi.spyOn(MarkdownManager.prototype, "parse");
    for (const character of "typed") {
      await act(async () =>
        editor.commands.insertContentAt(editor.state.doc.content.size - 1, character),
      );
    }
    expect(parse).not.toHaveBeenCalled();
    expect(lexer).not.toHaveBeenCalled();

    await act(async () => {
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", {
        value: {
          files: [],
          getData: (type: string) => (type === "text/plain" ? "|a|b|\n|-|-|\n|1|2|" : ""),
        },
      });
      editor.view.dom.dispatchEvent(event);
    });
    expect(sourceEditor().value).toContain("|a|b|");
    await editSource("\\# literal heading");
    await clickMode("Write");
    expect(sourceEditor().value).toBe("\\# literal heading");
  });
});
