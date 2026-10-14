// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  type ServerProvider,
  type TicketLaunchDraftInput,
  type TicketLaunchDraftResult,
} from "@t3tools/contracts";
import { DEFAULT_UNIFIED_SETTINGS } from "@t3tools/contracts/settings";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { threadContextRecord } from "../../lib/composerContextRecords";
import { ticketDrafts } from "../../ticketDraftStore";
import { CreateTicketDialogHost, openCreateTicketDialog } from "./CreateTicketDialog";
import type { TicketCapture } from "./ticketCapture";
import type { TicketDraftComposer } from "./TicketDraftComposer";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@effect/atom-react", async () => {
  const actual = await vi.importActual<typeof import("@effect/atom-react")>("@effect/atom-react");
  return {
    ...actual,
    useAtomValue: (atom: unknown) =>
      atom !== null && typeof atom === "object" && "providers" in atom
        ? atom
        : { isReady: true, entries: new Map() },
  };
});
vi.mock("../../hooks/useSettings", () => ({
  useEnvironmentSettings: () => DEFAULT_UNIFIED_SETTINGS,
}));
vi.mock("../../state/entities", () => ({
  useProjects: () => [project],
  useThreadShell: () => null,
}));
vi.mock("../../state/server", () => ({
  EMPTY_SERVER_PROVIDERS: [],
  serverEnvironment: { configValueAtom: () => ({ providers: [provider] }) },
}));
vi.mock("../../state/tickets", () => ({
  ticketEnvironment: { launchDraft: {} },
  useEnvironmentTickets: () => [],
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: unknown) => ({ data: atom === null ? null : false }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => launch }));
vi.mock("../ui/toast", () => ({
  stackedThreadToast: (value: unknown) => value,
  toastManager: { add: vi.fn(() => "toast"), close: vi.fn() },
}));
vi.mock("../ui/dialog", () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog">
      <button onClick={() => onOpenChange(false)}>Close</button>
      {children}
    </div>
  ),
  DialogPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogPanel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DialogFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock("./TicketDraftComposer", () => ({
  TicketDraftComposer: (props: Parameters<typeof TicketDraftComposer>[0]) => (
    <>
      <textarea
        aria-label="Instruction"
        readOnly={props.disabled}
        value={props.prompt}
        onChange={(event) => props.onPromptChange(event.currentTarget.value)}
      />
      <output>{props.promptRecords.map((item) => item.label).join(", ")}</output>
      <button
        type="button"
        onClick={() => {
          props.onPromptRecordsChange([record]);
          props.onPromptChange(`${props.prompt} ${formatComposerContextReference(record)}`);
        }}
      >
        Mention thread
      </button>
    </>
  ),
}));

const local = EnvironmentId.make("local");
const project = { id: ProjectId.make("project"), environmentId: local, title: "Project" };
const provider = {
  instanceId: ProviderInstanceId.make("codex"),
  driver: ProviderDriverKind.make("codex"),
  enabled: true,
  installed: true,
  version: null,
  status: "ready",
  auth: { status: "authenticated" },
  checkedAt: "2026-10-01T10:00:00.000Z",
  models: [
    { slug: "gpt-test", name: "GPT Test", isDefault: true, isCustom: false, capabilities: {} },
  ],
  slashCommands: [],
  skills: [],
} satisfies ServerProvider;
const record = threadContextRecord(
  { environmentId: local, threadId: ThreadId.make("thread") },
  "Captured thread",
);
const capture: TicketCapture = {
  environmentId: local,
  projectId: project.id,
  sourceThreadId: null,
  items: [],
};
const navigate = vi.fn();
const launch =
  vi.fn<
    (input: {
      environmentId: EnvironmentId;
      input: TicketLaunchDraftInput;
    }) => Promise<AtomCommandResult<TicketLaunchDraftResult, Error>>
  >();
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ticketDrafts.store.setState({
    drafts: {},
    activeManual: null,
    activeManualByEnvironment: {},
    runtime: {},
  });
  launch.mockReset().mockResolvedValue(AsyncResult.failure(Cause.fail(new Error("Offline"))));
  navigate.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function open(next: TicketCapture = capture) {
  await act(async () => {
    openCreateTicketDialog(next);
    root.render(<CreateTicketDialogHost />);
  });
}
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (item) => item.textContent === label,
  );
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}
async function type(value: string) {
  const input = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Instruction"]');
  if (!input) throw new Error("Missing instruction");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
      input,
      value,
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const instruction = () =>
  container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Instruction"]')?.value;

describe("CreateTicketDialog drafts", () => {
  it("restores instruction and context on reopen and keeps a different capture independent", async () => {
    await open();
    await type("Investigate this issue");
    await click("Mention thread");
    await click("Close");
    await open({ ...capture, sourceThreadId: ThreadId.make("other") });
    expect(instruction()).toBe("");
    await click("Close");
    await open();
    expect(instruction()).toBe(`Investigate this issue ${formatComposerContextReference(record)}`);
    expect(container.querySelector("output")?.textContent).toBe("Captured thread");
    await click("Create with agent");
    expect(instruction()).toBe(`Investigate this issue ${formatComposerContextReference(record)}`);
    expect(launch).toHaveBeenCalledWith({
      environmentId: local,
      input: {
        projectId: project.id,
        instruction: `Investigate this issue ${formatComposerContextReference(record)}`,
        selection: { text: "", context: { version: 1, records: [record] } },
        modelSelection: { instanceId: "codex", model: "gpt-test" },
      },
    });
  });

  it("hands a manual draft off before clearing its instruction, and explicit discard starts fresh", async () => {
    await open();
    await type("A ticket I will write myself");
    await click("Write it myself");
    const key = ticketDrafts.openManual({}, local)!;
    expect(ticketDrafts.store.getState().drafts[key]?.value).toMatchObject({
      kind: "manual",
      title: "A ticket I will write myself",
      environmentId: "local",
    });
    await open();
    expect(instruction()).toBe("");
    await type("Another instruction");
    await click("Discard draft");
    await open();
    expect(instruction()).toBe("");
  });

  it("allows a reopened dialog to start another instruction after the previous launch completes", async () => {
    let finish = (_result: AtomCommandResult<TicketLaunchDraftResult, Error>) => {};
    launch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await open();
    await type("First instruction");
    await click("Create with agent");
    await click("Close");
    await open();
    expect(
      container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Instruction"]')?.readOnly,
    ).toBe(true);
    await act(async () => finish(AsyncResult.success({ threadId: ThreadId.make("launched") })));
    expect(instruction()).toBe("");
    await type("Next instruction");
    expect(instruction()).toBe("Next instruction");
    await click("Create with agent");
    expect(instruction()).toBe("Next instruction");
    expect(launch).toHaveBeenLastCalledWith({
      environmentId: local,
      input: {
        projectId: project.id,
        instruction: "Next instruction",
        selection: { text: "" },
        modelSelection: { instanceId: "codex", model: "gpt-test" },
      },
    });
  });
});
