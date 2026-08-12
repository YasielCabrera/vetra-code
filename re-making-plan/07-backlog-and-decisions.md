# 07 — Ordered backlog and decisions

## Work packages

### P0 — Safe baseline

- [x] P0.1 Create the local `vetra-code` branch and retain the original repository as `upstream`.
      Add a Vetra-owned `origin` only after its repository exists.
- [x] P0.2 Install dependencies without launching desktop.
- [x] P0.3 Resolve web/server configuration with `pnpm dev --dry-run`.
- [x] P0.4 Confirm the printed Vetra base directory and ports are isolated.
- [ ] P0.5 Configure one provider with its own ignored development home.
- [ ] P0.6 Complete one disposable provider turn, diff inspection, and terminal session.
- [ ] P0.7 Confirm another installed coding-agent client and the normal provider homes are unchanged.

Exit condition: the existing foundation works in an isolated web-only development run.

### P1 — Product identity

- [x] P1.1 Choose product name, slug, URL schemes, application IDs, CLI name, and data-home name.
- [x] P1.2 Consolidate shared product identity constants.
- [x] P1.3 Change server default storage paths.
- [x] P1.4 Change Electron profile, bundle/application identity, protocols, and desktop entries.
- [ ] P1.5 Change artifact names, icons, and visible branding.
- [x] P1.6 Disable upstream updater, cloud configuration, and telemetry defaults.
- [x] P1.7 Add/update focused identity and path tests.
- [ ] P1.8 Run desktop beside another installed coding-agent client and verify isolation.
- [x] P1.9 Move every internal workspace package to the `@vetra-code/*` scope.

Exit condition: Vetra Code cannot be mistaken for or share mutable runtime identity with another product.

### P2 — Remove unused surfaces

- [x] P2.1 Remove mobile workflows and root scripts.
- [x] P2.2 Remove mobile app and mobile-only tooling/tests/docs.
- [x] P2.3 Remove marketing scripts and app.
- [x] P2.4 Update release smoke checks, CI, workspace docs, and `AGENTS.md`.
- [x] P2.5 Prune dependencies/patches and regenerate the lockfile.
- [x] P2.6 Run focused contracts, client-runtime, web, desktop, and server checks.

Exit condition: install/build/CI no longer expect mobile or marketing artifacts.

### P3 — Builder UI slice

- [ ] P3.1 Create the shared three-pane application shell.
- [ ] P3.2 Reuse existing project/thread navigation in the project rail.
- [ ] P3.3 Reuse full existing chat, approval, and composer behavior in the agent pane.
- [ ] P3.4 Add Preview, Code/Files, Diff, and Terminal workbench tabs.
- [ ] P3.5 Add honest environment and development-process status areas.
- [ ] P3.6 Keep Publish disabled/hidden.
- [ ] P3.7 Verify command palette, shortcuts, long lists, and desktop titlebar behavior.

Exit condition: a local provider can build and inspect an application through the new shell without
an orchestration regression.

### P4 — Managed execution proof

- [ ] P4.1 Define the managed workspace lifecycle interface.
- [ ] P4.2 Implement a disposable local-container adapter.
- [ ] P4.3 Build the minimal runtime image.
- [ ] P4.4 Start the existing server and one repository in an isolated persistent volume.
- [ ] P4.5 Prove one provider's hosted authentication and turn execution.
- [ ] P4.6 Route the server through HTTPS/WSS.
- [ ] P4.7 Route one development process through an HTTPS preview gateway.
- [ ] P4.8 Stop/wake with source and thread persistence.
- [ ] P4.9 Delete with exact resource and credential cleanup.
- [ ] P4.10 Record boot time, memory, disk, network, and auth findings.

Exit condition: the end-to-end managed scenario in `06-cloud-execution.md` passes.

### P5 — Managed product integration

- [ ] P5.1 Add the minimal control-plane application and persistence.
- [ ] P5.2 Add managed project creation and lifecycle states.
- [ ] P5.3 Integrate managed connection bootstrap with the connection supervisor.
- [ ] P5.4 Add the hosted iframe preview adapter.
- [ ] P5.5 Add managed provider-authentication onboarding.
- [ ] P5.6 Preserve local environment creation and connections as a separate path.

Exit condition: a user can choose local or managed execution from the same web/desktop product.

## Decisions already made

- Web and desktop are supported; mobile is not.
- The marketing app is not part of this product repository.
- Existing provider subscriptions and provider adapters are core value.
- Custom harnesses are deferred beyond the first milestone.
- Local execution remains supported.
- Managed execution must work without a user's local computer.
- The builder UI retains useful Vetra features instead of becoming a visual-only clone of another
  product.
- The reference image informs the three-pane workspace hierarchy.

## Provisional architecture decisions

These should be validated by the proof before becoming formal ADRs:

- the existing server runs inside each managed workspace;
- one managed workspace serves one project initially;
- the control plane owns lifecycle and metadata, not thread contents;
- Git is the first-release transport between separate local and managed copies;
- the first managed connection reuses bearer pairing over HTTPS/WSS;
- hosted preview uses a gateway and sandboxed iframe;
- the production cloud adapter is not selected before the local isolated proof.

## Required product decisions

The product identity decision is resolved. These remaining choices block parts of P3 or P4:

1. **First hosted provider**: Codex or Claude is recommended for the proof; choose one explicitly.
2. **Initial project source**: empty Git repository, one curated starter, or import from GitHub.
3. **Authentication owner**: product identity provider for the hosted client and control plane.
4. **Project ownership**: personal projects only or organizations from the beginning.
5. **Provider credential policy**: per project or reusable per user, and required deletion behavior.
6. **Cloud proof platform**: local Docker/VM harness first, then candidate production platform.
7. **Preview command**: explicit per project, detected from package metadata, or agent-managed.
8. **Source durability**: platform-owned Git remote, user-owned GitHub repository, or both.
9. **Code surface**: read-only source viewer for the first milestone or a minimal editor.

## Risks to validate early

### Provider subscriptions in hosted compute

Technical login success is not enough. Provider terms, authentication UX, credential refresh,
concurrency, and account security must support the hosted model.

### Previewing untrusted generated code

Project code is untrusted. Compute isolation, egress policy, preview-origin isolation, secret
separation, and resource limits are product requirements, not later hardening.

### Server assumptions about one trusted machine

The current runtime is remote-capable but not a multi-tenant cloud scheduler. Container or VM
isolation should preserve its one-environment assumptions. Any request to put multiple users inside
one server process needs a separate architecture review.

### Desktop identity leakage

Visible rebranding without changing storage paths, schemes, application IDs, updater configuration,
or artifacts can damage or confuse another installed application.

### UI rewrite before cloud proof

A polished shell can conceal missing lifecycle facts. Finish one local UI slice, then prove managed
execution before building dashboards and onboarding around guessed states.

### Duplicated state

Copying thread or orchestration state into the control plane would create synchronization and
authorization problems. Keep it in the execution environment until a measured product requirement
justifies a read model outside it.

## Recommended next action

Complete the two interactive isolation checks (one provider-backed web turn and one side-by-side
desktop run) when browser testing is authorized. In parallel, begin P3 with a UI inventory and the
shared builder shell; the identity and repository cleanup prerequisites are complete.
