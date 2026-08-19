import {
  Kind,
  parse,
  type FieldDefinitionNode,
  type InputValueDefinitionNode,
  type TypeDefinitionNode,
  type TypeExtensionNode,
  type TypeNode,
} from "graphql/language";

export const GRAPHQL_SCHEMA_DIAGRAM_LIMITS = {
  sourceCharacters: 500_000,
  tokens: 80_000,
  declarations: 150,
  relations: 500,
  itemsPerDeclaration: 16,
  labelsPerRelation: 3,
} as const;

export type GraphqlSchemaDeclarationKind =
  | "type"
  | "interface"
  | "input"
  | "enum"
  | "union"
  | "scalar";

export interface GraphqlSchemaDeclarationItem {
  readonly name: string;
  readonly detail: string | null;
}

export interface GraphqlSchemaDeclaration {
  readonly id: string;
  readonly name: string;
  readonly kind: GraphqlSchemaDeclarationKind;
  readonly items: ReadonlyArray<GraphqlSchemaDeclarationItem>;
}

export interface GraphqlSchemaDeclarationPresentation {
  readonly items: ReadonlyArray<GraphqlSchemaDeclarationItem>;
  readonly hiddenItemCount: number;
  readonly expandable: boolean;
}

export type GraphqlSchemaRelationKind = "field" | "argument" | "implements" | "member";

export interface GraphqlSchemaRelation {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly kind: GraphqlSchemaRelationKind;
  readonly labels: ReadonlyArray<string>;
  readonly omittedLabelCount: number;
}

export interface GraphqlSchemaDiagramModel {
  readonly declarations: ReadonlyArray<GraphqlSchemaDeclaration>;
  readonly relations: ReadonlyArray<GraphqlSchemaRelation>;
  readonly omittedDeclarationCount: number;
  readonly omittedRelationCount: number;
}

export type GraphqlSchemaDiagramResult =
  | { readonly ok: true; readonly model: GraphqlSchemaDiagramModel }
  | {
      readonly ok: false;
      readonly reason: "source_too_large" | "invalid_sdl";
      readonly message: string;
    };

interface MutableDeclaration {
  readonly id: string;
  readonly name: string;
  readonly kind: GraphqlSchemaDeclarationKind;
  readonly items: Array<GraphqlSchemaDeclarationItem>;
  readonly itemKeys: Set<string>;
}

interface RelationCandidate {
  readonly source: string;
  readonly target: string;
  readonly kind: GraphqlSchemaRelationKind;
  readonly label: string;
}

interface MutableRelation {
  readonly source: string;
  readonly target: string;
  readonly kind: GraphqlSchemaRelationKind;
  readonly labels: Array<string>;
  readonly labelSet: Set<string>;
}

type GraphqlTypeDeclarationNode = TypeDefinitionNode | TypeExtensionNode;

export function presentGraphqlSchemaDeclaration(
  declaration: GraphqlSchemaDeclaration,
  expanded: boolean,
): GraphqlSchemaDeclarationPresentation {
  const expandable = declaration.items.length > GRAPHQL_SCHEMA_DIAGRAM_LIMITS.itemsPerDeclaration;
  if (expanded || !expandable) {
    return { items: declaration.items, hiddenItemCount: 0, expandable };
  }
  return {
    items: declaration.items.slice(0, GRAPHQL_SCHEMA_DIAGRAM_LIMITS.itemsPerDeclaration),
    hiddenItemCount: declaration.items.length - GRAPHQL_SCHEMA_DIAGRAM_LIMITS.itemsPerDeclaration,
    expandable,
  };
}

function declarationKind(node: GraphqlTypeDeclarationNode): GraphqlSchemaDeclarationKind {
  switch (node.kind) {
    case Kind.OBJECT_TYPE_DEFINITION:
    case Kind.OBJECT_TYPE_EXTENSION:
      return "type";
    case Kind.INTERFACE_TYPE_DEFINITION:
    case Kind.INTERFACE_TYPE_EXTENSION:
      return "interface";
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
      return "input";
    case Kind.ENUM_TYPE_DEFINITION:
    case Kind.ENUM_TYPE_EXTENSION:
      return "enum";
    case Kind.UNION_TYPE_DEFINITION:
    case Kind.UNION_TYPE_EXTENSION:
      return "union";
    case Kind.SCALAR_TYPE_DEFINITION:
    case Kind.SCALAR_TYPE_EXTENSION:
      return "scalar";
  }
}

function typeName(type: TypeNode): string {
  switch (type.kind) {
    case Kind.NAMED_TYPE:
      return type.name.value;
    case Kind.LIST_TYPE:
      return `[${typeName(type.type)}]`;
    case Kind.NON_NULL_TYPE:
      return `${typeName(type.type)}!`;
  }
}

function namedType(type: TypeNode): string {
  return type.kind === Kind.NAMED_TYPE ? type.name.value : namedType(type.type);
}

function fieldName(field: FieldDefinitionNode): string {
  const argumentNames = field.arguments?.map((argument) => argument.name.value) ?? [];
  if (argumentNames.length === 0) return field.name.value;
  const visible = argumentNames.slice(0, 2).join(", ");
  return `${field.name.value}(${visible}${argumentNames.length > 2 ? ", …" : ""})`;
}

function pushItem(declaration: MutableDeclaration, name: string, detail: string | null): void {
  const key = `${name}\u0000${detail ?? ""}`;
  if (declaration.itemKeys.has(key)) return;
  declaration.itemKeys.add(key);
  declaration.items.push({ name, detail });
}

function pushFieldRelations(
  source: string,
  fields: ReadonlyArray<FieldDefinitionNode>,
  candidates: Array<RelationCandidate>,
): void {
  for (const field of fields) {
    candidates.push({
      source,
      target: namedType(field.type),
      kind: "field",
      label: field.name.value,
    });
    for (const argument of field.arguments ?? []) {
      candidates.push({
        source,
        target: namedType(argument.type),
        kind: "argument",
        label: `${field.name.value}(${argument.name.value})`,
      });
    }
  }
}

function pushInputRelations(
  source: string,
  fields: ReadonlyArray<InputValueDefinitionNode>,
  candidates: Array<RelationCandidate>,
): void {
  for (const field of fields) {
    candidates.push({
      source,
      target: namedType(field.type),
      kind: "field",
      label: field.name.value,
    });
  }
}

function relationKey(relation: Omit<RelationCandidate, "label">): string {
  return `${relation.source}\u0000${relation.target}`;
}

function isTypeDeclaration(node: { readonly kind: Kind }): node is GraphqlTypeDeclarationNode {
  switch (node.kind) {
    case Kind.OBJECT_TYPE_DEFINITION:
    case Kind.OBJECT_TYPE_EXTENSION:
    case Kind.INTERFACE_TYPE_DEFINITION:
    case Kind.INTERFACE_TYPE_EXTENSION:
    case Kind.INPUT_OBJECT_TYPE_DEFINITION:
    case Kind.INPUT_OBJECT_TYPE_EXTENSION:
    case Kind.ENUM_TYPE_DEFINITION:
    case Kind.ENUM_TYPE_EXTENSION:
    case Kind.UNION_TYPE_DEFINITION:
    case Kind.UNION_TYPE_EXTENSION:
    case Kind.SCALAR_TYPE_DEFINITION:
    case Kind.SCALAR_TYPE_EXTENSION:
      return true;
    default:
      return false;
  }
}

/**
 * Turn GraphQL SDL into the bounded class-diagram model rendered by React Flow.
 * GraphQL.js owns syntax parsing; this projection only decides what is useful
 * to show and keeps very large generated schemas from overwhelming the panel.
 */
export function parseGraphqlSchemaDiagram(source: string): GraphqlSchemaDiagramResult {
  if (source.length > GRAPHQL_SCHEMA_DIAGRAM_LIMITS.sourceCharacters) {
    return {
      ok: false,
      reason: "source_too_large",
      message: `Diagram view supports schemas up to ${GRAPHQL_SCHEMA_DIAGRAM_LIMITS.sourceCharacters.toLocaleString()} characters. Use SDL view for this schema.`,
    };
  }

  let document: ReturnType<typeof parse>;
  try {
    document = parse(source, {
      maxTokens: GRAPHQL_SCHEMA_DIAGRAM_LIMITS.tokens,
      noLocation: true,
    });
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_sdl",
      message: error instanceof Error ? error.message : "The GraphQL schema could not be parsed.",
    };
  }

  const declarations = new Map<string, MutableDeclaration>();
  const candidates: Array<RelationCandidate> = [];

  for (const definition of document.definitions) {
    if (!isTypeDeclaration(definition)) continue;
    const name = definition.name.value;
    let declaration = declarations.get(name);
    if (declaration === undefined) {
      declaration = {
        id: name,
        name,
        kind: declarationKind(definition),
        items: [],
        itemKeys: new Set(),
      };
      declarations.set(name, declaration);
    }

    switch (definition.kind) {
      case Kind.OBJECT_TYPE_DEFINITION:
      case Kind.OBJECT_TYPE_EXTENSION:
      case Kind.INTERFACE_TYPE_DEFINITION:
      case Kind.INTERFACE_TYPE_EXTENSION: {
        const fields = definition.fields ?? [];
        for (const field of fields) pushItem(declaration, fieldName(field), typeName(field.type));
        for (const implemented of definition.interfaces ?? []) {
          candidates.push({
            source: name,
            target: implemented.name.value,
            kind: "implements",
            label: "implements",
          });
        }
        pushFieldRelations(name, fields, candidates);
        break;
      }
      case Kind.INPUT_OBJECT_TYPE_DEFINITION:
      case Kind.INPUT_OBJECT_TYPE_EXTENSION: {
        const fields = definition.fields ?? [];
        for (const field of fields) pushItem(declaration, field.name.value, typeName(field.type));
        pushInputRelations(name, fields, candidates);
        break;
      }
      case Kind.ENUM_TYPE_DEFINITION:
      case Kind.ENUM_TYPE_EXTENSION:
        for (const value of definition.values ?? []) {
          pushItem(declaration, value.name.value, null);
        }
        break;
      case Kind.UNION_TYPE_DEFINITION:
      case Kind.UNION_TYPE_EXTENSION:
        for (const member of definition.types ?? []) {
          pushItem(declaration, member.name.value, null);
          candidates.push({
            source: name,
            target: member.name.value,
            kind: "member",
            label: "member",
          });
        }
        break;
      case Kind.SCALAR_TYPE_DEFINITION:
      case Kind.SCALAR_TYPE_EXTENSION:
        break;
    }
  }

  const allDeclarationNames = new Set(declarations.keys());
  const visibleDeclarations = [...declarations.values()].slice(
    0,
    GRAPHQL_SCHEMA_DIAGRAM_LIMITS.declarations,
  );
  const visibleDeclarationNames = new Set(visibleDeclarations.map((declaration) => declaration.id));
  const relations = new Map<string, MutableRelation>();

  for (const candidate of candidates) {
    if (!allDeclarationNames.has(candidate.target)) continue;
    const key = relationKey(candidate);
    let relation = relations.get(key);
    if (relation === undefined) {
      relation = {
        source: candidate.source,
        target: candidate.target,
        kind: candidate.kind,
        labels: [],
        labelSet: new Set(),
      };
      relations.set(key, relation);
    }
    if (!relation.labelSet.has(candidate.label)) {
      relation.labelSet.add(candidate.label);
      relation.labels.push(candidate.label);
    }
  }

  const visibleRelations = [...relations.values()].filter(
    (relation) =>
      visibleDeclarationNames.has(relation.source) && visibleDeclarationNames.has(relation.target),
  );
  const shownRelations = visibleRelations.slice(0, GRAPHQL_SCHEMA_DIAGRAM_LIMITS.relations);

  return {
    ok: true,
    model: {
      declarations: visibleDeclarations.map((declaration) => ({
        id: declaration.id,
        name: declaration.name,
        kind: declaration.kind,
        items: declaration.items,
      })),
      relations: shownRelations.map((relation, index) => ({
        id: `relation:${index}`,
        source: relation.source,
        target: relation.target,
        kind: relation.kind,
        labels: relation.labels.slice(0, GRAPHQL_SCHEMA_DIAGRAM_LIMITS.labelsPerRelation),
        omittedLabelCount: Math.max(
          0,
          relation.labels.length - GRAPHQL_SCHEMA_DIAGRAM_LIMITS.labelsPerRelation,
        ),
      })),
      omittedDeclarationCount: Math.max(
        0,
        declarations.size - GRAPHQL_SCHEMA_DIAGRAM_LIMITS.declarations,
      ),
      omittedRelationCount: relations.size - shownRelations.length,
    },
  };
}
