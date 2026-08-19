import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  VcsCreateWorktreeInput,
  GitPreparePullRequestThreadInput,
  GitRunStackedActionResult,
  GitRunStackedActionInput,
  GitResolvePullRequestResult,
  VcsFileAnnotationError,
  VcsFileBlameResult,
  VcsFileLineChangesResult,
  VcsStatusLocalResult,
} from "./git.ts";

const decodeCreateWorktreeInput = Schema.decodeUnknownSync(VcsCreateWorktreeInput);
const decodePreparePullRequestThreadInput = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadInput,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const decodeRunStackedActionResult = Schema.decodeUnknownSync(GitRunStackedActionResult);
const decodeResolvePullRequestResult = Schema.decodeUnknownSync(GitResolvePullRequestResult);
const decodeStatusLocalResult = Schema.decodeUnknownSync(VcsStatusLocalResult);
const decodeFileLineChangesResult = Schema.decodeUnknownSync(VcsFileLineChangesResult);
const decodeFileBlameResult = Schema.decodeUnknownSync(VcsFileBlameResult);
const decodeFileAnnotationError = Schema.decodeUnknownSync(VcsFileAnnotationError);

function localStatusFile(status?: string) {
  return decodeStatusLocalResult({
    isRepo: true,
    hasPrimaryRemote: false,
    isDefaultRef: true,
    refName: "main",
    hasWorkingTreeChanges: true,
    workingTree: {
      files: [
        {
          path: "src/index.ts",
          insertions: 1,
          deletions: 0,
          ...(status === undefined ? {} : { status }),
        },
      ],
      insertions: 1,
      deletions: 0,
    },
  }).workingTree.files[0];
}

describe("VcsStatusLocalResult", () => {
  it.each(["added", "modified", "renamed", "untracked", "deleted"])(
    "accepts the %s working-tree file status",
    (status) => {
      expect(localStatusFile(status)?.status).toBe(status);
    },
  );

  it("accepts legacy working-tree files without a status", () => {
    expect(localStatusFile()?.status).toBeUndefined();
  });
});

describe("file annotation contracts", () => {
  const lineChanges = {
    state: "modified",
    headOid: "0123456789abcdef0123456789abcdef01234567",
    lineCount: 4,
    addedRanges: [1, 2],
    modifiedRanges: [3, 1],
    deletionMarkers: [0, 2, 4, 1],
  } as const;

  it("decodes flat line-change pairs", () => {
    expect(decodeFileLineChangesResult(lineChanges)).toEqual(lineChanges);
  });

  it.each([
    ["negative", [-1, 1]],
    ["non-integer", [1, 1.5]],
    ["odd-length", [1]],
  ])("rejects %s flat arrays", (_label, addedRanges) => {
    expect(() => decodeFileLineChangesResult({ ...lineChanges, addedRanges })).toThrow();
  });

  it("decodes contiguous blame runs", () => {
    expect(
      decodeFileBlameResult({
        firstLine: 1,
        lineCount: 4,
        headOid: lineChanges.headOid,
        commits: [
          {
            oid: lineChanges.headOid,
            author: "Pierre",
            authorEmail: "pierre@example.com",
            authorTime: 1_700_000_000,
            summary: "Annotate files",
          },
        ],
        runs: [4, 0],
        localIdentity: { author: "Pierre", authorEmail: "pierre@example.com" },
      }).runs,
    ).toEqual([4, 0]);
  });

  it.each([
    ["negative", [-1, 0]],
    ["non-integer", [1.5, 0]],
    ["odd-length", [4]],
    ["zero-length run", [0, 0]],
    ["out-of-bounds commit", [4, 1]],
    ["coverage mismatch", [3, 0]],
  ])("rejects %s blame runs", (_label, runs) => {
    expect(() =>
      decodeFileBlameResult({
        firstLine: 1,
        lineCount: 4,
        headOid: null,
        commits: [
          {
            oid: "0000000000000000000000000000000000000000",
            author: "",
            authorEmail: "",
            authorTime: null,
            summary: "",
          },
        ],
        runs,
        localIdentity: null,
      }),
    ).toThrow();
  });

  it.each(["line_changes", "blame"] as const)("round-trips the %s operation", (operation) => {
    const error = decodeFileAnnotationError({
      _tag: "VcsFileAnnotationError",
      operation,
      path: "src/index.ts",
      failure: "content_changed",
    });
    expect(error.operation).toBe(operation);
  });

  it.each([
    "content_changed",
    "file_too_large",
    "binary_file",
    "path_outside_workspace",
    "path_not_file",
    "file_unavailable",
    "unsupported",
    "git_failed",
    "invalid_output",
  ] as const)("round-trips the %s failure", (failure) => {
    const error = decodeFileAnnotationError({
      _tag: "VcsFileAnnotationError",
      operation: "blame",
      path: "src/index.ts",
      failure,
    });
    expect(error.failure).toBe(failure);
  });
});

describe("VcsCreateWorktreeInput", () => {
  it("accepts omitted newRefName for existing-refName worktrees", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "feature/existing",
      path: "/tmp/worktree",
    });

    expect(parsed.newRefName).toBeUndefined();
    expect(parsed.refName).toBe("feature/existing");
  });

  it("accepts baseRefName metadata for a new worktree ref", () => {
    const parsed = decodeCreateWorktreeInput({
      cwd: "/repo",
      refName: "0123456789abcdef",
      newRefName: "feature/new",
      baseRefName: "origin/main",
      path: "/tmp/worktree",
    });

    expect(parsed.baseRefName).toBe("origin/main");
  });
});

describe("GitPreparePullRequestThreadInput", () => {
  it("accepts pull request references and mode", () => {
    const parsed = decodePreparePullRequestThreadInput({
      cwd: "/repo",
      reference: "#42",
      mode: "worktree",
    });

    expect(parsed.reference).toBe("#42");
    expect(parsed.mode).toBe("worktree");
  });
});

describe("GitResolvePullRequestResult", () => {
  it("decodes resolved pull request metadata", () => {
    const parsed = decodeResolvePullRequestResult({
      pullRequest: {
        number: 42,
        title: "PR threads",
        url: "https://github.com/vetra-code/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open",
      },
    });

    expect(parsed.pullRequest.number).toBe(42);
    expect(parsed.pullRequest.headBranch).toBe("feature/pr-threads");
  });
});

describe("GitRunStackedActionInput", () => {
  it("accepts explicit stacked actions and requires a client-provided actionId", () => {
    const parsed = decodeRunStackedActionInput({
      actionId: "action-1",
      cwd: "/repo",
      action: "create_pr",
    });

    expect(parsed.actionId).toBe("action-1");
    expect(parsed.action).toBe("create_pr");
  });
});

describe("GitRunStackedActionResult", () => {
  it("decodes a server-authored completion toast", () => {
    const parsed = decodeRunStackedActionResult({
      action: "commit_push",
      branch: {
        status: "created",
        name: "feature/server-owned-toast",
      },
      commit: {
        status: "created",
        commitSha: "89abcdef01234567",
        subject: "feat: move toast state into git manager",
      },
      push: {
        status: "pushed",
        branch: "feature/server-owned-toast",
        upstreamBranch: "origin/feature/server-owned-toast",
      },
      pr: {
        status: "skipped_not_requested",
      },
      toast: {
        title: "Pushed 89abcde to origin/feature/server-owned-toast",
        description: "feat: move toast state into git manager",
        cta: {
          kind: "run_action",
          label: "Create PR",
          action: {
            kind: "create_pr",
          },
        },
      },
    });

    expect(parsed.toast.cta.kind).toBe("run_action");
    if (parsed.toast.cta.kind === "run_action") {
      expect(parsed.toast.cta.action.kind).toBe("create_pr");
    }
  });
});
