import { useAtomValue } from "@effect/atom-react";
import { useNavigate } from "@tanstack/react-router";
import { subscribe } from "@t3tools/client-runtime/rpc";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentSubscriptionAtomFamily,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import {
  ORCHESTRATION_V2_WS_METHODS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  WS_METHODS,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";

import { environmentCatalog } from "../../connection/catalog";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentSettings } from "../../hooks/useSettings";
import { reviewCommentFromRecord } from "../../lib/composerContextRecords";
import { collectInlineContextIds } from "../../lib/composerContextReferences";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  resolveSelectableProviderInstanceEntry,
} from "../../providerInstances";
import { useProjects, useThreadShell } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { ticketEnvironment, useEnvironmentTickets } from "../../state/tickets";
import { useAtomCommand } from "../../state/use-atom-command";
import { type ComposerDraftContextRecord } from "../composerContextPresentation";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  draftOutcome,
  ticketCaptureSelection,
  type TicketCapture,
  type TicketCaptureItem,
  type TicketDraftAnalyzer,
} from "./ticketCapture";
import {
  ticketDraftModelSelection,
  ticketDraftPayload,
  ticketManualPrefill,
  type TicketPromptRecord,
} from "./createTicketDraft.logic";
import type { TicketDraftComposer } from "./TicketDraftComposer";
import { formatTicketRef } from "./ticketRefs";

const useCreateTicketRequest = create<{
  readonly capture: TicketCapture | null;
  readonly requestId: number;
}>(() => ({
  capture: null,
  requestId: 0,
}));

export function openCreateTicketDialog(capture: TicketCapture) {
  useCreateTicketRequest.setState((state) => ({
    capture,
    requestId: state.requestId + 1,
  }));
}

function closeCreateTicketDialog() {
  useCreateTicketRequest.setState((state) => ({ capture: null, requestId: state.requestId }));
}

interface PendingDraft {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly toastId: string;
}

const usePendingDrafts = create<{ readonly drafts: ReadonlyArray<PendingDraft> }>(() => ({
  drafts: [],
}));

const draftAnalyzerPresence = createEnvironmentSubscriptionAtomFamily(connectionAtomRuntime, {
  label: "web-ticket-draft:analyzer-presence",
  idleTtlMs: 0,
  subscribe: (input: { readonly threadId: ThreadId }) =>
    subscribe(ORCHESTRATION_V2_WS_METHODS.subscribeShell, {}).pipe(
      Stream.map((item) => {
        switch (item.kind) {
          case "snapshot":
            return item.snapshot.threads.some((thread) => thread.id === input.threadId);
          case "thread.updated":
            return item.thread.id === input.threadId ? item.location === "active" : null;
          case "thread.removed":
            return item.threadId === input.threadId ? false : null;
          default:
            return null;
        }
      }),
      Stream.filter((present) => present !== null),
    ),
});

const settledDraftTickets = createEnvironmentQueryAtomFamily(connectionAtomRuntime, {
  label: "web-ticket-draft:settled-tickets",
  idleTtlMs: 0,
  staleTimeMs: 0,
  execute: (_input: { readonly threadId: ThreadId; readonly runId: RunId }) =>
    subscribe(WS_METHODS.ticketsSubscribe, {}).pipe(
      Stream.filter((event) => event.type === "snapshot"),
      Stream.map((event) => event.tickets),
      Stream.runHead,
      Effect.map(Option.getOrNull),
    ),
});

export function CreateTicketDialogHost() {
  const capture = useCreateTicketRequest((state) => state.capture);
  const requestId = useCreateTicketRequest((state) => state.requestId);
  const drafts = usePendingDrafts((state) => state.drafts);
  return (
    <>
      {capture ? <CreateTicketDialog key={requestId} capture={capture} /> : null}
      {drafts.map((draft) => (
        <PendingDraftWatcher key={`${draft.environmentId}:${draft.threadId}`} draft={draft} />
      ))}
    </>
  );
}

function PendingDraftWatcher(props: { readonly draft: PendingDraft }) {
  const { draft } = props;
  const navigate = useNavigate();
  const tickets = useEnvironmentTickets(draft.environmentId);
  const analyzer = useThreadShell({ environmentId: draft.environmentId, threadId: draft.threadId });
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const environmentRemoved = catalog.isReady && !catalog.entries.has(draft.environmentId);
  const presence = useEnvironmentQuery(
    analyzer === null && !environmentRemoved
      ? draftAnalyzerPresence({
          environmentId: draft.environmentId,
          input: { threadId: draft.threadId },
        })
      : null,
  );
  const analyzerState: TicketDraftAnalyzer =
    environmentRemoved || presence.data === false
      ? { type: "removed" }
      : analyzer === null
        ? { type: "loading" }
        : { type: "present", shell: analyzer };
  const pendingOutcome = draftOutcome(tickets, draft.threadId, analyzerState);
  const confirmation = useEnvironmentQuery(
    pendingOutcome?.type === "confirming"
      ? settledDraftTickets({
          environmentId: draft.environmentId,
          input: { threadId: draft.threadId, runId: pendingOutcome.runId },
        })
      : null,
  );
  const confirmedTickets = useMemo(
    () =>
      confirmation.data?.map((ticket) => ({ ...ticket, environmentId: draft.environmentId })) ??
      null,
    [confirmation.data, draft.environmentId],
  );
  const outcome =
    pendingOutcome?.type === "confirming"
      ? draftOutcome(tickets, draft.threadId, analyzerState, confirmedTickets)
      : pendingOutcome;
  useEffect(() => {
    if (outcome === null || outcome.type === "confirming") return;
    let watching = false;
    usePendingDrafts.setState((state) => {
      watching = state.drafts.includes(draft);
      return watching ? { drafts: state.drafts.filter((entry) => entry !== draft) } : state;
    });
    if (!watching) return;
    toastManager.close(draft.toastId);
    if (outcome.type === "removed") return;
    if (outcome.type === "abandoned") {
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "No ticket was filed",
          description: "The agent finished without filing one. Its thread has what it found.",
          actionProps: {
            children: "Open thread",
            onClick: () =>
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId: draft.environmentId, threadId: draft.threadId },
              }),
          },
          data: { hideCopyButton: true },
        }),
      );
      return;
    }
    const { ticket } = outcome;
    const toastId = toastManager.add(
      stackedThreadToast({
        type: "success",
        title: `${formatTicketRef(ticket)} created`,
        description: ticket.title,
        timeout: 10_000,
        actionProps: {
          children: "Open ticket",
          onClick: () => {
            toastManager.close(toastId);
            void navigate({
              to: "/tickets/$ticketKey",
              params: {
                ticketKey: ticketKey({ environmentId: ticket.environmentId, ticketId: ticket.id }),
              },
            });
          },
        },
        data: { hideCopyButton: true },
      }),
    );
  }, [draft, navigate, outcome]);
  return null;
}

function captureChipRecords(
  items: ReadonlyArray<TicketCaptureItem>,
): ReadonlyMap<string, ComposerDraftContextRecord> {
  const records = new Map<string, ComposerDraftContextRecord>();
  for (const item of items) {
    if (item.type !== "context") continue;
    const { record } = item;
    records.set(
      record.contextId,
      record.kind === "thread"
        ? { kind: "thread", record }
        : { kind: "review-comment", record: reviewCommentFromRecord(record) },
    );
  }
  return records;
}

function CreateTicketDialog(props: { readonly capture: TicketCapture }) {
  const { capture } = props;
  const [environmentId, setEnvironmentId] = useState(capture.environmentId);
  const navigate = useNavigate();
  const projects = useProjects();
  const sourceThread = useThreadShell(
    capture.sourceThreadId === null ? null : { environmentId, threadId: capture.sourceThreadId },
  );
  const settings = useEnvironmentSettings(environmentId);
  const providers =
    useAtomValue(serverEnvironment.configValueAtom(environmentId))?.providers ??
    EMPTY_SERVER_PROVIDERS;
  const launchDraft = useAtomCommand(ticketEnvironment.launchDraft, { reportFailure: false });

  const [instruction, setInstruction] = useState(() => ticketCaptureSelection(capture.items).text);
  const [promptRecords, setPromptRecords] = useState<ReadonlyArray<TicketPromptRecord>>([]);
  const [chosenProjectId, setChosenProjectId] = useState<ProjectId | null>(capture.projectId);
  const [chosenModel, setChosenModel] = useState<ModelSelection | null>(null);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const [Composer, setComposer] = useState<typeof TicketDraftComposer | null>(null);
  useEffect(() => {
    let closed = false;
    void import("./TicketDraftComposer").then((module) => {
      if (!closed) setComposer(() => module.TicketDraftComposer);
    });
    return () => {
      closed = true;
    };
  }, []);

  const environmentProjects = useMemo(
    () => projects.filter((project) => project.environmentId === environmentId),
    [environmentId, projects],
  );
  const chosenProject =
    chosenProjectId === null
      ? null
      : (environmentProjects.find((candidate) => candidate.id === chosenProjectId) ?? null);
  const sourceProject =
    sourceThread === null
      ? null
      : (environmentProjects.find((candidate) => candidate.id === sourceThread.projectId) ?? null);
  // A captured project that no longer exists falls through to the source thread's project.
  const project = chosenProject ?? sourceProject;
  const instanceEntries = useMemo(
    () => applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
    [providers, settings],
  );
  const modelOptionsByInstance = useMemo(
    () => getCustomModelOptionsByInstance(settings, providers),
    [providers, settings],
  );
  const storedSelection =
    chosenModel ??
    resolveProjectSettings(settings, project?.id ?? null, project).settings.defaultModelSelection ??
    null;
  const selectableEntry = resolveSelectableProviderInstanceEntry(
    instanceEntries,
    storedSelection?.instanceId,
  );
  const modelSelection = selectableEntry
    ? ticketDraftModelSelection({
        instanceId: selectableEntry.instanceId,
        driverKind: selectableEntry.driverKind,
        models: selectableEntry.models,
        stored: storedSelection,
        planModeEnabled: false,
      })
    : null;
  const chipRecords = useMemo(() => captureChipRecords(capture.items), [capture.items]);
  const draft = useMemo(
    () => ticketDraftPayload(instruction, capture.items, promptRecords),
    [capture.items, instruction, promptRecords],
  );
  const hasSelection = capture.items.length > 0;
  const instructionTooLong = draft.instruction.length > 4_000;
  const selectionTooLong = draft.selection.text.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS;
  const hasDraftContent = draft.instruction.length > 0 || draft.selection.text.trim().length > 0;
  const canLaunch =
    project !== null &&
    modelSelection !== null &&
    !launching &&
    !instructionTooLong &&
    !selectionTooLong &&
    hasDraftContent;

  const launch = async () => {
    if (launchingRef.current || !canLaunch || project === null || modelSelection === null) return;
    const launchedRequestId = useCreateTicketRequest.getState().requestId;
    launchingRef.current = true;
    setLaunching(true);
    try {
      const result = await launchDraft({
        environmentId,
        input: {
          projectId: project.id,
          ...(capture.sourceThreadId === null ? {} : { sourceThreadId: capture.sourceThreadId }),
          instruction: draft.instruction,
          selection: draft.selection,
          modelSelection,
        },
      });
      if (result._tag === "Failure") {
        if (isAtomCommandInterrupted(result)) return;
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not start drafting the ticket",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
        return;
      }
      const { threadId } = result.value;
      const toastId = toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Drafting ticket",
          description: "An agent is investigating and will file the ticket.",
          timeout: 8_000,
          actionProps: {
            children: "Open thread",
            onClick: () =>
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId },
              }),
          },
          data: { hideCopyButton: true },
        }),
      );
      usePendingDrafts.setState((state) => ({
        drafts: [...state.drafts, { environmentId, threadId, toastId }],
      }));
      if (useCreateTicketRequest.getState().requestId === launchedRequestId) {
        closeCreateTicketDialog();
      }
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  };

  const writeItMyself = () => {
    const { title, body } = ticketManualPrefill(instruction, capture.items);
    closeCreateTicketDialog();
    void navigate({
      to: "/tickets/new",
      search: {
        env: environmentId,
        ...(title ? { title } : {}),
        ...(body ? { body } : {}),
        ...(project === null ? {} : { project: project.id }),
        ...(capture.sourceThreadId === null ? {} : { thread: capture.sourceThreadId }),
      },
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeCreateTicketDialog();
      }}
    >
      <DialogPopup className="sm:max-w-2xl">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void launch();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create ticket</DialogTitle>
            <DialogDescription>
              An agent investigates without editing files, then files the ticket.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            {Composer ? (
              <Composer
                key={environmentId}
                environmentId={environmentId}
                {...(!hasSelection &&
                capture.sourceThreadId === null &&
                collectInlineContextIds(instruction).length === 0
                  ? {
                      onEnvironmentChange: (next: EnvironmentId) => {
                        setEnvironmentId(next);
                        setChosenProjectId(null);
                        setChosenModel(null);
                        setPromptRecords([]);
                      },
                    }
                  : {})}
                projects={environmentProjects}
                project={project}
                onProjectChange={setChosenProjectId}
                sourceThreadId={capture.sourceThreadId}
                prompt={instruction}
                onPromptChange={setInstruction}
                promptRecords={promptRecords}
                onPromptRecordsChange={setPromptRecords}
                captureRecords={chipRecords}
                modelSelection={modelSelection}
                onModelChange={setChosenModel}
                instanceEntries={instanceEntries}
                modelOptionsByInstance={modelOptionsByInstance}
                disabled={launching}
                onSubmit={() => void launch()}
              />
            ) : (
              <div className="h-44" />
            )}
            {instructionTooLong ? (
              <p role="alert" className="text-sm text-destructive">
                Shorten the instruction to 4,000 characters before creating with an agent.
              </p>
            ) : null}
            {selectionTooLong ? (
              <p role="alert" className="text-sm text-destructive">
                The captured selection is too long to send. Delete part of it and try again.
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={launching} onClick={writeItMyself}>
              Write it myself
            </Button>
            <Button type="submit" disabled={!canLaunch}>
              {launching ? "Starting…" : "Create with agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
