import { scopeProjectRef } from "@vetra-code/client-runtime/environment";
import type { EnvironmentId } from "@vetra-code/contracts";

import { DraftId, useComposerDraftStore } from "~/composerDraftStore";
import { newProjectId, newThreadId } from "~/lib/utils";
import { DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY } from "~/lib/pendingProject";

export const ROOT_PROJECT_DRAFT_ID = DraftId.make("root-project-draft");

const ROOT_PROJECT_LOGICAL_KEY = "root-project-draft";

/**
 * Ensures the root route has one reusable client-side draft session.
 *
 * This is intentionally synchronous and idempotent so React's development
 * effect replay cannot allocate duplicate project or thread identities.
 */
export function ensureRootProjectDraft(input: {
  environmentId: EnvironmentId;
  defaultParentDirectory: string;
}) {
  const store = useComposerDraftStore.getState();
  const existing = store.getDraftSession(ROOT_PROJECT_DRAFT_ID);
  if (existing) {
    return existing;
  }

  const projectId = newProjectId();
  const threadId = newThreadId();
  store.setLogicalProjectDraftThreadId(
    ROOT_PROJECT_LOGICAL_KEY,
    scopeProjectRef(input.environmentId, projectId),
    ROOT_PROJECT_DRAFT_ID,
    {
      threadId,
      createdAt: new Date().toISOString(),
      branch: null,
      worktreePath: null,
      envMode: "local",
      startFromOrigin: false,
      pendingProject: {
        association: "unselected",
        parentDirectory:
          input.defaultParentDirectory.trim() || DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY,
        folderName: "",
        locationConfirmed: false,
        materialized: false,
      },
    },
  );
  store.applyStickyState(ROOT_PROJECT_DRAFT_ID);

  return store.getDraftSession(ROOT_PROJECT_DRAFT_ID);
}
