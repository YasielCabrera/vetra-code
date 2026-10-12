const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const PACKAGE_VERSION = /^(\d+)\.(\d+)\.(\d+)/;

function parsePackageVersion(packageVersion) {
  const match = PACKAGE_VERSION.exec(packageVersion);
  if (!match) {
    throw new Error(`Desktop package version '${packageVersion}' is not semver.`);
  }
  return match.slice(1).map(Number);
}

// Releases follow the desktop package version: upstream `M.0.P` is our line
// `M.P`, and each published release on that line bumps the patch. Drafts,
// other lines, and tags that are not `vX.Y.Z` are ignored.
function nextReleaseVersion({ releases, packageVersion }) {
  const [major, minor, patch] = parsePackageVersion(packageVersion);
  if (minor !== 0) {
    throw new Error(
      `Upstream version '${packageVersion}' no longer fits the M.0.P -> M.P.X mapping; the scheme needs a decision.`,
    );
  }

  const patches = releases
    .filter((release) => !release.isDraft)
    .map((release) => RELEASE_TAG.exec(release.tagName))
    .filter(Boolean)
    .map((match) => match.slice(1).map(Number))
    .filter(([releaseMajor, releaseMinor]) => releaseMajor === major && releaseMinor === patch)
    .map(([, , releasePatch]) => releasePatch);
  const nextPatch = patches.length === 0 ? 0 : Math.max(...patches) + 1;
  return `${major}.${patch}.${nextPatch}`;
}

module.exports = { nextReleaseVersion };

// Usage: gh release list --json tagName,isDraft | node next-release-version.cjs
if (require.main === module) {
  const releases = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const { version } = require("../../apps/desktop/package.json");
  process.stdout.write(`${nextReleaseVersion({ releases, packageVersion: version })}\n`);
}
