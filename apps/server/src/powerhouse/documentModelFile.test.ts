import { describe, expect, it } from "@effect/vitest";

import {
  latestSpecification,
  parseDocumentModelFile,
  summarizeDocumentModel,
} from "./documentModelFile.ts";

const specification = (input: {
  version?: number | null;
  globalSchema?: string;
  localSchema?: string;
  operations?: Array<{ name: string; schema?: string | null }>;
}) => ({
  version: input.version === undefined ? 1 : input.version,
  changeLog: [],
  state: {
    global: { schema: input.globalSchema ?? "type X { id: ID! }", examples: [], initialValue: "" },
    local: { schema: input.localSchema ?? "", examples: [], initialValue: "" },
  },
  modules: [
    {
      id: "module-1",
      name: "base",
      description: "",
      operations: input.operations ?? [
        { name: "SET_NAME", schema: "input SetNameInput { x: String }" },
      ],
    },
  ],
});

const modelJson = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    id: "powerhouse/todo",
    name: "Todo",
    extension: "todo",
    description: "A todo list",
    author: { name: "Powerhouse", website: "https://powerhouse.inc" },
    specifications: [specification({})],
    ...overrides,
  });

const parseOrThrow = (contents: string) => {
  const parsed = parseDocumentModelFile({ directoryName: "todo", contents });
  if (!parsed.ok) throw new Error(`expected a parsed model, got ${parsed.reason}`);
  return parsed.model;
};

describe("parseDocumentModelFile", () => {
  it("projects the fields the panel renders", () => {
    const model = parseOrThrow(modelJson());
    expect(model.id).toBe("powerhouse/todo");
    expect(model.name).toBe("Todo");
    expect(model.extension).toBe("todo");
    expect(model.author).toEqual({ name: "Powerhouse", website: "https://powerhouse.inc" });
    expect(model.specifications).toHaveLength(1);
    expect(model.specifications[0]?.globalSchema).toBe("type X { id: ID! }");
    expect(model.specifications[0]?.modules[0]?.operations[0]?.name).toBe("SET_NAME");
  });

  it("keeps an empty local schema as empty rather than absent", () => {
    const model = parseOrThrow(modelJson());
    expect(model.specifications[0]?.localSchema).toBe("");
  });

  it("tolerates null operation schema and description", () => {
    const model = parseOrThrow(
      modelJson({
        specifications: [specification({ operations: [{ name: "NOOP", schema: null }] })],
      }),
    );
    const operation = model.specifications[0]?.modules[0]?.operations[0];
    expect(operation?.schema).toBeNull();
    expect(operation?.description).toBeNull();
  });

  it("ignores fields it does not render", () => {
    const model = parseOrThrow(modelJson({ somethingNew: { nested: true } }));
    expect(model.name).toBe("Todo");
    expect(Object.keys(model)).not.toContain("somethingNew");
  });

  it("reports unreadable JSON as invalid_json", () => {
    const parsed = parseDocumentModelFile({ directoryName: "todo", contents: "{ not json" });
    expect(parsed).toEqual({ ok: false, reason: "invalid_json" });
  });

  it.each([
    ["missing id", JSON.stringify({ name: "Todo", specifications: [] })],
    ["blank id", JSON.stringify({ id: "   ", name: "Todo", specifications: [] })],
    ["missing name", JSON.stringify({ id: "x", specifications: [] })],
    ["blank name", JSON.stringify({ id: "x", name: "   ", specifications: [] })],
    ["missing specifications", JSON.stringify({ id: "x", name: "Todo" })],
    ["not an object", JSON.stringify([1, 2, 3])],
  ])("reports %s as invalid_shape", (_label, contents) => {
    const parsed = parseDocumentModelFile({ directoryName: "todo", contents });
    expect(parsed).toEqual({ ok: false, reason: "invalid_shape" });
  });
});

describe("latestSpecification", () => {
  it("picks the highest version, not the first entry", () => {
    const model = parseOrThrow(
      modelJson({
        specifications: [
          specification({ version: 1, globalSchema: "type V1 { id: ID! }" }),
          specification({ version: 2, globalSchema: "type V2 { id: ID! }" }),
        ],
      }),
    );
    expect(latestSpecification(model)?.version).toBe(2);
    expect(latestSpecification(model)?.globalSchema).toBe("type V2 { id: ID! }");
  });

  it("falls back to the last entry when specifications carry no version", () => {
    const model = parseOrThrow(
      modelJson({
        specifications: [
          specification({ version: null, globalSchema: "first" }),
          specification({ version: null, globalSchema: "last" }),
        ],
      }),
    );
    expect(latestSpecification(model)?.globalSchema).toBe("last");
  });

  it("returns null for a model with no specifications", () => {
    const model = parseOrThrow(modelJson({ specifications: [] }));
    expect(latestSpecification(model)).toBeNull();
  });
});

describe("summarizeDocumentModel", () => {
  it("counts the newest specification's modules and operations", () => {
    const model = parseOrThrow(
      modelJson({
        specifications: [
          specification({ version: 1, operations: [{ name: "A" }] }),
          specification({ version: 2, operations: [{ name: "A" }, { name: "B" }] }),
        ],
      }),
    );
    expect(summarizeDocumentModel(model)).toMatchObject({
      directoryName: "todo",
      name: "Todo",
      specCount: 2,
      latestVersion: 2,
      moduleCount: 1,
      operationCount: 2,
    });
  });

  it("summarizes a model with no specifications without failing", () => {
    const model = parseOrThrow(modelJson({ specifications: [] }));
    expect(summarizeDocumentModel(model)).toMatchObject({
      specCount: 0,
      latestVersion: null,
      moduleCount: 0,
      operationCount: 0,
    });
  });

  it("bounds list-row text without changing the full model", () => {
    const description = "x".repeat(3_000);
    const model = parseOrThrow(modelJson({ description }));
    const summary = summarizeDocumentModel(model);

    expect(model.description).toBe(description);
    expect(summary.description.length).toBe(1_024);
    expect(summary.description.endsWith("…")).toBe(true);
  });
});
