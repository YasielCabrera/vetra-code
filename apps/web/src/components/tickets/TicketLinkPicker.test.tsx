// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  TicketId,
  type TicketLink,
  type TicketLinkTarget,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry, AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { TicketLinkPicker } from "./TicketLinkPicker";

interface CapabilityConfig {
  readonly environment: {
    readonly capabilities: {
      readonly ticketIssueLinks?: boolean;
    };
  };
}

interface QueryAtom {
  readonly label?: readonly [string, string];
}

interface ListedTarget {
  readonly host: string;
  readonly repository: string;
  readonly number: number;
  readonly title: string;
  readonly state: "open";
  readonly url: string;
}

const capabilityAtom = vi.hoisted(() => {
  const slot: { current?: unknown } = {};
  return {
    install(atom: unknown) {
      slot.current = atom;
    },
    current(): unknown {
      return slot.current;
    },
  };
});

const boundary = vi.hoisted(() => {
  const queries: string[] = [];
  const threads: Array<{
    environmentId: string;
    id: string;
    projectId: string;
    title: string;
  }> = [];
  const projects: Array<{ environmentId: string; id: string; title: string }> = [];
  const pullRequests: ListedTarget[] = [];
  const issues: ListedTarget[] = [];
  return { queries, threads, projects, pullRequests, issues };
});

const environmentId = EnvironmentId.make("env-picker");
const ticketId = TicketId.make("ticket-picker");
const ownerProjectId = ProjectId.make("project-owner");
const sideProjectId = ProjectId.make("project-side");
const threadId = ThreadId.make("thread-checkout");
const projectLink = {
  target: { kind: "project", projectId: ownerProjectId },
  source: "user",
  createdAt: "2026-10-01T10:00:00.000Z",
} satisfies TicketLink;

vi.mock("../../state/server", async () => {
  const { Atom: RuntimeAtom } = await import("effect/reactivity");
  const configs = RuntimeAtom.make(new Map<string, CapabilityConfig>());
  capabilityAtom.install(configs);
  return { environmentServerConfigsAtom: configs };
});
vi.mock("../../state/entities", () => ({
  useThreadShells: () => boundary.threads,
  useProjects: () => boundary.projects,
}));
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: QueryAtom | null) => {
    const label = atom?.label?.[0] ?? "";
    if (label.length > 0) boundary.queries.push(label);
    if (label.startsWith("environment-data:pull-requests:list:")) {
      return ready({ entries: boundary.pullRequests });
    }
    if (label.startsWith("environment-data:tickets:issue-link-candidates:")) {
      return ready({ entries: boundary.issues, errors: [] });
    }
    return {
      data: null,
      dataUpdatedAt: 0,
      error: null,
      failure: null,
      isPending: atom !== null,
      isSuccess: false,
      refresh: () => {},
    };
  },
}));

function isConfigsAtom(
  value: unknown,
): value is Atom.Writable<Map<string, CapabilityConfig>, Map<string, CapabilityConfig>> {
  return Atom.isAtom(value) && "write" in value && typeof value.write === "function";
}

function configsAtom(): Atom.Writable<
  Map<string, CapabilityConfig>,
  Map<string, CapabilityConfig>
> {
  const atom = capabilityAtom.current();
  if (!isConfigsAtom(atom)) throw new Error("Capability atom was not installed.");
  return atom;
}

function ready<T>(data: T) {
  return {
    data,
    dataUpdatedAt: 1,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh: () => {},
  };
}

function queryInputs(prefix: string): unknown[] {
  return boundary.queries.flatMap((label) => {
    if (!label.startsWith(`${prefix}:`)) return [];
    const parsed: unknown = JSON.parse(label.slice(prefix.length + 1));
    return Array.isArray(parsed) ? [parsed[1]] : [];
  });
}

function ticketIssueQueries(): readonly string[] {
  return boundary.queries.filter((label) => label.startsWith("environment-data:tickets:"));
}

function publishCapability(supported: boolean) {
  appAtomRegistry.set(
    configsAtom(),
    new Map<string, CapabilityConfig>([
      [
        environmentId,
        {
          environment: {
            capabilities: supported ? { ticketIssueLinks: true } : { ticketIssueLinks: false },
          },
        },
      ],
    ]),
  );
}

let root: Root;
let container: HTMLDivElement;
let onLink: ReturnType<typeof vi.fn<(target: TicketLinkTarget) => Promise<void>>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  boundary.queries.length = 0;
  boundary.threads.splice(0, boundary.threads.length, {
    environmentId,
    id: threadId,
    projectId: sideProjectId,
    title: "Checkout thread",
  });
  boundary.projects.splice(0, boundary.projects.length, {
    environmentId,
    id: sideProjectId,
    title: "Side project",
  });
  boundary.pullRequests.splice(0, boundary.pullRequests.length, {
    host: "github.com",
    repository: "owner/app",
    number: 7,
    title: "Fix the widget",
    state: "open",
    url: "https://github.com/owner/app/pull/7",
  });
  boundary.issues.splice(0, boundary.issues.length, {
    host: "github.com",
    repository: "other-org/widget",
    number: 42,
    title: "Unlinked host issue",
    state: "open",
    url: "https://github.com/other-org/widget/issues/42",
  });
  onLink = vi.fn(async () => undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  publishCapability(false);
  vi.unstubAllGlobals();
});

async function renderPicker() {
  await act(async () => {
    root.render(
      <AppAtomRegistryProvider>
        <TicketLinkPicker
          environmentId={environmentId}
          ticketId={ticketId}
          links={[projectLink]}
          onLink={onLink}
        />
      </AppAtomRegistryProvider>,
    );
  });
}

function controlNamed(name: string): HTMLButtonElement {
  const buttons = [...document.querySelectorAll("button")];
  const control =
    buttons.find((element) => element.textContent?.trim() === name) ??
    buttons.find((element) => element.textContent?.trim().startsWith(name));
  if (!(control instanceof HTMLButtonElement)) {
    throw new Error(
      `Missing control: ${name}. Saw ${[...document.querySelectorAll("button")]
        .map((element) => element.textContent?.trim())
        .join(", ")}`,
    );
  }
  return control;
}

async function press(name: string) {
  await act(async () => controlNamed(name).click());
}

describe("TicketLinkPicker issue capability", () => {
  it("hides Issues and does not request candidates when ticketIssueLinks is false", async () => {
    publishCapability(false);
    await renderPicker();
    await press("Link");

    expect(controlNamed("Threads")).toBeInstanceOf(HTMLButtonElement);
    expect(controlNamed("Projects")).toBeInstanceOf(HTMLButtonElement);
    expect(controlNamed("PRs")).toBeInstanceOf(HTMLButtonElement);
    expect(document.body.textContent).toContain("Checkout thread");
    expect(
      [...document.querySelectorAll("button")].some(
        (element) => element.textContent?.trim() === "Issues",
      ),
    ).toBe(false);

    await press("Projects");
    expect(document.body.textContent).toContain("Side project");

    await press("PRs");
    expect(document.body.textContent).toContain("Fix the widget");
    expect(document.body.textContent).not.toContain("Unlinked host issue");
    expect(queryInputs("environment-data:pull-requests:list")).toContainEqual({
      state: "open",
      projectIds: [ownerProjectId],
      limit: 30,
    });
    expect(ticketIssueQueries()).toEqual([]);

    await press("Threads");
    await press("Checkout thread");
    expect(onLink).toHaveBeenCalledWith({ kind: "thread", threadId });
  });

  it("requests issue candidates only after Issues is selected", async () => {
    publishCapability(true);
    await renderPicker();
    await press("Link");
    await press("PRs");
    expect(ticketIssueQueries()).toEqual([]);

    await press("Issues");
    expect(document.body.textContent).toContain("Unlinked host issue");
    expect(queryInputs("environment-data:tickets:issue-link-candidates")).toContainEqual({
      ticketId,
    });
    expect(controlNamed("Threads")).toBeInstanceOf(HTMLButtonElement);
    expect(controlNamed("Projects")).toBeInstanceOf(HTMLButtonElement);
    expect(controlNamed("PRs")).toBeInstanceOf(HTMLButtonElement);
  });
});
