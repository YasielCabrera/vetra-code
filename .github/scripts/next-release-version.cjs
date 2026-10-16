const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

// Upstream package versions can be lower than already-published Vetra versions.
function nextReleaseVersion({ releases }) {
  const versions = releases
    .filter((release) => !release.isDraft)
    .map((release) => RELEASE_TAG.exec(release.tagName))
    .filter(Boolean)
    .map((match) => match.slice(1).map(Number))
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  if (versions.length === 0) return "0.1.0";
  const [major, minor, patch] = versions.at(-1);
  return `${major}.${minor}.${patch + 1}`;
}

module.exports = { nextReleaseVersion };

// Usage: gh release list --json tagName,isDraft | node next-release-version.cjs
if (require.main === module) {
  const releases = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  process.stdout.write(`${nextReleaseVersion({ releases })}\n`);
}
