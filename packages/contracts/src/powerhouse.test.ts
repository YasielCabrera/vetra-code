import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT,
  parsePowerhouseConfig,
  PowerhouseDocumentModel,
  PowerhouseProjectError,
  PowerhouseReactorDocument,
  PowerhouseReactorError,
  PowerhouseReactorGetDocumentInput,
  PowerhouseReactorListDocumentsInput,
  PowerhouseReactorOperation,
} from "./powerhouse.ts";

const encodeProjectError = Schema.encodeUnknownSync(PowerhouseProjectError);
const decodeProjectError = Schema.decodeUnknownSync(PowerhouseProjectError);
const encodeReactorError = Schema.encodeUnknownSync(PowerhouseReactorError);
const decodeReactorError = Schema.decodeUnknownSync(PowerhouseReactorError);
const encodeModel = Schema.encodeUnknownSync(PowerhouseDocumentModel);
const decodeModel = Schema.decodeUnknownSync(PowerhouseDocumentModel);
const encodeDocument = Schema.encodeUnknownSync(PowerhouseReactorDocument);
const decodeDocument = Schema.decodeUnknownSync(PowerhouseReactorDocument);
const encodeOperation = Schema.encodeUnknownSync(PowerhouseReactorOperation);
const decodeOperation = Schema.decodeUnknownSync(PowerhouseReactorOperation);
const decodeGetDocumentInput = Schema.decodeUnknownSync(PowerhouseReactorGetDocumentInput);
const decodeListDocumentsInput = Schema.decodeUnknownSync(PowerhouseReactorListDocumentsInput);

describe("parsePowerhouseConfig", () => {
  it("reads the fields the panel needs", () => {
    const result = parsePowerhouseConfig(
      JSON.stringify({ documentModelsDir: "./models", reactor: { port: 4444 } }),
    );
    expect(result).toEqual({
      status: "valid",
      config: { documentModelsDir: "./models", reactorPort: 4444 },
    });
  });

  it("accepts an empty config, which Powerhouse considers valid", () => {
    expect(parsePowerhouseConfig("{}")).toEqual({ status: "valid", config: {} });
  });

  it("reports Connect's same-named runtime config as such", () => {
    const result = parsePowerhouseConfig(
      JSON.stringify({ schemaVersion: 2, localPackage: "./dist" }),
    );
    expect(result).toEqual({ status: "runtime-config" });
  });

  it.each(["{ not json", "", "[1,2,3]", '"a string"', "null"])(
    "reports %s as invalid",
    (contents) => {
      expect(parsePowerhouseConfig(contents)).toEqual({ status: "invalid" });
    },
  );

  it.each([
    ["a string port", { reactor: { port: "4001" } }],
    ["a fractional port", { reactor: { port: 40.5 } }],
    ["an out-of-range port", { reactor: { port: 70000 } }],
    ["a non-object reactor", { reactor: "memory" }],
  ])("drops %s rather than failing the whole config", (_label, config) => {
    expect(parsePowerhouseConfig(JSON.stringify(config))).toEqual({
      status: "valid",
      config: {},
    });
  });

  it("ignores an empty documentModelsDir", () => {
    expect(parsePowerhouseConfig(JSON.stringify({ documentModelsDir: "   " }))).toEqual({
      status: "valid",
      config: {},
    });
  });

  it("ignores a documentModelsDir too large to send through project discovery", () => {
    expect(
      parsePowerhouseConfig(JSON.stringify({ documentModelsDir: `./${"x".repeat(600)}` })),
    ).toEqual({ status: "valid", config: {} });
  });
});

describe("PowerhouseProjectError", () => {
  it("derives a message per failure and keeps the cause out of it", () => {
    const error = new PowerhouseProjectError({
      failure: "model_not_found",
      cwd: "/work/project",
      detail: "todo",
      cause: new Error("ENOENT: /work/project/secret-token"),
    });
    expect(error.failure).toBe("model_not_found");
    expect(error.message).toBe("No document model with that name.");
    expect(error.message).not.toContain("secret-token");
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("round-trips over the wire", () => {
    const encoded = encodeProjectError(
      new PowerhouseProjectError({ failure: "not_a_powerhouse_project", cwd: "/work/project" }),
    );
    const decoded = decodeProjectError(encoded);
    expect(decoded.failure).toBe("not_a_powerhouse_project");
    expect(decoded.cwd).toBe("/work/project");
  });
});

describe("PowerhouseReactorError", () => {
  it("carries the candidates it tried so the panel can name them", () => {
    const error = new PowerhouseReactorError({
      failure: "unreachable",
      url: "http://127.0.0.1:4001",
      attempted: ["http://127.0.0.1:4001", "http://127.0.0.1:4000"],
    });
    expect(error.message).toBe("No reactor is listening.");
    expect(error.attempted).toEqual(["http://127.0.0.1:4001", "http://127.0.0.1:4000"]);
  });

  it("round-trips graphql messages and status", () => {
    const encoded = encodeReactorError(
      new PowerhouseReactorError({
        failure: "graphql_error",
        url: "http://127.0.0.1:4001",
        status: 200,
        graphqlMessages: ["Unauthorized"],
      }),
    );
    const decoded = decodeReactorError(encoded);
    expect(decoded.failure).toBe("graphql_error");
    expect(decoded.graphqlMessages).toEqual(["Unauthorized"]);
    expect(decoded.status).toBe(200);
  });
});

describe("payload schemas", () => {
  it("bounds identifiers and cursors received over the websocket", () => {
    expect(() =>
      decodeGetDocumentInput({
        url: "http://127.0.0.1:4001",
        documentId: "x".repeat(2049),
      }),
    ).toThrow();
    expect(() =>
      decodeListDocumentsInput({
        url: "http://127.0.0.1:4001",
        search: { parentId: "drive-1" },
        cursor: "x".repeat(8193),
      }),
    ).toThrow();
  });

  it("decodes every Switchboard document search and view filter", () => {
    expect(
      decodeListDocumentsInput({
        url: "http://127.0.0.1:4001",
        search: {
          type: " powerhouse/todo ",
          parentId: " drive-1 ",
          identifiers: [" doc-1 ", "todo-slug"],
        },
        view: { branch: " staging ", scopes: [" global ", "local"] },
      }),
    ).toEqual({
      url: "http://127.0.0.1:4001",
      search: {
        type: "powerhouse/todo",
        parentId: "drive-1",
        identifiers: ["doc-1", "todo-slug"],
      },
      view: { branch: "staging", scopes: ["global", "local"] },
    });
  });

  it("bounds list-valued document filters", () => {
    expect(() =>
      decodeListDocumentsInput({
        url: "http://127.0.0.1:4001",
        search: {
          identifiers: Array.from(
            { length: POWERHOUSE_REACTOR_FILTER_VALUE_MAX_COUNT + 1 },
            (_, index) => `doc-${index}`,
          ),
        },
      }),
    ).toThrow();
  });

  it("round-trips a document model with multiple specifications", () => {
    const model = {
      directoryName: "todo",
      id: "powerhouse/todo",
      name: "Todo",
      extension: "todo",
      description: "",
      author: { name: "Powerhouse", website: null },
      specifications: [
        {
          version: 1,
          changeLog: [],
          globalSchema: "type A { id: ID! }",
          localSchema: "",
          modules: [
            {
              name: "base",
              description: null,
              operations: [{ name: "ADD", description: null, schema: null, scope: "global" }],
            },
          ],
        },
      ],
    };
    const encoded = encodeModel(model);
    expect(decodeModel(encoded)).toEqual(model);
  });

  it("keeps document state opaque, including null for a dropped state", () => {
    const document = {
      id: "doc-1",
      slug: null,
      name: "Doc",
      documentType: "powerhouse/todo",
      createdAtUtcIso: null,
      lastModifiedAtUtcIso: null,
      preferredEditor: null,
      state: { nested: { arbitrary: [1, "two", true] } },
      stateTruncated: false,
      revisions: [{ scope: "global", revision: 3 }],
      revisionsTruncated: false,
      childIds: ["child"],
      childIdsTruncated: false,
    };
    const encoded = encodeDocument(document);
    expect(decodeDocument(encoded)).toEqual(document);

    const truncated = { ...document, state: null, stateTruncated: true };
    expect(decodeDocument(encodeDocument(truncated))).toEqual(truncated);
  });

  it("keeps operation input opaque", () => {
    const operation = {
      index: 0,
      timestampUtcMs: "1767225600000",
      hash: "h",
      skip: 0,
      error: null,
      actionType: "ADD_TODO",
      actionInput: { text: "write the panel", tags: ["a", "b"] },
      actionInputTruncated: false,
      scope: "global",
      signer: null,
    };
    const encoded = encodeOperation(operation);
    expect(decodeOperation(encoded)).toEqual(operation);
  });
});
