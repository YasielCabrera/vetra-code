import { RegistryProvider } from "@effect/atom-react";
import { EnvironmentId, type PowerhouseReactorListDocumentsInput } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";

vi.mock("~/state/powerhouse", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  const probe = Atom.make(
    AsyncResult.success({ url: "https://reactor.example/graphql", source: "override", system: {} }),
  );
  const models = Atom.make(
    AsyncResult.success({
      models: [{ id: "pfnur/toll-statement", name: "Toll statement" }],
      failures: [],
      truncated: false,
    }),
  );
  const drives = Atom.make(AsyncResult.success({ drives: [], truncated: false }));
  const emptyDocuments = Atom.make(
    AsyncResult.success({ documents: [], nextCursor: null, truncated: false }),
  );
  const documents = Atom.make(
    AsyncResult.success({
      documents: [
        {
          id: "statement-1",
          name: "Readable statement",
          slug: null,
          documentType: "pfnur/toll-statement",
          createdAtUtcIso: null,
          lastModifiedAtUtcIso: null,
        },
      ],
      nextCursor: null,
      truncated: false,
    }),
  );
  return {
    powerhouseEnvironment: {
      reactorProbe: () => probe,
      documentModels: () => models,
      reactorDrives: () => drives,
      reactorDocuments: ({ input }: { input: PowerhouseReactorListDocumentsInput }) =>
        input.headers?.Authorization === "Bearer explorer-test-token" &&
        input.search.type === "pfnur/toll-statement" &&
        input.search.parentId === undefined
          ? documents
          : emptyDocuments,
    },
  };
});

import { ExplorerView } from "./ExplorerView";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("browses authenticated documents without access to their containing drive", async () => {
  await act(() =>
    root.render(
      <RegistryProvider>
        <ExplorerView
          environmentId={EnvironmentId.make("test-environment")}
          cwd="/workspace"
          projectPath="apps/connect"
          overrideUrl="https://reactor.example/graphql"
          headers={{ Authorization: "Bearer explorer-test-token" }}
          selection={{ driveId: null, path: [], documentId: null }}
          onSetOverride={vi.fn()}
          onSelectDrive={vi.fn()}
          onEnterFolder={vi.fn()}
          onPopToDepth={vi.fn()}
          onSelectDocument={vi.fn()}
        />
      </RegistryProvider>,
    ),
  );

  await expect.element(page.getByText("0 drives available")).toBeVisible();
  await page.getByText("Choose document type…").click();
  await page.getByRole("option", { name: /Toll statement/ }).click();

  await expect
    .element(page.getByRole("button", { name: "Open document Readable statement" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect.element(page.getByText("Choose document type…")).toBeVisible();
  await expect.element(page.getByText("0 drives available")).toBeVisible();
});
