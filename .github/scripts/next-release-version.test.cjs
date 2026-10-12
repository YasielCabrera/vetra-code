const assert = require("node:assert/strict");
const test = require("node:test");
const { nextReleaseVersion } = require("./next-release-version.cjs");

const release = (tagName, isDraft = false) => ({ tagName, isDraft });

test("starts a line at patch 0 when nothing is published on it", () => {
  assert.equal(nextReleaseVersion({ releases: [], packageVersion: "0.0.45" }), "0.45.0");
});

test("bumps the patch of the current line", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [release("v0.45.0"), release("v0.45.1")],
      packageVersion: "0.0.45",
    }),
    "0.45.2",
  );
});

test("sorts the patch numerically, not lexically", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [release("v0.45.9"), release("v0.45.10")],
      packageVersion: "0.0.45",
    }),
    "0.45.11",
  );
});

test("starts a new line after an upstream sync", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [release("v0.45.3")],
      packageVersion: "0.0.46",
    }),
    "0.46.0",
  );
});

test("ignores other lines, drafts, and non vX.Y.Z tags", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [
        release("v0.1.0"),
        release("v0.2.0"),
        release("v0.45.5", true),
        release("desktop-preview"),
        release("v0.45.1-nightly"),
        release("0.45.1"),
      ],
      packageVersion: "0.0.45",
    }),
    "0.45.0",
  );
});

test("rejects a package version whose middle number is not 0", () => {
  for (const packageVersion of ["0.1.0", "1.2.3"]) {
    assert.throws(
      () => nextReleaseVersion({ releases: [], packageVersion }),
      /no longer fits the M\.0\.P -> M\.P\.X mapping; the scheme needs a decision/,
    );
  }
});

test("rejects a package version it cannot parse", () => {
  assert.throws(
    () => nextReleaseVersion({ releases: [], packageVersion: "next" }),
    /is not semver/,
  );
});
