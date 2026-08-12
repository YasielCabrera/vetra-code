# CI quality gates

> For maintainers. Using Vetra Code? See [docs/user](../user/).

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs three jobs on pull requests and
pushes to `main`:

- **Check**: `vp check` (format and lint; this repo sets `typeCheck: false` in its lint options),
  then `vpr typecheck` for the workspace type check. The same job
  builds the desktop pipeline (`vp run build:desktop`) and verifies the preload bundle exists and
  still exports its expected symbols.
- **Test**: `vp run test` across the workspace.
- **Release Smoke**: exercises local packaging helpers through `scripts/release-smoke.ts`. It does
  not publish or deploy anything.

The fork does not currently include a production release or relay-deployment workflow. They were
removed so CI cannot publish to legacy upstream infrastructure while Vetra-owned package, signing,
domain, authentication, and updater targets are still undecided.

See [Release bootstrap status](../operations/release.md) for the prerequisites that must be met
before publishing automation is introduced.
