import {
  AssistantCitation,
  ChatFileAttachment,
  ChatImageAttachment,
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ReviewCommentContextRecord,
  ThreadContextRecord,
  ThreadId,
  TicketContextRecord,
  TicketId,
  TicketStatusId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { createStore } from "zustand/vanilla";
import { attachmentReferenceIds } from "./lib/attachmentReferences";

import {
  releasePersistedAttachmentUpload,
  verifyStashedAttachmentUpload,
} from "./lib/attachmentUploadQueue";
import { createDeferredStorage, createMemoryStorage, type StateStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";
import { uploadTicketFiles } from "./components/tickets/ticketAttachments";
import { ticketCaptureSelection, type TicketCapture } from "./components/tickets/ticketCapture";
import type { NewTicketSearch } from "./components/tickets/ticketDraft.logic";

const PendingUpload = Schema.Struct({
  localId: Schema.String,
  attachment: Schema.Union([ChatImageAttachment, ChatFileAttachment]),
});
const Capture = Schema.Struct({
  environmentId: EnvironmentId,
  sourceThreadId: Schema.NullOr(ThreadId),
  projectId: Schema.NullOr(ProjectId),
  items: Schema.Array(
    Schema.Union([
      Schema.Struct({ type: Schema.Literal("quote"), citation: AssistantCitation }),
      Schema.Struct({ type: Schema.Literal("file"), path: Schema.String }),
      Schema.Struct({
        type: Schema.Literal("context"),
        record: Schema.Union([ThreadContextRecord, ReviewCommentContextRecord]),
      }),
    ]),
  ),
});
const ManualDraft = Schema.Struct({
  kind: Schema.Literal("manual"),
  environmentId: EnvironmentId,
  title: Schema.String,
  body: Schema.String,
  labels: Schema.Array(Schema.String),
  statusId: Schema.NullOr(TicketStatusId),
  projectId: Schema.NullOr(ProjectId),
  threadId: Schema.NullOr(ThreadId),
  uploads: Schema.Array(PendingUpload),
});
const CommentDraft = Schema.Struct({
  kind: Schema.Literal("comment"),
  environmentId: EnvironmentId,
  ticketId: TicketId,
  text: Schema.String,
});
const DialogDraft = Schema.Struct({
  kind: Schema.Literal("dialog"),
  environmentId: EnvironmentId,
  capture: Capture,
  instruction: Schema.String,
  promptRecords: Schema.Array(
    Schema.Union([ThreadContextRecord, TicketContextRecord, ReviewCommentContextRecord]),
  ),
  projectId: Schema.NullOr(ProjectId),
  model: Schema.NullOr(ModelSelection),
});
const DraftEntry = Schema.Struct({
  id: Schema.String,
  revision: Schema.Number,
  value: Schema.Union([ManualDraft, CommentDraft, DialogDraft]),
});
type DraftEntry = typeof DraftEntry.Type;
export type ManualTicketDraft = typeof ManualDraft.Type;
export type DialogTicketDraft = typeof DialogDraft.Type;
type Verification = "checking" | "verified" | "missing" | "failed";
interface DraftRuntime {
  readonly uploading: number;
  readonly submitting: boolean;
  readonly verification: Readonly<Record<string, Verification>>;
}
const idle: DraftRuntime = { uploading: 0, submitting: false, verification: {} };
const PersistedDrafts = Schema.Struct({
  drafts: Schema.Record(Schema.String, DraftEntry),
  activeManual: Schema.NullOr(Schema.String),
  activeManualByEnvironment: Schema.Record(Schema.String, Schema.String),
});
const decodeDrafts = Schema.decodeUnknownSync(PersistedDrafts);
type TicketDraftState = typeof PersistedDrafts.Type & {
  readonly runtime: Readonly<Record<string, DraftRuntime>>;
};
export const TICKET_DRAFT_STORAGE_KEY = "vetra:ticket-drafts:v1";

export function createTicketDraftStore(
  options: {
    readonly storage?: StateStorage;
    readonly upload?: typeof uploadTicketFiles;
    readonly verify?: typeof verifyStashedAttachmentUpload;
    readonly release?: typeof releasePersistedAttachmentUpload;
  } = {},
) {
  const baseStorage =
    options.storage ?? (typeof localStorage === "undefined" ? createMemoryStorage() : localStorage);
  const storage = createDeferredStorage<typeof PersistedDrafts.Type>(
    {
      getItem: (name) => baseStorage.getItem(name),
      setItem: (name, value) => {
        try {
          baseStorage.setItem(name, value);
        } catch {
          return;
        }
      },
      removeItem: (name) => baseStorage.removeItem(name),
    },
    (state) =>
      JSON.stringify({
        ...state,
        drafts: Object.fromEntries(
          Object.entries(state.drafts).filter(([key, entry]) => {
            const value = entry.value;
            return value.kind === "manual"
              ? key === state.activeManual ||
                  Object.values(state.activeManualByEnvironment).includes(key) ||
                  value.title.length > 0 ||
                  value.body.length > 0 ||
                  value.uploads.length > 0 ||
                  value.labels.length > 0 ||
                  value.projectId !== null ||
                  value.threadId !== null ||
                  value.statusId !== null
              : value.kind === "comment"
                ? value.text.length > 0
                : value.instruction.length > 0 ||
                  value.promptRecords.length > 0 ||
                  value.capture.items.length > 0 ||
                  value.projectId !== null ||
                  value.model !== null;
          }),
        ),
      }),
  );
  const upload = options.upload ?? uploadTicketFiles;
  const verifyUpload = options.verify ?? verifyStashedAttachmentUpload;
  const release = options.release ?? releasePersistedAttachmentUpload;
  const load = () => {
    const empty = { drafts: {}, activeManual: null, activeManualByEnvironment: {} };
    try {
      const raw = storage.getItem(TICKET_DRAFT_STORAGE_KEY);
      if (typeof raw === "string") return decodeDrafts(JSON.parse(raw));
    } catch {
      return empty;
    }
    return empty;
  };
  const store = createStore<TicketDraftState>(() => ({ ...load(), runtime: {} }));
  store.subscribe((state, previous) => {
    if (
      state.drafts === previous.drafts &&
      state.activeManual === previous.activeManual &&
      state.activeManualByEnvironment === previous.activeManualByEnvironment
    )
      return;
    storage.setItem(TICKET_DRAFT_STORAGE_KEY, {
      drafts: state.drafts,
      activeManual: state.activeManual,
      activeManualByEnvironment: state.activeManualByEnvironment,
    });
  });
  const runtime = (id: string) => store.getState().runtime[id] ?? idle;
  const setRuntime = (id: string, update: Partial<DraftRuntime>) =>
    store.setState((state) => ({
      runtime: { ...state.runtime, [id]: { ...runtime(id), ...update } },
    }));
  const put = (key: string, value: DraftEntry["value"]) => {
    if (store.getState().drafts[key]?.value.kind !== value.kind) {
      store.setState((state) => ({
        drafts: { ...state.drafts, [key]: { id: randomUUID(), revision: 0, value } },
      }));
    }
    return key;
  };
  const edit = (key: string, value: DraftEntry["value"]) => {
    const entry = store.getState().drafts[key];
    if (!entry || runtime(entry.id).submitting) return;
    store.setState((state) => ({
      drafts: { ...state.drafts, [key]: { ...entry, revision: entry.revision + 1, value } },
    }));
  };
  const remove = (key: string, expected: DraftEntry) => {
    const current = store.getState().drafts[key];
    if (current?.id !== expected.id || current.revision !== expected.revision) return false;
    if (current.value.kind === "manual") {
      for (const pending of current.value.uploads) {
        release({
          id: pending.localId,
          environmentId: current.value.environmentId,
          attachmentId: pending.attachment.id,
        });
      }
    }
    store.setState((state) => {
      const { [key]: _removed, ...drafts } = state.drafts;
      const { [expected.id]: _runtime, ...rest } = state.runtime;
      const environmentId = current.value.environmentId;
      const { [environmentId]: _active, ...otherEnvironments } = state.activeManualByEnvironment;
      return {
        drafts,
        runtime: rest,
        activeManual: state.activeManual === key ? null : state.activeManual,
        activeManualByEnvironment:
          state.activeManualByEnvironment[environmentId] === key
            ? otherEnvironments
            : state.activeManualByEnvironment,
      };
    });
    return true;
  };
  const pendingVerifications = new Map<string, Promise<boolean>>();
  const verify = (key: string): Promise<boolean> => {
    const entry = store.getState().drafts[key];
    if (!entry || entry.value.kind !== "manual") return Promise.resolve(false);
    const existing = pendingVerifications.get(entry.id);
    if (existing) return existing;
    const value = entry.value;
    const referenced = new Set(attachmentReferenceIds(value.body));
    const promise = Promise.all(
      value.uploads
        .filter((pending) => referenced.has(pending.attachment.id))
        .map(async (pending) => {
          const attachmentId = pending.attachment.id;
          setRuntime(entry.id, {
            verification: { ...runtime(entry.id).verification, [attachmentId]: "checking" },
          });
          const result = await verifyUpload({ environmentId: value.environmentId, attachmentId });
          if (store.getState().drafts[key]?.id !== entry.id) return false;
          setRuntime(entry.id, {
            verification: { ...runtime(entry.id).verification, [attachmentId]: result.status },
          });
          return result.status === "verified";
        }),
    )
      .then(() => {
        const current = store.getState().drafts[key];
        if (current?.id !== entry.id || current.value.kind !== "manual") return false;
        const currentReferences = new Set(attachmentReferenceIds(current.value.body));
        return current.value.uploads
          .filter((pending) => currentReferences.has(pending.attachment.id))
          .every((pending) => runtime(entry.id).verification[pending.attachment.id] === "verified");
      })
      .finally(() => pendingVerifications.delete(entry.id));
    pendingVerifications.set(entry.id, promise);
    return promise;
  };
  return {
    store,
    runtime,
    edit,
    verify,
    flush: storage.flush,
    openManual(prefill: NewTicketSearch, fallback: EnvironmentId | null) {
      const hasPrefill =
        prefill.title !== undefined ||
        prefill.body !== undefined ||
        prefill.project !== undefined ||
        prefill.thread !== undefined;
      const state = store.getState();
      const active = state.activeManual;
      if (
        !hasPrefill &&
        prefill.env === undefined &&
        active &&
        state.drafts[active]?.value.kind === "manual"
      )
        return active;
      const environmentId = prefill.env === undefined ? fallback : EnvironmentId.make(prefill.env);
      if (environmentId === null) return null;
      const previous = state.activeManualByEnvironment[environmentId];
      const previousValue = previous === undefined ? undefined : state.drafts[previous]?.value;
      if (
        !hasPrefill &&
        previous &&
        previousValue?.kind === "manual" &&
        previousValue.environmentId === environmentId
      ) {
        if (active !== previous) store.setState({ activeManual: previous });
        return previous;
      }
      const key = JSON.stringify(["manual", environmentId, hasPrefill ? prefill : {}]);
      put(key, {
        kind: "manual",
        environmentId,
        title: prefill.title ?? "",
        body: prefill.body ?? "",
        labels: [],
        statusId: null,
        projectId:
          prefill.env === undefined || !prefill.project ? null : ProjectId.make(prefill.project),
        threadId:
          prefill.env === undefined || !prefill.thread ? null : ThreadId.make(prefill.thread),
        uploads: [],
      });
      if (active !== key || state.activeManualByEnvironment[environmentId] !== key) {
        store.setState({
          activeManual: key,
          activeManualByEnvironment: { ...state.activeManualByEnvironment, [environmentId]: key },
        });
      }
      return key;
    },
    openComment(ref: { readonly environmentId: EnvironmentId; readonly ticketId: TicketId }) {
      return put(JSON.stringify(["comment", ref.environmentId, ref.ticketId]), {
        kind: "comment",
        ...ref,
        text: "",
      });
    },
    openDialog(capture: TicketCapture) {
      return put(JSON.stringify(["dialog", capture]), {
        kind: "dialog",
        environmentId: capture.environmentId,
        capture,
        instruction: ticketCaptureSelection(capture.items).text,
        promptRecords: [],
        projectId: capture.projectId,
        model: null,
      });
    },
    beginSubmission(key: string) {
      const entry = store.getState().drafts[key];
      if (!entry || runtime(entry.id).submitting || runtime(entry.id).uploading > 0) return null;
      setRuntime(entry.id, { submitting: true });
      return entry;
    },
    finishSubmission(key: string, entry: DraftEntry, succeeded: boolean) {
      if (succeeded && remove(key, entry)) return;
      if (store.getState().drafts[key]?.id === entry.id)
        setRuntime(entry.id, { submitting: false });
    },
    discard(key: string) {
      const entry = store.getState().drafts[key];
      return entry ? remove(key, entry) : false;
    },
    async attach(key: string, files: ReadonlyArray<File>) {
      const entry = store.getState().drafts[key];
      if (!entry || entry.value.kind !== "manual" || runtime(entry.id).submitting) return [];
      const environmentId = entry.value.environmentId;
      setRuntime(entry.id, { uploading: runtime(entry.id).uploading + 1 });
      try {
        return await upload(environmentId, files, (pending) => {
          const current = store.getState().drafts[key];
          if (current?.id !== entry.id || current.value.kind !== "manual") return false;
          edit(key, { ...current.value, uploads: [...current.value.uploads, pending] });
          setRuntime(entry.id, {
            verification: {
              ...runtime(entry.id).verification,
              [pending.attachment.id]: "verified",
            },
          });
          return true;
        });
      } finally {
        if (store.getState().drafts[key]?.id === entry.id)
          setRuntime(entry.id, { uploading: runtime(entry.id).uploading - 1 });
      }
    },
    appendAttachments(key: string, id: string, snippets: ReadonlyArray<string>) {
      const entry = store.getState().drafts[key];
      if (entry?.id !== id || entry.value.kind !== "manual" || snippets.length === 0) return;
      edit(key, {
        ...entry.value,
        body: [entry.value.body, ...snippets].filter(Boolean).join("\n\n"),
      });
    },
    removeUpload(key: string, attachmentId: string) {
      const entry = store.getState().drafts[key];
      if (!entry || entry.value.kind !== "manual" || runtime(entry.id).submitting) return;
      const pending = entry.value.uploads.find((item) => item.attachment.id === attachmentId);
      if (!pending) return;
      release({ id: pending.localId, environmentId: entry.value.environmentId, attachmentId });
      const body = entry.value.body.replace(
        /!?\[((?:\\.|[^\]\\])*)\]\(vetra-attachment:\/\/([^\s)]+)\)/g,
        (reference: string, label: string, id: string) =>
          id === attachmentId ? label.replace(/\\([[\]\\])/g, "$1") : reference,
      );
      edit(key, {
        ...entry.value,
        body,
        uploads: entry.value.uploads.filter((item) => item !== pending),
      });
    },
    beforeUnload(event: Pick<BeforeUnloadEvent, "preventDefault" | "returnValue">) {
      const state = store.getState();
      const dirty = Object.values(state.drafts).some(
        ({ value, id }) =>
          runtime(id).uploading > 0 ||
          (value.kind === "manual"
            ? value.title.trim() || value.body.trim() || value.uploads.length > 0
            : value.kind === "comment"
              ? value.text.trim()
              : value.instruction.trim()),
      );
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
      storage.flush();
    },
  };
}

export const ticketDrafts = createTicketDraftStore();
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", ticketDrafts.beforeUnload);
