// @vitest-environment jsdom

import {
  EnvironmentId,
  ProjectId,
  TicketId,
  type TicketGitHubIssueDetail,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { act, useReducer } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { appAtomRegistry, AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { TicketLinkPreview, type TicketLinkPreviewTarget } from "./TicketLinkPreview";

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
  const commands: Array<{ readonly label: string; readonly input: unknown }> = [];
  let detail: unknown = null;
  return {
    queries,
    commands,
    setDetail(value: unknown) {
      detail = value;
    },
    detail() {
      return detail;
    },
  };
});

const environmentId = EnvironmentId.make("env-preview");
const ticketId = TicketId.make("ticket-preview");
const linkedRepository = "other-org/widget";
const snapshotUrl = "https://github.com/other-org/widget/issues/42";
const snapshotTitle = "Recorded snapshot title";
const liveTitle = "Live title from the linked repository";
const liveBody = "Live description from the host.";
const liveProjectTitle = "Widget";
const recordedIssue = {
  kind: "issue",
  ref: { host: "github.com", repository: linkedRepository, number: 42 },
  snapshot: { title: snapshotTitle, state: "open", url: snapshotUrl },
} satisfies TicketLinkPreviewTarget;
const expectedIssueQuery = {
  ticketId,
  linkedIssue: recordedIssue.ref,
};
const liveIssue = {
  title: liveTitle,
  body: liveBody,
  assignees: [],
  comments: [],
  preview: {
    provider: "github",
    host: "github.com",
    projectId: ProjectId.make("project-other"),
    projectTitle: liveProjectTitle,
    repository: linkedRepository,
    number: 42,
    url: snapshotUrl,
    author: { login: "ada", name: "Ada", avatarUrl: null },
    state: "open",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    closedAt: null,
    labels: [],
    milestone: null,
    commentCount: 0,
    commentsTruncated: false,
    repositoryUrl: "https://github.com/other-org/widget",
    newIssueUrl: "https://github.com/other-org/widget/issues/new",
  },
} satisfies TicketGitHubIssueDetail;
boundary.setDetail(liveIssue);

vi.mock("../../state/server", async () => {
  const { Atom: RuntimeAtom } = await import("effect/reactivity");
  const configs = RuntimeAtom.make(new Map<string, CapabilityConfig>());
  capabilityAtom.install(configs);
  return { environmentServerConfigsAtom: configs };
});
vi.mock("../../state/query", () => ({
  useEnvironmentQuery: (atom: QueryAtom | null) => {
    const [, refresh] = useReducer((version: number) => version + 1, 0);
    const label = atom?.label?.[0] ?? "";
    if (label.length > 0) boundary.queries.push(label);
    if (label.startsWith("environment-data:tickets:github-detail:"))
      return ready(boundary.detail(), refresh);
    if (label.startsWith("environment-data:tickets:github-activity:")) {
      return ready({ items: [], truncated: false }, refresh);
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
vi.mock("../../hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { readonly label: string }) => async (input: unknown) => {
    boundary.commands.push({ label: command.label, input });
    return { _tag: "Success", value: undefined };
  },
}));
vi.mock("../../hooks/useHandleNewThread", () => ({
  useNewThreadHandler: () => async () => null,
}));
vi.mock("../ChatMarkdown", () => ({
  default: ({ text }: { readonly text: string }) => <p>{text}</p>,
}));
vi.mock("../pullRequest/PullRequestDetailPanel", () => ({
  PullRequestDetailPanel: () => <p>Pull request details</p>,
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

function ready<T>(data: T, refresh: () => void) {
  return {
    data,
    dataUpdatedAt: 1,
    error: null,
    failure: null,
    isPending: false,
    isSuccess: true,
    refresh,
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

type TicketIssueCapability = "missing-config" | "missing-flag" | "false";

function publishCapability(capability: TicketIssueCapability | "true") {
  const map = new Map<string, CapabilityConfig>();
  if (capability !== "missing-config") {
    map.set(environmentId, {
      environment: {
        capabilities:
          capability === "true"
            ? { ticketIssueLinks: true }
            : capability === "false"
              ? { ticketIssueLinks: false }
              : {},
      },
    });
  }
  appAtomRegistry.set(configsAtom(), map);
}

let root: Root;
let container: HTMLDivElement;
const mockOpenExternal = () => vi.spyOn(window, "open").mockImplementation(() => null);
let openExternal: ReturnType<typeof mockOpenExternal>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  boundary.queries.length = 0;
  boundary.commands.length = 0;
  boundary.setDetail(liveIssue);
  openExternal = mockOpenExternal();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  openExternal.mockRestore();
  publishCapability("missing-config");
  vi.unstubAllGlobals();
});

async function renderPreview() {
  await act(async () => {
    root.render(
      <AppAtomRegistryProvider>
        <TicketLinkPreview
          environmentId={environmentId}
          ticketId={ticketId}
          target={recordedIssue}
          projectId={null}
          stacked={false}
          onBack={() => undefined}
        />
      </AppAtomRegistryProvider>,
    );
  });
}

function controlNamed(name: string): HTMLButtonElement {
  const control = [...document.querySelectorAll("button")].find(
    (element) =>
      element.textContent?.trim() === name || element.getAttribute("aria-label") === name,
  );
  if (!(control instanceof HTMLButtonElement)) throw new Error(`Missing control: ${name}`);
  return control;
}

describe("TicketLinkPreview issue capability", () => {
  it.each<TicketIssueCapability>(["missing-config", "missing-flag", "false"])(
    "keeps the recorded issue visible when ticketIssueLinks is %s",
    async (capability) => {
      publishCapability(capability);
      await renderPreview();

      expect(container.textContent).toContain("Issue preview");
      expect(container.textContent).toContain(snapshotTitle);
      expect(container.textContent).toContain(`${linkedRepository}#42 · open`);
      expect(container.textContent).toContain(
        "Inline issue previews are unavailable on this environment. Open the recorded link on GitHub.",
      );
      expect(container.textContent).not.toContain(liveTitle);
      expect(container.textContent).not.toContain("Pull request details");
      expect(container.textContent).not.toContain("Loading issue");
      expect(ticketIssueQueries()).toEqual([]);

      await act(async () => controlNamed("Open on GitHub").click());
      expect(openExternal).toHaveBeenCalledWith(snapshotUrl, "_blank", "noopener,noreferrer");
    },
  );

  it("previews a linked issue without an owner project when ticketIssueLinks is true", async () => {
    publishCapability("true");
    await renderPreview();

    expect(container.textContent).toContain(liveTitle);
    expect(container.textContent).toContain(liveBody);
    expect(container.textContent).toContain(liveProjectTitle);
    expect(container.textContent).toContain("ada");
    expect(container.textContent).not.toContain(snapshotTitle);
    expect(container.textContent).not.toContain(
      "Inline issue previews are unavailable on this environment. Open the recorded link on GitHub.",
    );
    expect(container.textContent).not.toContain(`Link a project that uses ${linkedRepository}`);
    expect(queryInputs("environment-data:tickets:github-detail")).toEqual([expectedIssueQuery]);
    expect(queryInputs("environment-data:tickets:github-activity")).toEqual([expectedIssueQuery]);
  });

  it("refreshes the linked issue without syncing it into its owner", async () => {
    publishCapability("true");
    await renderPreview();
    boundary.setDetail({ ...liveIssue, title: "Updated linked issue", body: "Fresh description" });
    expect(container.textContent).toContain(liveTitle);

    await act(async () => controlNamed("More issue actions").click());
    const refresh = [...document.querySelectorAll("[role='menuitem']")].find(
      (item) => item.textContent?.trim() === "Refresh",
    );
    if (!(refresh instanceof HTMLElement)) throw new Error("Missing refresh action.");
    await act(async () => refresh.click());

    expect(container.textContent).toContain("Updated linked issue");
    expect(container.textContent).toContain("Fresh description");
    expect(boundary.commands).toEqual([
      {
        label: "environment-data:tickets:invalidate-github-issue",
        input: { environmentId, input: expectedIssueQuery },
      },
    ]);
    expect(queryInputs("environment-data:tickets:github-activity").length).toBeGreaterThan(1);
  });
});
