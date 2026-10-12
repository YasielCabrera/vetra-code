# Desktop releases

> For maintainers. Vetra Code publishes unsigned desktop installers and nothing else.

The [Desktop Release](../../.github/workflows/desktop-release.yml) workflow is the only GitHub Actions
workflow in this repository. It runs only when started by hand, on GitHub-hosted runners, which are
free for this public repository. There is no CI on pull requests or pushes.

## Cut a release

Start the workflow on `main` from the repository's **Actions** tab (**Desktop Release → Run
workflow**), or from a checkout:

```bash
gh workflow run desktop-release.yml
```

A run builds one installer per platform in parallel:

| Platform              | Installer   |
| --------------------- | ----------- |
| macOS (Apple Silicon) | `.dmg`      |
| Linux x64             | `.AppImage` |
| Windows x64           | `.exe`      |

When all three builds succeed, it creates GitHub release `vX.Y.Z`, tagged at the commit it built,
with generated notes and the three installers attached. If any build fails, nothing is published and
no version is used; fix the failure and start a new run. A run started while another is in progress
waits for it.

Unlike upstream, the Windows build embeds no WSL runtime archive (`--wsl-runtime`, built from
upstream's Linux CLI archive), so WSL backends fall back to the server tree mounted from Windows.

## Versioning

Releases track upstream's desktop package version: `0.0.N` is our line `0.N`, and each release
bumps the patch on that line (`v0.45.0`, then `v0.45.1`). A sync that moves upstream to `0.0.46`
starts `v0.46.0`. Drafts, releases on other lines, and tags that are not `vX.Y.Z` are ignored. The
source is this repository's releases, not Git tags: a clone that fetched upstream carries T3's
`v0.0.x` tags.

## Unsigned installers

We hold no Apple Developer ID or Windows signing certificate, so the installers are not signed or
notarized, and each platform warns on first launch:

- **macOS**: Gatekeeper refuses to open the app. Clear the quarantine flag on the downloaded DMG
  before opening it: `xattr -d com.apple.quarantine ~/Downloads/Vetra-Code-*-arm64.dmg`.
- **Windows**: SmartScreen shows **Windows protected your PC**. Choose **More info**, then **Run
  anyway**.
- **Linux**: mark the AppImage executable with `chmod +x Vetra-Code-*.AppImage`.

Releases carry no `latest*.yml` update feeds or blockmaps, and the build names no update
repository, so installed apps never check for updates. Users update by installing a newer release.

## What stays disabled

- `@vetra-code/server` is private and cannot be installed through `npx`;
- hosted web deployment has no production route or domain;
- the inherited relay deployment is absent;
- desktop auto-update does not start unless `VETRA_ENABLE_AUTO_UPDATE=true`;
- cloud UI stays hidden when Vetra Clerk and relay public configuration is absent;
- product analytics send nothing: `VETRA_TELEMETRY_ENABLED` defaults to false, no PostHog project
  key ships, and a blank key is treated as disabled even when the flag is on.

Do not target another product's GitHub repository, npm package, hosted domains, Clerk application,
relay, telemetry project, signing identity, or updater feed. Upstream's workflows never return
through a sync; see [Syncing upstream Vetra Code](../internals/upstream-sync.md#own).

## Local release-shaped verification

These commands build the artifacts without publishing anything:

```bash
pnpm install
pnpm exec vp run --filter t3 build
pnpm exec vp run --filter @t3tools/desktop build
pnpm release:smoke
```

Use focused typechecks and tests for changed packages before those builds. The release smoke script
validates local packaging helpers only.

## Prerequisites for wider publishing

Record and review all of these before publishing more than unsigned installers:

1. A final public package name and registry ownership for the server CLI.
2. Vetra-owned web, latest, nightly, relay API, and tunnel domains.
3. Separate development and production Clerk applications and OAuth callbacks.
4. Desktop signing/notarization identities and the final platform application IDs.
5. A Vetra telemetry destination, or an explicit decision to ship without remote telemetry.
6. A tested updater repository configured through `VETRA_DESKTOP_UPDATE_REPOSITORY`.
7. Vetra-owned Cloudflare/database infrastructure if the inherited relay is retained.
8. Secret scopes and protected CI environments that prevent preview builds from reaching production.

## Required release invariants

When publishing grows beyond unsigned installers:

- publish the exact server version before exposing a client that may request it;
- publish updater metadata and installers from the same immutable version;
- keep stable and prerelease channels separate;
- make signing optional for local verification but explicit for public artifacts;
- deploy hosted web only to Vetra-owned domains;
- test install, update, rollback guidance, and app/server version skew;
- keep production deployment in a separate, reviewable workflow from normal CI;
- pass the relay client tracing config between jobs as an uploaded artifact, never as a masked
  cross-job output. `infra/relay/scripts/deploy.test.ts` asserted this against the inherited
  `release.yml` and was removed with it; restore that assertion alongside the workflow.
