import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { T3ProjectFile, VETRA_PROJECT_FILE_SCHEMA_URL } from "@t3tools/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `vetra.json` file contents (lenient JSONC string) and the
 * decoded {@link T3ProjectFile}.
 */
export const T3ProjectFileFromJson = fromLenientJson(T3ProjectFile);

const decodeT3ProjectFile = Schema.decodeExit(T3ProjectFileFromJson);

/**
 * Decode raw `vetra.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseT3ProjectFile(contents: string): T3ProjectFile | null {
  const decoded = decodeT3ProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `vetra.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link VETRA_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildT3ProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(T3ProjectFile);
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: VETRA_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
