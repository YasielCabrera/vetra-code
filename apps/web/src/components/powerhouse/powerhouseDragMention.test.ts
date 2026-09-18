import type { PowerhouseReactorDocumentSummary } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { COMPOSER_MENTION_DRAG_TYPE } from "~/components/chat/composerMentionDrag";

import {
  powerhouseModelDirectoryPath,
  powerhouseModelMention,
  powerhouseReactorMention,
  powerhouseRowDragProps,
} from "./powerhouseDragMention";

const summary = (
  overrides: Partial<PowerhouseReactorDocumentSummary> = {},
): PowerhouseReactorDocumentSummary => ({
  id: "c4cb1cab-fb9e-4c12-a76c-d865b36f48c6",
  slug: null,
  name: "nordwind-p1.pdf",
  documentType: "pfnur/toll-statement",
  createdAtUtcIso: null,
  lastModifiedAtUtcIso: null,
  ...overrides,
});

const makeTransfer = () => {
  const data = new Map<string, string>();
  return {
    effectAllowed: "uninitialized",
    setData: (format: string, value: string) => void data.set(format, value),
    getData: (format: string) => data.get(format) ?? "",
  };
};

describe("powerhouseReactorMention", () => {
  it("names a document with its type, its folder path, and the reactor", () => {
    expect(
      powerhouseReactorMention({
        kind: "doc",
        item: summary(),
        crumbNames: ["powerhouse", "Invoices"],
        reactorUrl: "http://127.0.0.1:4001",
      }),
    ).toBe(
      "`powerhouse:doc/c4cb1cab-fb9e-4c12-a76c-d865b36f48c6` (nordwind-p1.pdf · pfnur/toll-statement · in powerhouse/Invoices · http://127.0.0.1:4001)",
    );
  });

  it("leaves the type out of a folder reference, which its kind already names", () => {
    expect(
      powerhouseReactorMention({
        kind: "folder",
        item: summary({
          id: "f7d15463-6785-442f-826f-9bb48857b96c",
          name: "Invoices",
          documentType: "powerhouse/folder",
        }),
        crumbNames: ["powerhouse"],
        reactorUrl: "http://127.0.0.1:4001",
      }),
    ).toBe(
      "`powerhouse:folder/f7d15463-6785-442f-826f-9bb48857b96c` (Invoices · in powerhouse · http://127.0.0.1:4001)",
    );
  });

  it("omits the crumb path for a drive row", () => {
    expect(
      powerhouseReactorMention({
        kind: "drive",
        item: summary({ id: "powerhouse", slug: "powerhouse", name: null }),
        crumbNames: [],
        reactorUrl: "http://127.0.0.1:4001",
      }),
    ).toBe("`powerhouse:drive/powerhouse` (http://127.0.0.1:4001)");
  });

  it("omits the name when it only repeats the id", () => {
    const mention = powerhouseReactorMention({
      kind: "doc",
      item: summary({ name: null, slug: null }),
      crumbNames: ["powerhouse"],
      reactorUrl: "http://127.0.0.1:4001",
    });
    expect(mention).toBe(
      "`powerhouse:doc/c4cb1cab-fb9e-4c12-a76c-d865b36f48c6` (pfnur/toll-statement · in powerhouse · http://127.0.0.1:4001)",
    );
  });

  it("names the slug when it differs from both the id and the display name", () => {
    expect(
      powerhouseReactorMention({
        kind: "drive",
        item: summary({ id: "drive-1", slug: "powerhouse", name: "Powerhouse" }),
        crumbNames: [],
        reactorUrl: "http://127.0.0.1:4001",
      }),
    ).toBe("`powerhouse:drive/drive-1` (Powerhouse · slug powerhouse · http://127.0.0.1:4001)");
  });

  it("does not repeat a slug that is already the display name", () => {
    expect(
      powerhouseReactorMention({
        kind: "drive",
        item: summary({ id: "drive-1", slug: "powerhouse", name: null }),
        crumbNames: [],
        reactorUrl: "http://127.0.0.1:4001",
      }),
    ).toBe("`powerhouse:drive/drive-1` (powerhouse · http://127.0.0.1:4001)");
  });
});

describe("powerhouseModelDirectoryPath", () => {
  it("resolves a nested project's configured models directory", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "apps/connect",
        documentModelsDir: "./document-models",
        directoryName: "user-profile",
      }),
    ).toBe("apps/connect/document-models/user-profile");
  });

  it("accepts a models directory configured without a leading ./", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "apps/connect",
        documentModelsDir: "document-models",
        directoryName: "user-profile",
      }),
    ).toBe("apps/connect/document-models/user-profile");
  });

  it("resolves against the workspace root when the root is the project", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "",
        documentModelsDir: "./document-models",
        directoryName: "rto-company",
      }),
    ).toBe("document-models/rto-company");
  });

  it("resolves an interior .. segment rather than passing it through", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "apps/connect",
        documentModelsDir: "../shared/document-models",
        directoryName: "user-profile",
      }),
    ).toBe("apps/shared/document-models/user-profile");
  });

  it("accepts a Windows-style separator in the configured directory", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "apps/connect",
        documentModelsDir: ".\\document-models",
        directoryName: "user-profile",
      }),
    ).toBe("apps/connect/document-models/user-profile");
  });

  it("refuses a Windows drive path", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "apps/connect",
        documentModelsDir: "C:\\document-models",
        directoryName: "user-profile",
      }),
    ).toBe(null);
  });

  it("refuses a UNC path", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "apps/connect",
        documentModelsDir: "\\\\server\\share\\document-models",
        directoryName: "user-profile",
      }),
    ).toBe(null);
  });

  it("refuses an absolute models directory", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "apps/connect",
        documentModelsDir: "/tmp/document-models",
        directoryName: "user-profile",
      }),
    ).toBe(null);
  });

  it("refuses a models directory that climbs out of the workspace", () => {
    expect(
      powerhouseModelDirectoryPath({
        projectPath: "",
        documentModelsDir: "../document-models",
        directoryName: "user-profile",
      }),
    ).toBe(null);
  });
});

describe("powerhouseModelMention", () => {
  it("mentions the model directory, not the specification file", () => {
    expect(
      powerhouseModelMention({
        projectPath: "apps/connect",
        documentModelsDir: "./document-models",
        directoryName: "user-profile",
      }),
    ).toBe("[user-profile](apps/connect/document-models/user-profile)");
  });

  it("has no mention when the models directory does not resolve", () => {
    expect(
      powerhouseModelMention({
        projectPath: "apps/connect",
        documentModelsDir: "/tmp/document-models",
        directoryName: "user-profile",
      }),
    ).toBe(null);
  });
});

describe("powerhouseRowDragProps", () => {
  it("writes the reference under the composer mention type as a move", () => {
    const props = powerhouseRowDragProps("[user-profile](document-models/user-profile)");
    const transfer = makeTransfer();
    expect(props.draggable).toBe(true);
    props.onDragStart?.({ dataTransfer: transfer });
    expect(transfer.getData(COMPOSER_MENTION_DRAG_TYPE)).toBe(
      "[user-profile](document-models/user-profile)",
    );
    expect(transfer.effectAllowed).toBe("move");
  });

  it("leaves a row undraggable when there is nothing to reference", () => {
    expect(powerhouseRowDragProps(null)).toEqual({});
  });

  it("tolerates a drag with no transfer", () => {
    const props = powerhouseRowDragProps("[a](a)");
    expect(() => props.onDragStart?.({ dataTransfer: null })).not.toThrow();
  });
});
