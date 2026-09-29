import { describe, expect, it } from "@effect/vitest";

import { speechText } from "./speechText.ts";

describe("speechText", () => {
  it("reads file paths as their file name, without line numbers", () => {
    expect(
      speechText(
        "I updated apps/web/src/state/threads.ts and apps/portal/validation-tab/validation-tab.tsx:164,173.",
      ),
    ).toBe("I updated threads.ts and validation-tab.tsx.");
    expect(speechText("Settings live in ~/.vetra-code/userdata/settings.json.")).toBe(
      "Settings live in settings.json.",
    );
    expect(speechText("See ./scripts/dev-runner.ts:825 and ChatMarkdown.tsx:681.")).toBe(
      "See dev-runner.ts and ChatMarkdown.tsx.",
    );
    expect(speechText(String.raw`Open C:\Users\me\project\index.html`)).toBe("Open index.html");
  });

  it("reads a deep directory as its last folder", () => {
    expect(speechText("Everything under apps/server/src/textToSpeech/ changed.")).toBe(
      "Everything under textToSpeech changed.",
    );
  });

  it("leaves very long unbroken runs alone", () => {
    const text = `Pushed apps/${"x".repeat(300)}/index.ts and ${"f".repeat(40_000)}.`;
    expect(speechText(text)).toBe(text);
  });

  it("leaves names that only look like paths alone", () => {
    const text =
      "PR #31 added @tanstack/react-table, rebased onto origin/main, bumped @reown/appkit@1.8.9 on 2026/09/29, see https://github.com/org/repo/blob/main/a.ts. It handles input/output/error streams, yes/no/maybe.";
    expect(speechText(text)).toBe(text);
  });
});
