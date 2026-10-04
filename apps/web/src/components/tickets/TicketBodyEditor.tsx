import Image from "@tiptap/extension-image";
import Paragraph from "@tiptap/extension-paragraph";
import Placeholder from "@tiptap/extension-placeholder";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { Markdown, MarkdownManager } from "@tiptap/markdown";
import { TICKET_BODY_MAX_CHARS } from "@t3tools/contracts";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  BoldIcon,
  CodeIcon,
  FileCodeIcon,
  Heading2Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  PaperclipIcon,
  QuoteIcon,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  attachmentReferenceMarkdown,
  replaceClaimedAttachmentReferences,
} from "../../lib/attachmentReferences";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { claimedAttachmentChanges, synchronizeAttachmentClaims } from "./ticketAttachmentClaims";

const TicketImage = Image.extend({
  parseHTML() {
    return [
      ...(this.parent?.() ?? []),
      {
        tag: "span[data-ticket-attachment]",
        getAttrs: (element) => ({
          src: element.getAttribute("data-ticket-attachment"),
          alt: element.getAttribute("data-ticket-attachment-name") ?? "Attachment",
        }),
      },
    ];
  },
  renderMarkdown(node, helpers, context) {
    const src: unknown = node.attrs?.src;
    const alt: unknown = node.attrs?.alt;
    if (typeof src === "string" && src.startsWith("vetra-attachment://")) {
      return attachmentReferenceMarkdown({
        attachmentId: src.slice("vetra-attachment://".length),
        name: typeof alt === "string" ? alt : "Attachment",
        embed: true,
      });
    }
    return Image.config.renderMarkdown?.call(this, node, helpers, context) ?? "";
  },
  renderHTML({ HTMLAttributes }) {
    const src: unknown = HTMLAttributes.src;
    if (typeof src === "string" && src.startsWith("vetra-attachment://")) {
      const alt: unknown = HTMLAttributes.alt;
      return [
        "span",
        {
          "data-ticket-attachment": src,
          "data-ticket-attachment-name": typeof alt === "string" ? alt : "Attachment",
          contenteditable: "false",
        },
        `📎 ${typeof alt === "string" ? alt : "Attachment"}`,
      ];
    }
    return ["img", HTMLAttributes];
  },
}).configure({ inline: true });

// Inline images need paragraph wrappers; empty paragraphs should not become HTML entities.
const TicketParagraph = Paragraph.extend({
  renderMarkdown(node, helpers) {
    return helpers.renderChildren(node.content ?? []);
  },
  parseMarkdown(token, helpers) {
    if (token.tokens?.length === 1 && token.tokens[0]?.type === "image") {
      return helpers.createNode("paragraph", undefined, helpers.parseInline(token.tokens));
    }
    return Paragraph.config.parseMarkdown?.call(this, token, helpers) ?? [];
  },
});

const DOCUMENT_EXTENSIONS = [
  StarterKit.configure({
    paragraph: false,
    underline: false,
    trailingNode: false,
    link: { openOnClick: false, protocols: ["vetra-attachment"] },
  }),
  TicketParagraph,
  TaskList,
  TaskItem.configure({ nested: true }),
  TicketImage,
  Markdown,
];
const markdownManager = new MarkdownManager({ extensions: DOCUMENT_EXTENSIONS });

function needsSourceEditing(markdown: string): boolean {
  let unsupported = /^(---|\+\+\+)\r?\n/.test(markdown);
  markdownManager.instance.walkTokens(markdownManager.instance.lexer(markdown), (token) => {
    if (token.type === "html" || token.type === "table") unsupported = true;
    if (token.type !== "code" && token.type !== "codespan" && /\[\^[^\]]+\]/.test(token.raw)) {
      unsupported = true;
    }
  });
  if (unsupported) return true;
  const document = markdownManager.parse(markdown);
  const roundTrip = markdownManager.parse(markdownManager.serialize(document));
  return JSON.stringify(document) !== JSON.stringify(roundTrip);
}

function synchronizeDocument(editor: Editor, markdown: string) {
  editor
    .chain()
    .setMeta("addToHistory", false)
    .setContent(markdown, { contentType: "markdown", emitUpdate: false })
    .run();
  return { markdown, document: JSON.stringify(editor.getJSON()) };
}

function FormatButton(props: {
  readonly label: string;
  readonly active?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={props.active ? "secondary" : "ghost"}
      size="icon-xs"
      aria-label={props.label}
      aria-pressed={props.active ?? false}
      title={props.label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onClick}
    >
      {props.children}
    </Button>
  );
}

const DOCUMENT_COPY = {
  ticket: {
    tooLong: "This description exceeds the 100,000 character limit. Shorten it to save the ticket.",
    unsupported:
      "This description uses Markdown that needs source editing to preserve its formatting.",
  },
  plan: {
    tooLong: "This plan exceeds the 100,000 character limit. Shorten it to save the plan.",
    unsupported: "This plan uses Markdown that needs source editing to preserve its formatting.",
  },
} as const;

/** Keeps the supplied Markdown byte-exact until a document edit; unsupported syntax stays in source mode. */
export default function TicketBodyEditor(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onFiles: (files: ReadonlyArray<File>) => Promise<ReadonlyArray<string>>;
  readonly placeholder: string;
  readonly ariaLabel: string;
  readonly autoFocus?: boolean;
  readonly disabled?: boolean;
  /** Covers upload and insertion, so a document cannot be archived between them. */
  readonly onUploadingChange?: (uploading: boolean) => void;
  readonly minHeight: string;
  /** Whose body this is, for the warnings; a ticket's description by default. */
  readonly document?: keyof typeof DOCUMENT_COPY;
}) {
  const copy = DOCUMENT_COPY[props.document ?? "ticket"];
  const [documentMode, setDocumentMode] = useState<{
    mode: "write" | "source";
    unsupported: boolean;
  }>(() => {
    const unsupported = needsSourceEditing(props.value);
    return { mode: unsupported ? "source" : "write", unsupported };
  });
  const { mode, unsupported } = documentMode;
  const modeRef = useRef(mode);
  const claimedRef = useRef<ReturnType<typeof claimedAttachmentChanges>>([]);
  const [uploading, setUploading] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const mountedRef = useRef(true);
  const latestRef = useRef(props);
  useLayoutEffect(() => {
    latestRef.current = props;
    modeRef.current = mode;
  }, [props, mode]);
  const lastValueRef = useRef(props.value);
  const originalRef = useRef({
    markdown: props.value,
    document: "",
  });

  const editor = useEditor({
    extensions: [...DOCUMENT_EXTENSIONS, Placeholder.configure({ placeholder: props.placeholder })],
    content: unsupported ? "" : props.value,
    contentType: "markdown",
    autofocus: props.autoFocus && mode === "write" ? "end" : false,
    editable: !props.disabled,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-label": props.ariaLabel,
        "aria-multiline": "true",
        class: "outline-none",
      },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length > 0) {
          event.preventDefault();
          void attachFiles(files, "write");
          return true;
        }
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (text) {
          // Unsupported pasted Markdown must not disappear through a rich-text parser.
          if (needsSourceEditing(text)) {
            event.preventDefault();
            const next = [latestRef.current.value, text].filter(Boolean).join("\n\n");
            lastValueRef.current = next;
            latestRef.current.onChange(next);
            modeRef.current = "source";
            setDocumentMode({ mode: "source", unsupported: true });
            return true;
          }
          if (!event.clipboardData?.getData("text/html")) {
            event.preventDefault();
            editor?.commands.insertContent(text, { contentType: "markdown" });
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event, _slice, moved) => {
        const files = [...(event.dataTransfer?.files ?? [])];
        if (moved || files.length === 0) return false;
        event.preventDefault();
        const position = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (position) editor?.commands.setTextSelection(position.pos);
        void attachFiles(files, "write");
        return true;
      },
    },
    onCreate: ({ editor: createdEditor }) => {
      originalRef.current = {
        markdown: latestRef.current.value,
        document: JSON.stringify(createdEditor.getJSON()),
      };
    },
    onUpdate: ({ editor: updatedEditor, transaction }) => {
      if (!transaction.docChanged || modeRef.current !== "write") return;
      synchronizeAttachmentClaims(updatedEditor, claimedRef.current);
      const next =
        JSON.stringify(updatedEditor.getJSON()) === originalRef.current.document
          ? originalRef.current.markdown
          : replaceClaimedAttachmentReferences(updatedEditor.getMarkdown(), claimedRef.current);
      lastValueRef.current = next;
      latestRef.current.onChange(next);
    },
  });
  const formatting = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive("bold"),
      italic: current?.isActive("italic"),
      heading: current?.isActive("heading"),
      bulletList: current?.isActive("bulletList"),
      orderedList: current?.isActive("orderedList"),
      taskList: current?.isActive("taskList"),
      blockquote: current?.isActive("blockquote"),
      code: current?.isActive("code"),
      codeBlock: current?.isActive("codeBlock"),
      link: current?.isActive("link"),
    }),
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      latestRef.current.onUploadingChange?.(false);
    };
  }, []);

  const { onUploadingChange } = props;
  useEffect(() => {
    onUploadingChange?.(uploading > 0);
  }, [onUploadingChange, uploading]);

  useLayoutEffect(() => {
    editor?.setEditable(!props.disabled);
  }, [editor, props.disabled]);

  useLayoutEffect(() => {
    if (!editor || props.value === lastValueRef.current) return;
    const claimed = claimedAttachmentChanges(lastValueRef.current, props.value);
    lastValueRef.current = props.value;
    if (claimed.length > 0) {
      claimedRef.current.push(...claimed);
      synchronizeAttachmentClaims(editor, claimedRef.current);
      originalRef.current = {
        markdown: replaceClaimedAttachmentReferences(originalRef.current.markdown, claimed),
        document: replaceClaimedAttachmentReferences(originalRef.current.document, claimed),
      };
      return;
    }
    const unsupported = needsSourceEditing(props.value);
    if (unsupported) modeRef.current = "source";
    setDocumentMode({ mode: modeRef.current, unsupported });
    if (modeRef.current === "write") {
      originalRef.current = synchronizeDocument(editor, props.value);
    }
  }, [editor, props.value]);

  async function attachFiles(files: ReadonlyArray<File>, targetMode: "write" | "source") {
    if (files.length === 0 || latestRef.current.disabled) return;
    setUploading((count) => count + 1);
    try {
      const snippets = await latestRef.current.onFiles(files);
      if (!mountedRef.current || snippets.length === 0) return;
      const insert = snippets.join("\n\n");
      if (targetMode === "write" && sourceRef.current === null && !editor?.isDestroyed) {
        editor?.chain().focus().insertContent(insert, { contentType: "markdown" }).run();
      } else {
        const textarea = sourceRef.current;
        const value = textarea?.value ?? latestRef.current.value;
        const from = textarea?.selectionStart ?? value.length;
        const to = textarea?.selectionEnd ?? from;
        const next = value.slice(0, from) + insert + value.slice(to);
        lastValueRef.current = next;
        latestRef.current.onChange(next);
      }
    } finally {
      if (mountedRef.current) setUploading((count) => count - 1);
    }
  }

  function switchToWrite() {
    if (!editor) return;
    const unsupported = needsSourceEditing(props.value);
    if (unsupported) {
      setDocumentMode({ mode: "source", unsupported: true });
      return;
    }
    originalRef.current = synchronizeDocument(editor, props.value);
    modeRef.current = "write";
    setDocumentMode({ mode: "write", unsupported: false });
  }

  const sourceMode = mode === "source";
  return (
    <div className="flex flex-col gap-3">
      <fieldset
        disabled={props.disabled}
        className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-2"
      >
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Formatting">
          {sourceMode ? (
            <span className="px-1 text-xs text-muted-foreground">Raw Markdown</span>
          ) : (
            <>
              <FormatButton
                label="Heading"
                active={formatting?.heading}
                onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
              >
                <Heading2Icon />
              </FormatButton>
              <FormatButton
                label="Bold"
                active={formatting?.bold}
                onClick={() => editor?.chain().focus().toggleBold().run()}
              >
                <BoldIcon />
              </FormatButton>
              <FormatButton
                label="Italic"
                active={formatting?.italic}
                onClick={() => editor?.chain().focus().toggleItalic().run()}
              >
                <ItalicIcon />
              </FormatButton>
              <FormatButton
                label="Bullet list"
                active={formatting?.bulletList}
                onClick={() => editor?.chain().focus().toggleBulletList().run()}
              >
                <ListIcon />
              </FormatButton>
              <FormatButton
                label="Numbered list"
                active={formatting?.orderedList}
                onClick={() => editor?.chain().focus().toggleOrderedList().run()}
              >
                <ListOrderedIcon />
              </FormatButton>
              <FormatButton
                label="Task list"
                active={formatting?.taskList}
                onClick={() => editor?.chain().focus().toggleTaskList().run()}
              >
                <ListTodoIcon />
              </FormatButton>
              <FormatButton
                label="Quote"
                active={formatting?.blockquote}
                onClick={() => editor?.chain().focus().toggleBlockquote().run()}
              >
                <QuoteIcon />
              </FormatButton>
              <FormatButton
                label="Inline code"
                active={formatting?.code}
                onClick={() => editor?.chain().focus().toggleCode().run()}
              >
                <CodeIcon />
              </FormatButton>
              <FormatButton
                label="Code block"
                active={formatting?.codeBlock}
                onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
              >
                <FileCodeIcon />
              </FormatButton>
              <Popover open={linkOpen && !props.disabled} onOpenChange={setLinkOpen}>
                <PopoverTrigger
                  render={
                    <Button
                      type="button"
                      size="icon-xs"
                      variant={formatting?.link ? "secondary" : "ghost"}
                      aria-label="Link"
                      title="Link"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => setLinkUrl(editor?.getAttributes("link").href ?? "")}
                    />
                  }
                >
                  <LinkIcon />
                </PopoverTrigger>
                <PopoverPopup width="sm" padding="compact" align="start">
                  <div className="flex flex-col gap-2">
                    <Input
                      aria-label="Link URL"
                      placeholder="https://…"
                      value={linkUrl}
                      onChange={(event) => setLinkUrl(event.target.value)}
                    />
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          editor?.chain().focus().extendMarkRange("link").unsetLink().run();
                          setLinkOpen(false);
                        }}
                      >
                        Remove
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        disabled={!linkUrl.trim()}
                        onClick={() => {
                          editor
                            ?.chain()
                            .focus()
                            .extendMarkRange("link")
                            .setLink({ href: linkUrl.trim() })
                            .run();
                          setLinkOpen(false);
                        }}
                      >
                        Apply
                      </Button>
                    </div>
                  </div>
                </PopoverPopup>
              </Popover>
            </>
          )}
          <FormatButton label="Attach files" onClick={() => fileInputRef.current?.click()}>
            <PaperclipIcon />
          </FormatButton>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            aria-label="Attachment files"
            onChange={(event) => {
              void attachFiles([...(event.target.files ?? [])], sourceMode ? "source" : "write");
              event.target.value = "";
            }}
          />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Editor mode">
          <Button
            type="button"
            size="xs"
            variant={sourceMode ? "ghost" : "secondary"}
            disabled={uploading > 0}
            onClick={switchToWrite}
          >
            Write
          </Button>
          <Button
            type="button"
            size="xs"
            variant={sourceMode ? "secondary" : "ghost"}
            disabled={uploading > 0}
            onClick={() => {
              modeRef.current = "source";
              setDocumentMode({ mode: "source", unsupported: false });
            }}
          >
            Markdown
          </Button>
        </div>
      </fieldset>
      {props.value.length > TICKET_BODY_MAX_CHARS ? (
        <p className="text-xs text-destructive" role="alert">
          {copy.tooLong}
        </p>
      ) : null}
      {unsupported ? <p className="text-xs text-muted-foreground">{copy.unsupported}</p> : null}
      {sourceMode ? (
        <textarea
          ref={sourceRef}
          value={props.value}
          aria-label={props.ariaLabel}
          placeholder={props.placeholder}
          autoFocus={props.autoFocus}
          disabled={props.disabled}
          style={{ minHeight: props.minHeight }}
          className="w-full resize-y bg-transparent px-1 py-2 font-mono text-sm leading-7 outline-none placeholder:text-muted-foreground/60"
          onChange={(event) => {
            const next = replaceClaimedAttachmentReferences(event.target.value, claimedRef.current);
            lastValueRef.current = next;
            setDocumentMode({ mode: "source", unsupported: false });
            props.onChange(next);
          }}
          onPaste={(event) => {
            const files = [...event.clipboardData.files];
            if (files.length > 0) {
              event.preventDefault();
              void attachFiles(files, "source");
            }
          }}
          onDrop={(event) => {
            const files = [...event.dataTransfer.files];
            if (files.length > 0) {
              event.preventDefault();
              void attachFiles(files, "source");
            }
          }}
        />
      ) : (
        <div
          style={{ minHeight: props.minHeight }}
          className="text-sm leading-7 [&_.tiptap]:min-h-[inherit] [&_.tiptap]:px-1 [&_.tiptap]:py-2 [&_.tiptap]:break-words [&_.tiptap_p]:my-2 [&_.tiptap_h1]:mt-6 [&_.tiptap_h1]:mb-3 [&_.tiptap_h1]:text-2xl [&_.tiptap_h1]:font-semibold [&_.tiptap_h2]:mt-5 [&_.tiptap_h2]:mb-2 [&_.tiptap_h2]:text-xl [&_.tiptap_h2]:font-semibold [&_.tiptap_h3]:mt-4 [&_.tiptap_h3]:font-semibold [&_.tiptap_ul]:list-disc [&_.tiptap_ul]:pl-6 [&_.tiptap_ol]:list-decimal [&_.tiptap_ol]:pl-6 [&_.tiptap_li_p]:my-0 [&_.tiptap_blockquote]:border-l-2 [&_.tiptap_blockquote]:border-border [&_.tiptap_blockquote]:pl-4 [&_.tiptap_blockquote]:text-muted-foreground [&_.tiptap_pre]:my-3 [&_.tiptap_pre]:overflow-x-auto [&_.tiptap_pre]:rounded-lg [&_.tiptap_pre]:bg-muted/60 [&_.tiptap_pre]:p-4 [&_.tiptap_pre]:text-xs [&_.tiptap_code]:rounded [&_.tiptap_code]:bg-muted/60 [&_.tiptap_code]:px-1 [&_.tiptap_code]:font-mono [&_.tiptap_pre_code]:bg-transparent [&_.tiptap_pre_code]:p-0 [&_.tiptap_a]:text-primary [&_.tiptap_a]:underline [&_.tiptap_img]:max-w-full [&_.tiptap_img]:rounded-md [&_[data-ticket-attachment]]:rounded-md [&_[data-ticket-attachment]]:border [&_[data-ticket-attachment]]:border-border [&_[data-ticket-attachment]]:px-2 [&_[data-ticket-attachment]]:py-1 [&_[data-ticket-attachment]]:text-xs [&_ul[data-type=taskList]]:list-none [&_ul[data-type=taskList]]:pl-0 [&_ul[data-type=taskList]>li]:flex [&_ul[data-type=taskList]>li]:items-start [&_ul[data-type=taskList]>li]:gap-2 [&_ul[data-type=taskList]>li>label]:mt-0.5 [&_ul[data-type=taskList]>li>div]:min-w-0 [&_ul[data-type=taskList]>li>div]:flex-1 [&_input[type=checkbox]]:accent-primary [&_.is-editor-empty:first-child:before]:pointer-events-none [&_.is-editor-empty:first-child:before]:float-left [&_.is-editor-empty:first-child:before]:h-0 [&_.is-editor-empty:first-child:before]:text-muted-foreground/60 [&_.is-editor-empty:first-child:before]:content-[attr(data-placeholder)]"
        >
          <EditorContent editor={editor} style={{ minHeight: props.minHeight }} />
        </div>
      )}
      <p className="text-xs text-muted-foreground" role="status">
        {uploading > 0
          ? "Attaching files…"
          : "Use Markdown shortcuts or the toolbar. Paste or drop files to attach them."}
      </p>
    </div>
  );
}
import type { Editor } from "@tiptap/core";
