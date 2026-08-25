import type { EnvironmentId } from "@vetra-code/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("~/state/powerhouse", () => ({
  powerhouseEnvironment: {
    reactorProbe: vi.fn(() => ({})),
    documentModels: vi.fn(() => ({})),
  },
}));

vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({
    data: { models: [], failures: [], truncated: false },
    error: null,
  }),
}));

vi.mock("../powerhouseQuery", () => ({
  useReactorQuery: () => ({
    data: { url: "http://127.0.0.1:4001" },
    error: null,
    otherError: null,
    isFailure: false,
    isPending: false,
    refresh: vi.fn(),
  }),
}));

vi.mock("./DocumentDetail", () => ({
  DocumentDetail: () => <div data-testid="document-detail" />,
}));

vi.mock("./DocumentFilterBar", () => ({
  DocumentFilterBar: () => <div data-testid="document-filter-bar" />,
}));

vi.mock("./DocumentList", () => ({
  DocumentList: () => <div data-testid="document-list" />,
}));

vi.mock("./DriveList", () => ({
  DriveList: () => <div data-testid="drive-list" />,
}));

import { ExplorerView } from "./ExplorerView";

const baseProps = {
  environmentId: "test-environment" as EnvironmentId,
  cwd: "/workspace",
  projectPath: "powerhouse",
  overrideUrl: null,
  onSetOverride: vi.fn(),
  onSelectDrive: vi.fn(),
  onEnterFolder: vi.fn(),
  onPopToDepth: vi.fn(),
  onSelectDocument: vi.fn(),
};

describe("ExplorerView", () => {
  it("shows search and filters for explorer lists", () => {
    const markup = renderToStaticMarkup(
      <ExplorerView {...baseProps} selection={{ driveId: null, path: [], documentId: null }} />,
    );

    expect(markup).toContain('data-testid="document-filter-bar"');
    expect(markup).toContain('data-testid="drive-list"');
  });

  it("hides search and filters while a document is open", () => {
    const markup = renderToStaticMarkup(
      <ExplorerView
        {...baseProps}
        selection={{
          driveId: "drive-1",
          path: [{ id: "drive-1", name: "powerhouse" }],
          documentId: "document-1",
        }}
      />,
    );

    expect(markup).toContain('data-testid="document-detail"');
    expect(markup).not.toContain('data-testid="document-filter-bar"');
  });
});
