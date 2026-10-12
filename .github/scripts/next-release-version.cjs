const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const PACKAGE_VERSION = /^(\d+)\.(\d+)\.(\d+)/;

function parsePackageVersion(packageVersion) {
  const match = PACKAGE_VERSION.exec(packageVersion);
  if (!match) {
    throw new Error(`Desktop package version '${packageVersion}' is not semver.`);
  }
  return match.slice(1).map(Number);
}

// Every release bumps the minor. The newest published `vX.Y.Z` release in
// this repository wins; before the first one, start from the desktop package
// version. Drafts never created their tag, and other tags (the rolling
// `desktop-preview`, prerelease suffixes) are not part of this line.
function nextReleaseVersion({ releases, packageVersion }) {
  const [latest] = releases
    .filter((release) => !release.isDraft)
    .map((release) => RELEASE_TAG.exec(release.tagName))
    .filter(Boolean)
    .map((match) => match.slice(1).map(Number))
    .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2]);
  const [major, minor] = latest ?? parsePackageVersion(packageVersion);
  return `${major}.${minor + 1}.0`;
}

module.exports = { nextReleaseVersion };

// Usage: gh release list --json tagName,isDraft | node next-release-version.cjs
if (require.main === module) {
  const releases = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const { version } = require("../../apps/desktop/package.json");
  process.stdout.write(`${nextReleaseVersion({ releases, packageVersion: version })}\n`);
}
