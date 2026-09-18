# CI quality gates

> For maintainers. Using Vetra Code? See [docs/user](../user/).

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs these quality gates on pull
requests and pushes to `main`:

- **Check**: `vp check` (format and lint; this repo sets `typeCheck: false` in its lint options),
  then `vpr typecheck` for the workspace type check. The same job
  builds the desktop pipeline (`vp run build:desktop`) and verifies the preload bundle exists and
  uses only imports that Electron's sandbox can load. The verifier parses imports, then executes the
  trusted artifact with controlled bridge stubs to confirm that its required APIs are callable.
- **Test**: every workspace package except `t3`, run in parallel with a concurrency
  limit of 4. This job also installs the Electron runtime, which `@t3tools/desktop` tests need.
- **Test Server 1-3**: `t3` only, sharded across three runners. `apps/server` sets
  `fileParallelism: false`, so sharding is how its suite gets parallelism without ever putting two
  server test files on one machine.
- **Rust**: `cargo fmt --check` and `cargo test` for `native/resource-monitor`, split out so the
  Check and Test jobs no longer install a Rust toolchain on the critical path of every PR.
- **Release Smoke**: exercises local packaging helpers through `scripts/release-smoke.ts`. It does
  not publish or deploy anything.

Mobile native static analysis exists upstream and is not part of this fork; `apps/mobile` was
removed.

[`.github/workflows/windows-tests.yml`](../../.github/workflows/windows-tests.yml) is a manual
Windows lane (`workflow_dispatch` only) on a Blacksmith Windows 2025 runner. The suite does not
pass on Windows yet, so it is not a required check; it exists so the work to get there can be
iterated against a real Windows box without one on hand. Dispatch it with `gh workflow run
windows-tests.yml --ref <branch>`, optionally with `-f package=<dir>` to run one workspace package
and `-f files="<paths>"` to run specific test files inside it. Once it is green, fold it into
`ci.yml`.

Upstream's `release.yml` is not part of this fork; it stays deleted until Vetra owns every publish
target. See [upstream-sync](upstream-sync.md).

The fork does not currently include a production release or relay-deployment workflow. They were
removed so CI cannot publish to legacy upstream infrastructure while Vetra-owned package, signing,
domain, authentication, and updater targets are still undecided. Upstream still has those workflows;
a sync can restore them. Drop them again if they return. See
[Syncing upstream Vetra Code](./upstream-sync.md).

See [Release bootstrap status](../operations/release.md) for the prerequisites that must be met
before publishing automation is introduced.
