import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import {
  GitCommandError,
  GitPreparePullRequestThreadResult,
  GitRunStackedActionInput,
  VcsFileAnnotationError,
  VcsFileBlameResult,
  VcsFileLineChangesResult,
  VcsStatusLocalResult,
} from "./git.ts";
import { PullRequestDiffFileContentsInput } from "./pullRequest.ts";
import { ReviewDiffFileContentsInput } from "./review.ts";

const decodeGitCommandError = Schema.decodeUnknownSync(Schema.toCodecJson(GitCommandError));
const decodePreparePullRequestThreadResult = Schema.decodeUnknownSync(
  GitPreparePullRequestThreadResult,
);
const decodeRunStackedActionInput = Schema.decodeUnknownSync(GitRunStackedActionInput);
const encodeRunStackedActionInput = Schema.encodeUnknownSync(GitRunStackedActionInput);
const decodeReviewDiffFileContentsInput = Schema.decodeUnknownSync(ReviewDiffFileContentsInput);
const encodeReviewDiffFileContentsInput = Schema.encodeUnknownSync(ReviewDiffFileContentsInput);
const decodePullRequestDiffFileContentsInput = Schema.decodeUnknownSync(
  PullRequestDiffFileContentsInput,
);
const encodePullRequestDiffFileContentsInput = Schema.encodeUnknownSync(
  PullRequestDiffFileContentsInput,
);

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

describe("GitCommandError", () => {
  it("decodes an unknown failure reason as absent", () => {
    const error = decodeGitCommandError({
      _tag: "GitCommandError",
      operation: "GitVcsDriver.createWorktree",
      command: "git",
      cwd: "/repo",
      detail: "git worktree add failed",
      reason: "added_by_a_newer_server",
    });

    expect(error.reason).toBeUndefined();
    expect(error.message).toBe(
      "Git command failed in GitVcsDriver.createWorktree (/repo): git worktree add failed",
    );
  });
});

describe("GitPreparePullRequestThreadResult", () => {
  it("defaults legacy responses to the pull request head", () => {
    const parsed = decodePreparePullRequestThreadResult({
      pullRequest: {
        number: 42,
        title: "PR threads",
        url: "https://github.com/pingdotgg/codething-mvp/pull/42",
        baseBranch: "main",
        headBranch: "feature/pr-threads",
        state: "open",
      },
      branch: "feature/pr-threads",
      worktreePath: "/tmp/pr-threads",
    });

    expect(parsed.isOnPullRequestHead).toBe(true);
  });
});

describe("Git file paths", () => {
  it.each([
    {
      operation: "commit",
      decode: decodeRunStackedActionInput,
      encode: encodeRunStackedActionInput,
      input: {
        actionId: "action-1",
        cwd: "/repo",
        action: "commit",
        filePaths: [" leading.txt", "trailing.txt "],
      },
    },
    {
      operation: "local diff expansion",
      decode: decodeReviewDiffFileContentsInput,
      encode: encodeReviewDiffFileContentsInput,
      input: {
        cwd: "/repo",
        sourceKind: "working-tree",
        changeType: "rename-changed",
        baseRef: "HEAD",
        headRef: null,
        oldPath: " leading.txt",
        newPath: "trailing.txt ",
      },
    },
    {
      operation: "pull request diff expansion",
      decode: decodePullRequestDiffFileContentsInput,
      encode: encodePullRequestDiffFileContentsInput,
      input: {
        projectId: "project-1",
        repository: "owner/repo",
        number: 1,
        changeType: "rename-changed",
        oldPath: " leading.txt",
        newPath: "trailing.txt ",
      },
    },
  ])("preserves leading and trailing whitespace for $operation", ({ decode, encode, input }) => {
    expect(decode(input)).toEqual(input);
    expect(encode(input)).toEqual(input);
  });
});
