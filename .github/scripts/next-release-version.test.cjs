const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");
const { nextReleaseVersion } = require("./next-release-version.cjs");

const release = (tagName, isDraft = false) => ({ tagName, isDraft });

test("workflow CLI continues the published series after the upstream sync", () => {
  const result = spawnSync(process.execPath, [path.join(__dirname, "next-release-version.cjs")], {
    input: JSON.stringify([release("v0.45.4"), release("v0.1.0")]),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "0.45.5\n");
});

test("starts at 0.1.0 when nothing is published", () => {
  assert.equal(nextReleaseVersion({ releases: [] }), "0.1.0");
});

test("bumps the patch of the current line", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [release("v0.45.0"), release("v0.45.1")],
    }),
    "0.45.2",
  );
});

test("sorts the patch numerically, not lexically", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [release("v0.45.9"), release("v0.45.10")],
    }),
    "0.45.11",
  );
});

test("continues the published series without an upstream package version", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [release("v0.45.4"), release("v0.1.0")],
    }),
    "0.45.5",
  );
});

test("ignores drafts and non vX.Y.Z tags", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [
        release("v0.1.0"),
        release("v0.2.0"),
        release("v0.45.4"),
        release("v0.45.5", true),
        release("desktop-preview"),
        release("v0.45.1-nightly"),
        release("0.45.1"),
      ],
    }),
    "0.45.5",
  );
});

test("picks the highest published version numerically across release series", () => {
  assert.equal(
    nextReleaseVersion({
      releases: [release("v1.9.20"), release("v0.99.99"), release("v1.10.2"), release("v1.10.1")],
    }),
    "1.10.3",
  );
});

test("a published major release wins over an older series", () => {
  assert.equal(nextReleaseVersion({ releases: [release("v1.99.99"), release("v2.0.0")] }), "2.0.1");
});

test("starts at 0.1.0 when only drafts and prereleases exist", () => {
  assert.equal(
    nextReleaseVersion({ releases: [release("v1.0.0", true), release("v1.0.0-beta.1")] }),
    "0.1.0",
  );
});
