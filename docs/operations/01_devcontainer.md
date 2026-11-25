# Dev container

`.devcontainer/` provides a Linux development environment matching CI, with `vp`, Rust, and the GitHub CLI installed and workspace dependencies prepared before you attach. Open the repo in VS Code ("Reopen in Container") or create a GitHub Codespace.

## What works

- `vp run dev` (open the printed pairing URL through the forwarded web port; in browser Codespaces, pass the forwarded origin via `VETRA_DEV_ALLOWED_ORIGINS` if rejected).
- Linux CI checks: focused `vp test run <files>`, `vp lint <files>`, package typechecks, `vp run build:desktop`, and the resource-monitor Cargo build and tests.

## State and caching

## State and safety

`VETRA_HOME` points at the workspace's gitignored `.vetra-code`, so all runtime state stays inside the container workspace, mirroring the worktree default. There is no live install to damage inside a container, but the test-data rule from AGENTS.md still holds: copy data in, never point at shared state.

## Caching

Two named volumes keep rebuilds fast and installs off the slow macOS/Windows bind mount: the pnpm store (shared across checkouts, mounted where `vp i` keeps it) and root `node_modules` (per-container, which covers the whole `.pnpm` virtual store since workspace packages just symlink into it). Deleting a container and recreating it reuses both, so a rebuild's `vp i` is seconds, not minutes. The host sees an empty `node_modules`; run host-side tooling inside the container.

## Out of scope

- Windowed Electron development is host-only. Building and verifying the desktop bundle works fine in the container (CI does exactly that, headless); launching the app needs a display.
- `vp run dev --share` needs a tailscale binary and a tailnet; not provisioned here.

## Prebuilds

Codespaces prebuilds bake in `onCreateCommand` and `updateContentCommand` automatically. Note that prebuild snapshots exclude named caching volumes, so a prebuild-first workflow may prefer dropping the volume mounts. Outside Codespaces, push a prebuilt image with:

```bash
devcontainer build --workspace-folder . --push true --image-name <registry>/vetra-code-devcontainer:latest
```
