# Workspace layout

> For maintainers. Using Vetra Studio? See [docs/user](../user/).

A pnpm workspace driven by [vite-plus](https://vite.plus) (`vp`). See [scripts.md](./scripts.md) for
the task commands.

## apps

- `apps/server` (`@vetra-studio/server`): the execution runtime and future `vetra` CLI. Owns orchestration, provider
  drivers, checkpointing, VCS, terminals, filesystem access, auth, and the HTTP + WebSocket surface.
  Also serves the built web app.
- `apps/web` (`@vetra-studio/web`): React + Vite UI. Consumes the shared client runtime and adds routing,
  components, and web-specific platform layers.
- `apps/desktop` (`@vetra-studio/desktop`): Electron shell. Supervises a desktop-scoped Vetra backend,
  loads the web bundle over the `vetra://` protocol, and owns SSH-managed remote environments.

## packages

- `packages/contracts` (`@vetra-studio/contracts`): shared Effect Schema definitions. RPC group,
  orchestration commands/events/read model, auth scopes, environment descriptors, settings.
- `packages/shared` (`@vetra-studio/shared`): framework-agnostic utilities used by server and clients
  (`DrainableWorker`, git and source-control helpers, relay auth and signing, DPoP, semver, logging,
  observability, and more).
- `packages/client-runtime` (`@vetra-studio/client-runtime`): connection lifecycle, authorization, RPC
  session, environment registry, and Atom-based domain state used by the web renderer. See its
  [README](../../packages/client-runtime/README.md).
- `packages/ssh` (`@vetra-studio/ssh`): SSH config parsing, auth prompts, command execution, and the
  tunnel/environment manager behind desktop-managed SSH environments.
- `packages/tailscale` (`@vetra-studio/tailscale`): Tailscale CLI wrapper, including the
  `ensureTailscaleServe` / `disableTailscaleServe` serve lifecycle the server drives.
- `packages/effect-acp` (`effect-acp`): Effect client and agent implementation of the Agent Client
  Protocol, used by ACP-speaking provider drivers.
- `packages/effect-codex-app-server` (`effect-codex-app-server`): Effect client for the
  `codex app-server` JSON-RPC protocol.

## infra

- `infra/relay` (`@vetra-studio/relay`, temporary internal package name): the optional Vetra Connect relay,
  deployed with Alchemy. It is disabled until Vetra-owned cloud configuration exists and is not in the hot path;
  after connect, client traffic goes directly to the environment. See
  [vetra-connect.md](./vetra-connect.md).

## Other top-level directories

- `scripts/`: workspace tooling run through `vp run`. Dev runner, desktop artifact builds, release
  helpers, and update-manifest merging.
- `assets/`: brand and app icon sources per channel (`dev`, `nightly`, `prod`).
- `patches/`: pnpm patches for pinned upstream dependencies.
- `oxlint-plugin-vetra/`: repo-specific lint rules.
- `experiments/`: throwaway prototypes. Not part of the shipped build.
- `docs/`: this documentation tree.

## Import conventions

`@vetra-studio/shared` and `@vetra-studio/client-runtime` use explicit subpath exports with no barrel index and
no root export. Import the narrow path (`@vetra-studio/shared/DrainableWorker`,
`@vetra-studio/client-runtime/state/threads`) rather than the package root. Files that are not exported
are implementation details. `@vetra-studio/contracts` does export a root alongside `./settings` and
`./relay`.
