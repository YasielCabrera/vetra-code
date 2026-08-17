# Release bootstrap status

> For maintainers. Vetra Code has no production release pipeline yet.

The legacy upstream release and relay-deployment workflows were removed during fork isolation.
That is deliberate: running them before Vetra owns every target could publish packages, desktop
artifacts, hosted web builds, or infrastructure under the wrong product identity.

## What is disabled

- `.github/workflows/release.yml` is absent;
- `.github/workflows/deploy-relay.yml` is absent;
- `@vetra-code/server` is private and cannot be installed through `npx`;
- hosted web deployment has no production route or domain;
- desktop auto-update does not start unless `VETRA_ENABLE_AUTO_UPDATE=true`;
- cloud UI stays hidden when Vetra Clerk and relay public configuration is absent;
- product analytics send nothing: `VETRA_TELEMETRY_ENABLED` defaults to false, no PostHog project
  key ships, and a blank key is treated as disabled even when the flag is on.

Do not restore those workflows or target another product's GitHub repository, npm package, hosted
domains, Clerk application, relay, telemetry project, signing identity, or updater feed.

An upstream merge can bring `release.yml`, `deploy-relay.yml`, and the mobile workflows back. After
every T3 Code sync, confirm they are still absent. See [Syncing upstream T3 Code](../internals/upstream-sync.md).

## Local release-shaped verification

These commands build the artifacts without publishing anything:

```bash
pnpm install
pnpm exec vp run --filter @vetra-code/server build
pnpm exec vp run --filter @vetra-code/desktop build
pnpm release:smoke
```

Use focused typechecks and tests for changed packages before those builds. The release smoke script
validates local packaging helpers only; it is not proof that a production release system exists.

## Prerequisites for a Vetra release workflow

Record and review all of these before adding publishing automation:

1. A Vetra-owned Git repository and release location.
2. A final public package name and registry ownership for the server CLI.
3. Vetra-owned web, latest, nightly, relay API, and tunnel domains.
4. Separate development and production Clerk applications and OAuth callbacks.
5. Desktop signing/notarization identities and the final platform application IDs.
6. A Vetra telemetry destination, or an explicit decision to ship without remote telemetry.
7. A tested updater repository configured through `VETRA_DESKTOP_UPDATE_REPOSITORY`.
8. Vetra-owned Cloudflare/database infrastructure if the inherited relay is retained.
9. Secret scopes and protected CI environments that prevent preview builds from reaching production.

## Required release invariants

When publishing is introduced:

- publish the exact server version before exposing a client that may request it;
- publish updater metadata and installers from the same immutable version;
- keep stable and prerelease channels separate;
- make signing optional for local verification but explicit for public artifacts;
- deploy hosted web only to Vetra-owned domains;
- test install, update, rollback guidance, and app/server version skew;
- keep production deployment in a separate, reviewable workflow from normal CI.

Until every prerequisite is satisfied, source checkout development is the supported distribution
model described in [Install and first run](../user/install.md).
