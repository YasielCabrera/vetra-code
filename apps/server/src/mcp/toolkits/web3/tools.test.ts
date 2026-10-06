import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/ai";

import { PreviewWalletToolkit } from "./tools.ts";

const schemaHasDescription = (schema: unknown): boolean => {
  if (!schema || typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  if (typeof record.description === "string" && record.description.length > 0) return true;
  return [record.anyOf, record.oneOf, record.allOf]
    .filter(Array.isArray)
    .some((members) => members.some(schemaHasDescription));
};

it("exports provider-compatible object schemas with described parameters", () => {
  for (const tool of Object.values(PreviewWalletToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };

    expect(
      tool.description?.length ?? 0,
      `${tool.name} should have a useful description`,
    ).toBeGreaterThan(40);
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    expect(
      schema.properties?.tabId,
      `${tool.name} must allow an explicit collaborative browser tab target`,
    ).toBeDefined();

    for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
      expect(
        schemaHasDescription(fieldSchema),
        `${tool.name}.${field} must describe itself for the model`,
      ).toBe(true);
    }
  }
});

it("exposes exactly the five wallet tools", () => {
  expect(
    Object.values(PreviewWalletToolkit.tools)
      .map((tool) => tool.name)
      .sort(),
  ).toEqual([
    "preview_wallet_approve",
    "preview_wallet_configure",
    "preview_wallet_reject",
    "preview_wallet_requests",
    "preview_wallet_status",
  ]);
});

it("marks the read-only tools as read-only and none of them as destructive", () => {
  for (const tool of Object.values(PreviewWalletToolkit.tools)) {
    // Approving a transaction moves real value on whatever chain is configured,
    // but it is the page's request, not a wallet-initiated mutation; the
    // destructive hint is reserved for tools that change the user's workspace.
    expect(
      Context.get(tool.annotations, Tool.Destructive),
      `${tool.name} should not be flagged destructive`,
    ).toBe(false);
    expect(
      Context.get(tool.annotations, Tool.OpenWorld),
      `${tool.name} talks to a chain and a page, so it is open-world`,
    ).toBe(true);
  }

  const readOnly = Object.values(PreviewWalletToolkit.tools)
    .filter((tool) => Context.get(tool.annotations, Tool.Readonly))
    .map((tool) => tool.name)
    .sort();
  expect(readOnly).toEqual(["preview_wallet_requests", "preview_wallet_status"]);
});
