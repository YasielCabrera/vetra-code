import { describe, expect, it } from "vite-plus/test";

import {
  GRAPHQL_SCHEMA_DIAGRAM_LIMITS,
  parseGraphqlSchemaDiagram,
  presentGraphqlSchemaDeclaration,
} from "./graphqlSchemaDiagram";

function parseModel(source: string) {
  const result = parseGraphqlSchemaDiagram(source);
  if (!result.ok) throw new Error(result.message);
  return result.model;
}

describe("parseGraphqlSchemaDiagram", () => {
  it("projects object, enum, and nested list relations from SDL", () => {
    const model = parseModel(`
      enum Status { OPEN CLOSED }
      type User { id: ID! tasks: [Task!]! status: Status! }
      type Task { owner: User title: String! }
    `);

    expect(model.declarations.map(({ name, kind }) => [name, kind])).toEqual([
      ["Status", "enum"],
      ["User", "type"],
      ["Task", "type"],
    ]);
    expect(model.declarations[1]?.items).toContainEqual({ name: "tasks", detail: "[Task!]!" });
    expect(model.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "User", target: "Task", labels: ["tasks"] }),
        expect.objectContaining({ source: "User", target: "Status", labels: ["status"] }),
        expect.objectContaining({ source: "Task", target: "User", labels: ["owner"] }),
      ]),
    );
    expect(model.relations.some(({ target }) => target === "String" || target === "ID")).toBe(
      false,
    );
  });

  it("shows input fields and field-argument relationships", () => {
    const model = parseModel(`
      input TodoFilter { owner: UserRef tags: [String!] }
      input UserRef { id: ID! }
      type Todo { id: ID! }
      type Query { todos(filter: TodoFilter, owner: UserRef): [Todo!]! }
    `);

    expect(model.declarations.find(({ name }) => name === "Query")?.items).toEqual([
      { name: "todos(filter, owner)", detail: "[Todo!]!" },
    ]);
    expect(model.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "Query",
          target: "TodoFilter",
          kind: "argument",
          labels: ["todos(filter)"],
        }),
        expect.objectContaining({
          source: "Query",
          target: "Todo",
          kind: "field",
          labels: ["todos"],
        }),
        expect.objectContaining({
          source: "TodoFilter",
          target: "UserRef",
          labels: ["owner"],
        }),
      ]),
    );
  });

  it("captures interface implementation, union membership, and custom scalars", () => {
    const model = parseModel(`
      scalar DateTime
      interface Node { id: ID! }
      type Invoice implements Node { id: ID! issuedAt: DateTime! }
      type Receipt implements Node { id: ID! }
      union SearchResult = Invoice | Receipt
    `);

    expect(model.declarations.find(({ name }) => name === "DateTime")?.kind).toBe("scalar");
    expect(model.relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "Invoice",
          target: "Node",
          kind: "implements",
        }),
        expect.objectContaining({
          source: "Invoice",
          target: "DateTime",
          kind: "field",
        }),
        expect.objectContaining({
          source: "SearchResult",
          target: "Receipt",
          kind: "member",
        }),
      ]),
    );
  });

  it("merges type-system extensions into their declaration", () => {
    const model = parseModel(`
      type User { id: ID! }
      extend type User { manager: User }
      enum Role { ADMIN }
      extend enum Role { MEMBER }
    `);

    expect(model.declarations.find(({ name }) => name === "User")?.items).toEqual([
      { name: "id", detail: "ID!" },
      { name: "manager", detail: "User" },
    ]);
    expect(model.declarations.find(({ name }) => name === "Role")?.items).toEqual([
      { name: "ADMIN", detail: null },
      { name: "MEMBER", detail: null },
    ]);
    expect(model.relations).toContainEqual(
      expect.objectContaining({ source: "User", target: "User", labels: ["manager"] }),
    );
  });

  it("bundles repeated relations and reports labels it omits", () => {
    const labels = Array.from(
      { length: GRAPHQL_SCHEMA_DIAGRAM_LIMITS.labelsPerRelation + 2 },
      (_, index) => `field${index}: Child`,
    ).join("\n");
    const model = parseModel(`type Child { id: ID } type Parent { ${labels} }`);
    const relation = model.relations.find(
      ({ source, target }) => source === "Parent" && target === "Child",
    );

    expect(relation?.labels).toHaveLength(GRAPHQL_SCHEMA_DIAGRAM_LIMITS.labelsPerRelation);
    expect(relation?.omittedLabelCount).toBe(2);
  });

  it("bundles return and argument paths between the same declarations", () => {
    const model = parseModel(`
      input Payload { value: String }
      type Query { echo(value: Payload): Payload }
    `);
    const relations = model.relations.filter(
      ({ source, target }) => source === "Query" && target === "Payload",
    );

    expect(relations).toHaveLength(1);
    expect(relations[0]?.labels).toEqual(["echo", "echo(value)"]);
  });

  it("retains declaration rows while collapsing their initial presentation", () => {
    const fields = Array.from(
      { length: GRAPHQL_SCHEMA_DIAGRAM_LIMITS.itemsPerDeclaration + 3 },
      (_, index) => `field${index}: Child`,
    ).join("\n");
    const model = parseModel(`type Child { id: ID } type Parent { ${fields} }`);
    const parent = model.declarations.find(({ name }) => name === "Parent");
    if (parent === undefined) throw new Error("Parent declaration was not projected");
    const collapsed = presentGraphqlSchemaDeclaration(parent, false);
    const expanded = presentGraphqlSchemaDeclaration(parent, true);

    expect(parent.items).toHaveLength(GRAPHQL_SCHEMA_DIAGRAM_LIMITS.itemsPerDeclaration + 3);
    expect(collapsed.items).toHaveLength(GRAPHQL_SCHEMA_DIAGRAM_LIMITS.itemsPerDeclaration);
    expect(collapsed).toMatchObject({ expandable: true, hiddenItemCount: 3 });
    expect(expanded.items).toHaveLength(GRAPHQL_SCHEMA_DIAGRAM_LIMITS.itemsPerDeclaration + 3);
    expect(expanded).toMatchObject({ expandable: true, hiddenItemCount: 0 });
    expect(model.relations).toContainEqual(
      expect.objectContaining({ source: "Parent", target: "Child" }),
    );
  });

  it("returns a useful syntax failure instead of throwing", () => {
    const result = parseGraphqlSchemaDiagram("type Broken { id: }");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("invalid_sdl");
    expect(result.message).toContain("Syntax Error");
  });

  it("declines schemas beyond the client-side parsing budget", () => {
    const result = parseGraphqlSchemaDiagram(
      " ".repeat(GRAPHQL_SCHEMA_DIAGRAM_LIMITS.sourceCharacters + 1),
    );

    expect(result).toMatchObject({ ok: false, reason: "source_too_large" });
  });

  it("labels declarations and their hidden relations when the graph is bounded", () => {
    const definitions = Array.from(
      { length: GRAPHQL_SCHEMA_DIAGRAM_LIMITS.declarations },
      (_, index) => `type Child${index} { id: ID }`,
    ).join("\n");
    const model = parseModel(`
      type Root { hidden: HiddenChild }
      ${definitions}
      type HiddenChild { id: ID }
    `);

    expect(model.declarations).toHaveLength(GRAPHQL_SCHEMA_DIAGRAM_LIMITS.declarations);
    expect(model.omittedDeclarationCount).toBe(2);
    expect(model.omittedRelationCount).toBe(1);
  });
});
