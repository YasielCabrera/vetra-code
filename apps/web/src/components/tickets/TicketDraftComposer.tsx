import { useAtomValue } from "@effect/atom-react";
import { matchComposerThreadItems } from "@t3tools/client-runtime/composerThreadItems";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  resolveEnvironmentMachineKind,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { serializeComposerFileLink } from "@t3tools/shared/composerTrigger";
import { FolderIcon } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ComponentProps } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import {
  collapseExpandedComposerCursor,
  composerSubmissionIntentForKey,
  detectComposerTrigger,
  replaceTextRange,
} from "../../composer-logic";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { useViewportWidth } from "../../hooks/useViewportWidth";
import { reviewCommentFromRecord, threadContextRecord } from "../../lib/composerContextRecords";
import { useComposerPathSearch } from "../../lib/composerPathSearchState";
import { useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { useEnvironmentTickets } from "../../state/tickets";
import { readPastedComposerContext } from "../composerInlineTokenPaste";
import { ComposerPromptEditor, type ComposerPromptEditorHandle } from "../ComposerPromptEditor";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";
import { type ComposerDraftContextRecord } from "../composerContextPresentation";
import {
  ComposerCommandMenu,
  type ComposerCommandItem,
  composerSuggestionOptionId,
} from "../chat/ComposerCommandMenu";
import { ComposerControlIcon, ComposerSelectControl } from "../chat/ComposerControl";
import { ComposerSurface } from "../chat/ComposerSurface";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { useComposerTriggerState } from "../chat/useComposerTriggerState";
import { shouldHandleComposerAttachmentPaste } from "../chat/composerAttachmentFiles";
import { Select, SelectItem, SelectPopup, SelectValue } from "../ui/select";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { matchComposerTicketItems } from "./composerTicketItems";
import {
  mergeTicketPromptRecords,
  prepareTicketDraftPaste,
  type TicketPromptRecord,
} from "./createTicketDraft.logic";
import { ticketContextRecord } from "./ticketContextRecord";
import { collectInlineContextIds } from "../../lib/composerContextReferences";

type ModelPickerProps = ComponentProps<typeof ProviderModelPicker>;

interface TicketDraftComposerProps {
  readonly environmentId: EnvironmentId;
  readonly onEnvironmentChange?: (environmentId: EnvironmentId) => void;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly project: EnvironmentProject | null;
  readonly onProjectChange: (projectId: ProjectId) => void;
  readonly sourceThreadId: ThreadId | null;
  readonly prompt: string;
  readonly onPromptChange: (prompt: string) => void;
  readonly promptRecords: ReadonlyArray<TicketPromptRecord>;
  readonly onPromptRecordsChange: (records: ReadonlyArray<TicketPromptRecord>) => void;
  readonly captureRecords: ReadonlyMap<string, ComposerDraftContextRecord>;
  readonly modelSelection: ModelSelection | null;
  readonly onModelChange: (selection: ModelSelection) => void;
  readonly instanceEntries: ModelPickerProps["instanceEntries"];
  readonly modelOptionsByInstance: ModelPickerProps["modelOptionsByInstance"];
  readonly disabled: boolean;
  readonly onSubmit: () => void;
}

/** A controlled composer: its lifetime is the dialog, with no real-thread draft or send machinery. */
export function TicketDraftComposer(props: TicketDraftComposerProps) {
  const settings = useEnvironmentSettings(props.environmentId);
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const { resolvedTheme } = useTheme();
  const viewportWidth = useViewportWidth();
  const { environments } = useEnvironments();
  const environment = environments.find((entry) => entry.environmentId === props.environmentId);
  const shells = useThreadShells();
  const editorRef = useRef<ComposerPromptEditorHandle | null>(null);
  const promptRecordsRef = useRef(props.promptRecords);
  useEffect(() => {
    promptRecordsRef.current = props.promptRecords;
  }, [props.promptRecords]);
  const [cursor, setCursor] = useState(() =>
    collapseExpandedComposerCursor(props.prompt, props.prompt.length),
  );
  const { trigger, setTrigger, dismissTrigger } = useComposerTriggerState(() => null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const listId = useId();
  const paths = useComposerPathSearch({
    environmentId: props.environmentId,
    cwd: trigger?.kind === "path" ? (props.project?.workspaceRoot ?? null) : null,
    query: trigger?.kind === "path" ? trigger.query : null,
  });
  const tickets = useEnvironmentTickets(
    trigger?.kind === "pull-request" ? props.environmentId : null,
  );
  const promptContextRecords = useMemo(() => {
    const referenced = new Set(collectInlineContextIds(props.prompt));
    const records = new Map<string, ComposerDraftContextRecord>();
    for (const [contextId, record] of props.captureRecords) {
      if (referenced.has(contextId)) records.set(contextId, record);
    }
    for (const record of props.promptRecords) {
      if (!referenced.has(record.contextId)) continue;
      switch (record.kind) {
        case "review-comment":
          records.set(record.contextId, {
            kind: "review-comment",
            record: reviewCommentFromRecord(record),
          });
          break;
        case "thread":
          records.set(record.contextId, { kind: "thread", record });
          break;
        case "ticket":
          records.set(record.contextId, { kind: "ticket", record });
          break;
      }
    }
    return records;
  }, [props.captureRecords, props.prompt, props.promptRecords]);
  const items = useMemo<ComposerCommandItem[]>(() => {
    if (trigger?.kind === "path") {
      return [
        ...matchComposerThreadItems({
          shells,
          environmentId: props.environmentId,
          excludeThreadId: props.sourceThreadId,
          query: trigger.query,
        }),
        ...paths.entries.map((entry) => ({
          id: `path:${entry.kind}:${entry.path}`,
          type: "path" as const,
          path: entry.path,
          pathKind: entry.kind,
          label: entry.path.split("/").at(-1) ?? entry.path,
          description: entry.path.slice(0, Math.max(0, entry.path.lastIndexOf("/"))),
        })),
      ];
    }
    return trigger?.kind === "pull-request"
      ? matchComposerTicketItems({
          tickets,
          environmentId: props.environmentId,
          query: trigger.query,
        })
      : [];
  }, [trigger, shells, props.environmentId, props.sourceThreadId, paths.entries, tickets]);
  const activeItem = items.find((item) => item.id === highlightedId) ?? items[0] ?? null;
  const activeInstance = props.instanceEntries.find(
    (entry) => entry.instanceId === props.modelSelection?.instanceId,
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => editorRef.current?.focusAtEnd());
    return () => cancelAnimationFrame(frame);
  }, []);

  const selectItem = (item: ComposerCommandItem) => {
    const snapshot = editorRef.current?.readSnapshot();
    if (!snapshot || !trigger) return;
    let record: TicketPromptRecord | null = null;
    let replacement: string;
    if (item.type === "path") replacement = serializeComposerFileLink(item.path);
    else if (item.type === "thread") {
      record = threadContextRecord(item.thread, item.label);
      replacement = formatComposerContextReference(record);
    } else if (item.type === "ticket") {
      record = ticketContextRecord({ environmentId: props.environmentId, ticket: item.ticket });
      replacement = formatComposerContextReference(record);
    } else return;
    const next = replaceTextRange(
      snapshot.value,
      trigger.rangeStart,
      trigger.rangeEnd,
      `${replacement} `,
    );
    if (record) {
      const nextRecords = mergeTicketPromptRecords(promptRecordsRef.current, [record]);
      promptRecordsRef.current = nextRecords;
      props.onPromptRecordsChange(nextRecords);
    }
    props.onPromptChange(next.text);
    setCursor(collapseExpandedComposerCursor(next.text, next.cursor));
    setTrigger(null);
    setHighlightedId(null);
    requestAnimationFrame(() =>
      editorRef.current?.focusAt(collapseExpandedComposerCursor(next.text, next.cursor)),
    );
  };

  const rememberPromptRecords = (records: ReadonlyArray<TicketPromptRecord>) => {
    if (records.length === 0) return;
    const nextRecords = mergeTicketPromptRecords(promptRecordsRef.current, records);
    promptRecordsRef.current = nextRecords;
    props.onPromptRecordsChange(nextRecords);
  };

  const insertPromptText = (text: string, records: ReadonlyArray<TicketPromptRecord>) => {
    const snapshot = editorRef.current?.readSnapshot();
    const selection = editorRef.current?.readSelectionRange();
    rememberPromptRecords(records);
    if (!snapshot || !selection) {
      props.onPromptChange(`${props.prompt}${text}`);
      return;
    }
    const next = replaceTextRange(snapshot.value, selection.start, selection.end, text);
    props.onPromptChange(next.text);
    const nextCursor = collapseExpandedComposerCursor(next.text, next.cursor);
    setCursor(nextCursor);
    requestAnimationFrame(() => editorRef.current?.focusAt(nextCursor));
  };

  const reportOmittedPaste = (input: { readonly attachment: boolean; readonly other: boolean }) => {
    if (!input.attachment && !input.other) return;
    toastManager.add({
      type: "error",
      title: input.attachment ? "Files can't be attached here" : "Some pasted context was left out",
      description: input.attachment
        ? "Ticket drafts can't include files. Add them on the ticket after it's created."
        : "Only threads, tickets, and review comments from this environment can be pasted.",
    });
  };

  return (
    <ComposerHandleContext value={null}>
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <ComposerSurface.Main>
            <div
              className="relative px-3 py-3 sm:px-4"
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes("Files")) event.preventDefault();
              }}
              onDrop={(event) => {
                if (event.dataTransfer.files.length === 0) return;
                event.preventDefault();
                reportOmittedPaste({ attachment: true, other: false });
              }}
            >
              <ComposerPromptEditor
                editorRef={editorRef}
                value={props.prompt}
                cursor={cursor}
                richTextEnabled={settings.composerRichTextEnabled}
                contextRecords={promptContextRecords}
                skills={[]}
                disabled={props.disabled}
                ariaLabel="What should the ticket cover?"
                placeholder="Describe the ticket, @tag files or threads, #T-123 for tickets"
                className="min-h-24 max-h-60"
                suggestionListId={listId}
                activeSuggestionId={
                  trigger && activeItem
                    ? composerSuggestionOptionId(listId, activeItem.id)
                    : undefined
                }
                onChange={(value, nextCursor, expandedCursor) => {
                  props.onPromptChange(value);
                  setCursor(nextCursor);
                  const nextTrigger = detectComposerTrigger(value, expandedCursor);
                  setTrigger(
                    nextTrigger?.kind === "path" || nextTrigger?.kind === "pull-request"
                      ? nextTrigger
                      : null,
                  );
                  setHighlightedId(null);
                }}
                onCommandKeyDown={(key, event) => {
                  if (trigger && key === "Escape") {
                    dismissTrigger(trigger);
                    return true;
                  }
                  if (trigger && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                    if ((key === "Enter" || key === "Tab") && activeItem) {
                      selectItem(activeItem);
                      return true;
                    }
                    if ((key === "ArrowDown" || key === "ArrowUp") && items.length > 0) {
                      const index = items.findIndex((item) => item.id === activeItem?.id);
                      const offset = key === "ArrowDown" ? 1 : -1;
                      const next = items[(index + offset + items.length) % items.length];
                      setHighlightedId(next?.id ?? null);
                      return true;
                    }
                  }
                  if (
                    composerSubmissionIntentForKey({
                      event,
                      keybindings,
                      isMobileViewport: viewportWidth < 640,
                      isDraftThread: false,
                      sendShortcut: settings.sendShortcut,
                      prompt: props.prompt,
                    })
                  ) {
                    if (!props.disabled) props.onSubmit();
                    return true;
                  }
                  return false;
                }}
                onCitationSubmitAndSend={() => {
                  if (!props.disabled) props.onSubmit();
                }}
                importContextFragment={(fragment) => {
                  const prepared = prepareTicketDraftPaste({
                    text: "",
                    records: fragment.records,
                    environmentId: props.environmentId,
                  });
                  rememberPromptRecords(prepared.records);
                  return prepared.rewrittenIds;
                }}
                onPaste={(event) => {
                  const files = Array.from(event.clipboardData.files);
                  const plainText = event.clipboardData.getData("text/plain");
                  const fragment = readPastedComposerContext(event.clipboardData);
                  const filePaste =
                    files.length > 0 && shouldHandleComposerAttachmentPaste({ files, plainText });
                  const prepared = prepareTicketDraftPaste({
                    text: plainText,
                    records: fragment?.records ?? [],
                    environmentId: props.environmentId,
                  });
                  const omit = filePaste || prepared.droppedAttachment || prepared.droppedOther;
                  if (!omit) return;
                  event.preventDefault();
                  event.stopPropagation();
                  reportOmittedPaste({
                    attachment: filePaste || prepared.droppedAttachment,
                    other: prepared.droppedOther,
                  });
                  if (prepared.text.length > 0) insertPromptText(prepared.text, prepared.records);
                }}
              />
              {trigger ? (
                <div
                  className="my-2 max-h-48 overflow-auto"
                  data-chat-composer-floating-layer="true"
                >
                  <ComposerCommandMenu
                    listId={listId}
                    items={items}
                    resolvedTheme={resolvedTheme}
                    triggerKind={trigger.kind}
                    isLoading={trigger.kind === "path" && paths.isPending}
                    emptyStateText={
                      trigger.kind === "path"
                        ? (paths.error ?? "No matching files or threads")
                        : "Type a ticket reference or title"
                    }
                    activeItemId={activeItem?.id ?? null}
                    onHighlightedItemChange={setHighlightedId}
                    onSelect={selectItem}
                  />
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap items-center gap-1">
                {props.modelSelection ? (
                  <>
                    <ProviderModelPicker
                      activeInstanceId={props.modelSelection.instanceId}
                      model={props.modelSelection.model}
                      lockedProvider={null}
                      instanceEntries={props.instanceEntries}
                      modelOptionsByInstance={props.modelOptionsByInstance}
                      disabled={props.disabled}
                      onInstanceModelChange={(instanceId, model) =>
                        props.onModelChange(createModelSelection(instanceId, model))
                      }
                    />
                    {activeInstance ? (
                      <TraitsPicker
                        provider={activeInstance.driverKind}
                        models={activeInstance.models}
                        model={props.modelSelection.model}
                        prompt={props.prompt}
                        onPromptChange={props.onPromptChange}
                        modelOptions={props.modelSelection.options ?? []}
                        allowPromptInjectedEffort={false}
                        planModeEnabled={false}
                        onModelOptionsChange={(options) => {
                          if (props.modelSelection)
                            props.onModelChange(
                              createModelSelection(
                                props.modelSelection.instanceId,
                                props.modelSelection.model,
                                options,
                              ),
                            );
                        }}
                      />
                    ) : null}
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">No model is available.</span>
                )}
                <Select
                  items={props.projects.map((project) => ({
                    value: project.id,
                    label: project.title,
                  }))}
                  value={props.project?.id ?? null}
                  disabled={props.disabled}
                  onValueChange={(value) => {
                    const project = props.projects.find((entry) => entry.id === value);
                    if (project) props.onProjectChange(project.id);
                  }}
                >
                  <ComposerSelectControl aria-label="Project">
                    <ComposerControlIcon icon={FolderIcon} />
                    <SelectValue placeholder="Choose a project" />
                  </ComposerSelectControl>
                  <SelectPopup>
                    {props.projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {props.onEnvironmentChange ? (
                  <Select
                    items={environments.map((entry) => ({
                      value: entry.environmentId,
                      label: entry.label,
                    }))}
                    value={props.environmentId}
                    disabled={props.disabled}
                    onValueChange={(value) => {
                      const next = environments.find((entry) => entry.environmentId === value);
                      if (next) props.onEnvironmentChange?.(next.environmentId);
                    }}
                  >
                    <ComposerSelectControl size="xs" aria-label="Run on">
                      <SelectValue />
                    </ComposerSelectControl>
                    <SelectPopup>
                      {environments.map((entry) => (
                        <SelectItem key={entry.environmentId} value={entry.environmentId}>
                          {entry.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span className="inline-flex items-center gap-1 px-1.75 text-xs text-muted-foreground" />
                      }
                    >
                      <EnvironmentMachineIcon
                        kind={resolveEnvironmentMachineKind(environment?.serverConfig ?? null)}
                        className="size-3"
                      />
                      {environment?.label ?? "Source environment"}
                    </TooltipTrigger>
                    <TooltipPopup>Captured context belongs to this environment.</TooltipPopup>
                  </Tooltip>
                )}
              </div>
            </div>
          </ComposerSurface.Main>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
    </ComposerHandleContext>
  );
}
