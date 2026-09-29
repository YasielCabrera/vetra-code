import { describe, expect, it } from "@effect/vitest";

import { speechChunks } from "./speechChunks.ts";

describe("speechChunks", () => {
  it("sends the first sentence alone and folds later fragments into the next sentence", () => {
    expect(speechChunks("Done. Follow-through: I ran the install. It passed.")).toEqual([
      "Done.",
      "Follow-through: I ran the install. It passed.",
    ]);
  });

  it("splits a long sentence at clause boundaries so each piece fits one synthesis call", () => {
    const clause = "the server rebuilt the lockfile and reran every focused test";
    const sentence = `${Array.from({ length: 8 }, () => clause).join(", ")}.`;
    const chunks = speechChunks(sentence);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= 280)).toBe(true);
    expect(chunks.join(" ")).toBe(sentence);
  });

  it("treats lines as sentences and drops lines with nothing to say", () => {
    expect(
      speechChunks("Removed from the portal:\nthe oxlint dependency\n—\ntwo config files"),
    ).toEqual(["Removed from the portal:", "the oxlint dependency. two config files."]);
  });
});
