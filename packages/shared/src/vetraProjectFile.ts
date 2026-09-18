import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { VetraProjectFile, VETRA_PROJECT_FILE_SCHEMA_URL } from "@t3tools/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `vetra.json` file contents (lenient JSONC string) and the
 * decoded {@link VetraProjectFile}.
 */
export const VetraProjectFileFromJson = fromLenientJson(VetraProjectFile);

const decodeVetraProjectFile = Schema.decodeExit(VetraProjectFileFromJson);

/**
 * Decode raw `vetra.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseVetraProjectFile(contents: string): VetraProjectFile | null {
  const decoded = decodeVetraProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `vetra.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link VETRA_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildVetraProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(VetraProjectFile);
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
