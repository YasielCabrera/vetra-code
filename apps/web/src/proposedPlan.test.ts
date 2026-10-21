import { describe, expect, it } from "vite-plus/test";

import { resolvePlanFollowUpSubmission } from "./proposedPlan";
import { stripProposedPlanTitleHeading } from "./proposedPlan";

describe("stripProposedPlanTitleHeading", () => {
  it("drops only a leading title heading and keeps the rest as written", () => {
    expect([
      stripProposedPlanTitleHeading(
        "\n# Auth migration\n\n## Summary\n\nMove sessions to JWT.\n\n## Steps\n1. Add issuer\n",
      ),
      stripProposedPlanTitleHeading("Intro first.\n\n# Auth migration\n\n    indented code\n"),
      stripProposedPlanTitleHeading("# Auth migration\n    indented code"),
    ]).toEqual([
      "## Summary\n\nMove sessions to JWT.\n\n## Steps\n1. Add issuer\n",
      "Intro first.\n\n# Auth migration\n\n    indented code\n",
      "    indented code",
    ]);
  });
});

describe("resolvePlanFollowUpSubmission", () => {
  it.each(["", "Consider this "])(
    "keeps context-bearing feedback in plan mode with prose %j",
    (prose) => {
      const draftText = `${prose}[PR #42](vetra-context://v1/review-comment/pr-42)`;
      expect(resolvePlanFollowUpSubmission({ draftText, planMarkdown: "# Plan" })).toEqual({
        text: draftText,
        interactionMode: "plan",
      });
    },
  );
  it("switches to default mode when implementing the ready plan without extra text", () => {
    expect(
      resolvePlanFollowUpSubmission({
        draftText: "   ",
        planMarkdown: "## Ship it\n\n- step 1\n",
      }),
    ).toEqual({
      text: "PLEASE IMPLEMENT THIS PLAN:\n## Ship it\n\n- step 1",
      interactionMode: "default",
    });
  });
});
