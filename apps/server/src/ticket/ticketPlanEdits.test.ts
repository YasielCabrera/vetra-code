import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { applyPlanEdits } from "./ticketPlanEdits.ts";

describe("applyPlanEdits", () => {
  it.effect("applies edits in order, each against the text the earlier ones left", () =>
    Effect.gen(function* () {
      const body = yield* applyPlanEdits("1. Add a column\n2. Ship it", [
        { find: "Add a column", replace: "Add a $& column" },
        { find: "$& column\n2.", replace: "nullable column\n2. Backfill it\n3." },
      ]);
      assert.strictEqual(body, "1. Add a nullable column\n2. Backfill it\n3. Ship it");
    }),
  );

  it.effect("names the edit that matched nothing or more than once", () =>
    Effect.gen(function* () {
      const missing = yield* applyPlanEdits("Ship it", [
        { find: "Ship", replace: "Release" },
        { find: "Ship", replace: "Release" },
      ]).pipe(Effect.flip);
      const ambiguous = yield* applyPlanEdits("aaa", [{ find: "aa", replace: "b" }]).pipe(
        Effect.flip,
      );
      assert.deepStrictEqual(
        [missing.message, ambiguous.message],
        [
          "Edit 2 matched nothing: its find text is not in the plan.",
          "Edit 1 matched more than once: add surrounding text to its find text so it matches once.",
        ],
      );
    }),
  );

  it.effect("refuses a result over the body limit", () =>
    Effect.gen(function* () {
      const error = yield* applyPlanEdits("x", [{ find: "x", replace: "y".repeat(100_001) }]).pipe(
        Effect.flip,
      );
      assert.strictEqual(
        error.message,
        "The edits would make the plan longer than 100,000 characters.",
      );
    }),
  );
});
