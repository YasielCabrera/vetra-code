import { EnvironmentId } from "@vetra-studio/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "~/composerDraftStore";
import { ensureRootProjectDraft, ROOT_PROJECT_DRAFT_ID } from "~/lib/rootProjectDraft";

describe("root project draft", () => {
  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadKey: {},
      draftThreadsByThreadKey: {},
      logicalProjectDraftThreadKeyByLogicalProjectKey: {},
      stickyModelSelectionByProvider: {},
      stickyActiveProvider: null,
    });
  });

  it("reuses one stable landing session across repeated initialization", () => {
    const environmentId = EnvironmentId.make("environment-local");

    const first = ensureRootProjectDraft({
      environmentId,
      defaultParentDirectory: "~/Vetra Studio Projects",
    });
    const second = ensureRootProjectDraft({
      environmentId,
      defaultParentDirectory: "~/Another Location",
    });

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
    expect(Object.keys(useComposerDraftStore.getState().draftThreadsByThreadKey)).toEqual([
      ROOT_PROJECT_DRAFT_ID,
    ]);
    expect(second?.pendingProject).toEqual({
      association: "unselected",
      parentDirectory: "~/Vetra Studio Projects",
      folderName: "",
      locationConfirmed: false,
      materialized: false,
    });
  });
});
