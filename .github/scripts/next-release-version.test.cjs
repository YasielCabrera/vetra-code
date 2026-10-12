const assert = require("node:assert/strict");
const test = require("node:test");
const { nextReleaseVersion } = require("./next-release-version.cjs");

const release = (tagName, isDraft = false) => ({ tagName, isDraft });

test("starts one minor past the desktop package version", () => {
  assert.equal(nextReleaseVersion({ releases: [], packageVersion: "0.0.45" }), "0.1.0");
});

test("bumps the minor of the latest release", () => {
  assert.equal(
    nextReleaseVersion({ releases: [release("v0.1.0")], packageVersion: "0.0.45" }),
    "0.2.0",
  );
});

test("sorts releases by semver, not lexically", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [release("v0.9.0"), release("v0.10.0"), release("v0.2.0")],
      packageVersion: "0.0.45",
    }),
    "0.11.0",
  );
  assert.equal(
    nextReleaseVersion({
      releases: [release("v1.0.0"), release("v0.12.3")],
      packageVersion: "0.0.45",
    }),
    "1.1.0",
  );
});

test("ignores drafts and non-semver tags", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [
        release("v0.4.0", true),
        release("desktop-preview"),
        release("v0.3.0-nightly.20261012.1"),
        release("0.5.0"),
        release("v0.2.0"),
      ],
      packageVersion: "0.0.45",
    }),
    "0.3.0",
  );
  assert.equal(
    nextReleaseVersion({
      releases: [release("v0.4.0", true), release("desktop-preview")],
      packageVersion: "0.0.45",
    }),
    "0.1.0",
  );
});

test("rejects a package version it cannot parse", () => {
  assert.throws(
    () => nextReleaseVersion({ releases: [], packageVersion: "next" }),
    /is not semver/,
  );
});
