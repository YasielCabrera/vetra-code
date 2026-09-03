# Glossary

> For maintainers. Using Vetra Code? See [docs/user](../user/).

This is a living glossary for Vetra Code. It explains what common terms mean in this codebase.

## Table of contents

- [Project and workspace](#project-and-workspace)
- [Thread timeline](#thread-timeline)
- [Orchestration](#orchestration)
- [Provider runtime](#provider-runtime)
- [Checkpointing](#checkpointing)
- [Appearance](#appearance)
- [Powerhouse](#powerhouse)
- [Fork and upstream](#fork-and-upstream)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot` and a title. It does not contain threads: `OrchestrationProject` and `OrchestrationThread` are separate arrays on the read model, and a project can have zero threads. See [workspace-layout.md][2].

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for a thread. If a thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live behind the VCS driver contract in `apps/server/src/vcs/VcsDriver.ts`, implemented by [GitVcsDriverCore.ts][3].

#### Content revision

A deterministic token derived from the exact file bytes a client last confirmed on disk. File-annotation requests carry it so the server can reject stale work before invoking Git, and clients include it in query keys so a confirmed save naturally selects a new result. Live editor buffers keep the saved revision and project annotations locally until persistence confirms the new bytes.

#### Line changes

The `HEAD`-relative added, modified, and removed-line ranges shown in the full-file reader. They describe the working tree, including staged changes, rather than the branch-range diff. Git-backed extraction lives in [GitVcsDriverCore.ts][3]; file-byte verification and non-Git behavior live in `apps/server/src/vcs/FileAnnotationService.ts`.

#### Blame run

A contiguous sequence of rendered lines with the same blame commit. The wire format stores each run as a line count plus a commit-table index, with the start implied by the preceding runs. This keeps whole-file blame compact and makes complete, gap-free coverage a contract invariant.

### Thread timeline

#### Thread

The main durable unit of conversation and workspace history. In [the orchestration contracts][1], a thread holds messages, activities, checkpoints, and session-related state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside a thread. It starts with user input and ends when the session leaves `running` status, which [projector.ts][4] treats as the authoritative completion signal (`settledTurnStateForSessionStatus`). Checkpoint and diff work may settle afterward without changing when the turn ended. See [the contracts][1] and [ProviderRuntimeIngestion.ts][5].

#### Activity

A user-visible log item attached to a thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is `project`, `thread`, or `automation`. See [decider.ts][8].

#### Automation

A prompt paired with a schedule, environment-local like a project. In [the contracts][1] an automation holds its prompt, an `AutomationSchedule` (a one-time instant, or cron plus an IANA time zone), the project its runs happen in, the provider settings a run starts with, and a `nextRunAt` the decider recomputes on every schedule change and every claim. `AutomationScheduler` fires them; see [AutomationScheduler.ts][25].

#### Run

One firing of an automation, which _is_ a thread — created hidden and attributed to the automation, so the automation record needs no second source of truth for how the work went. A run is claimed before it starts (`automation.run-claimed`) with a command id derived from the automation and the scheduled instant, which is what makes firing exactly-once across a restart.

#### Hidden thread

A thread that exists but is not in the sidebar (`hiddenAt` in [the contracts][1]). Automation runs are born hidden; `thread.reveal` clears the flag and the thread joins the inbox like any other. Deliberately generic — automations are its first user, not its only possible one.

#### Command

A typed request to change domain state. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.checkpoint.revert`.

#### Domain Event

A persisted fact that something already happened. In [the contracts][1], events are the source of truth, and [projector.ts][4] shows how they are applied.
Examples include `thread.created`, `thread.message-sent`, and `thread.turn-diff-completed`.

#### Decider

The pure orchestration logic that turns commands plus current state into events. The core implementation is in [decider.ts][8], with preconditions in [commandInvariants.ts][9].

#### Projection

A read-optimized view derived from events. See [projector.ts][4], [ProjectionPipeline.ts][11], and [ProjectionSnapshotQuery.ts][10].

#### Projector

The logic that applies domain events to the read model or projection tables. See [projector.ts][4] and [ProjectionPipeline.ts][11].

#### Read model

The current materialized view of orchestration state. In [the contracts][1], it holds projects, threads, messages, activities, checkpoints, and session state. See [ProjectionSnapshotQuery.ts][10] and [OrchestrationEngine.ts][7].

#### Reactor

A side-effecting service that handles follow-up work after events or runtime signals. Examples include [CheckpointReactor.ts][6], [ProviderCommandReactor.ts][12], and [ProviderRuntimeIngestion.ts][5].

Not to be confused with a [Powerhouse reactor](#powerhouse-reactor), which is an unrelated thing owned by a different project.

#### Receipt

A typed signal emitted when an async milestone completes, such as `checkpoint.baseline.captured`, `checkpoint.diff.finalized`, or `turn.processing.quiesced`. Receipts are a test-only mechanism: the production `RuntimeReceiptBusLive` publish is a no-op and only the test layer is PubSub-backed. Do not build production behavior on them. See [RuntimeReceiptBus.ts][13] and [CheckpointReactor.ts][6].

#### Quiesced

"Quiesced" means a turn has gone quiet and stable: follow-up work such as [CheckpointReactor.ts][6] has settled. It appears in [the receipt schema][13], so in practice it is something tests wait on rather than a production signal.

### Provider runtime

The live backend agent implementation and its event stream. The main service is [ProviderService.ts][14], the adapter contract is [ProviderAdapter.ts][15], and the overview is in [providers.md][16].

#### Provider

The backend agent runtime that actually performs work. Six drivers ship built in: Codex, Claude, Cursor, Grok, OpenCode, and Antigravity. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17] as a representative adapter.

#### Session

The live provider-backed runtime attached to a thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Runtime mode

The safety/access mode for a thread or session. [The contracts][1] define four values: `approval-required`, `auto-accept-edits`, `auto`, and `full-access`. See [permission modes][18].

#### Interaction mode

The agent interaction style for a thread. In [the contracts][1], the values are `default` and `plan`.

#### Assistant delivery mode

Controls how assistant text reaches the thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` accumulates text. Buffered delivery is not held until the turn completes: it spills once accumulated text would exceed 24,000 characters, and flushes at approval and user-input boundaries. See [ProviderRuntimeIngestion.ts][5].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

#### Model manifest

The per-driver list of current model slugs that decides which models land in the model picker's legacy section. Bundled at `apps/server/src/provider/model-manifest.json` and refreshed at runtime from the same file on `main`, so classification updates ship as commits instead of releases. See the [provider architecture][16] model manifest section.

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of a thread workspace at a particular turn. In practice it is a hidden Git ref in [CheckpointStore.ts][19] plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed in [Utils.ts][22], and used by [CheckpointStore.ts][19].

#### Checkpoint baseline

The starting checkpoint for diffing a thread timeline. This flow is surfaced through [RuntimeReceiptBus.ts][13], coordinated in [CheckpointReactor.ts][6], and supported by [Utils.ts][22].

#### Checkpoint diff

The patch difference between two checkpoints. Query logic lives in [CheckpointDiffQuery.ts][20], diff parsing lives in [Diffs.ts][23], and finalization is coordinated by [CheckpointReactor.ts][6].

#### Turn diff

The file patch and changed-file summary for one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into thread state by [projector.ts][4].

### Appearance

#### Environment theme

A theme an environment's machine publishes for clients to follow, one file per theme under `themes/` in that environment's state directory; the filename is the theme id. [environmentTheme.ts][29] watches the directory and streams the set over `subscribeServerConfig`; clients render each as a library card, generating a full palette when the file carries seed colors and using the palette directly when it is a standard exported theme file. A desktop that retints its apps when the system theme changes rewrites its file, so Vetra Code follows along without a restart. See [environment-theme.md][30].

#### Default theme

The environment's theme, held in its `settings.json` as `defaultTheme` (with `defaultThemeSetAt`
as the set-generation) and set with `vetra theme set <id>`. Web and desktop clients apply each set
once — live when connected, on the next connect otherwise — so setting it switches them, while a
theme a user picks in Settings afterwards sticks until the next set; mobile keeps its own
appearance settings. Naming a published [environment theme](#environment-theme) is how a desktop
ships Vetra Code already matching it.

### Powerhouse

Powerhouse is a separate open-source project. Vetra Code ships a read-only panel for its projects; see [powerhouse-panel.md](./powerhouse-panel.md).

#### Powerhouse reactor

Powerhouse's document server, also called a switchboard. It stores documents, serves them over GraphQL, and is what the panel's Explorer mode reads. It has nothing to do with a Vetra Code [reactor](#reactor).

#### Document model

A Powerhouse document type, declared on disk as `<documentModelsDir>/<name>/<name>.json`. It holds GraphQL schemas for the document's state and one input schema per operation. Versions are repeated entries in the file's `specifications` array rather than separate files.

#### Powerhouse drive

A container document in a reactor, identified by its document type rather than by a dedicated API. The reactor has no query that lists drives; they are found by searching for documents of the drive container types.

#### Powerhouse reference

The text a dragged Powerhouse panel row leaves in the chat composer. A model row leaves an ordinary file mention of the model's directory. A reactor row, having no path to link, leaves `` `powerhouse:<drive|folder|doc>/<id>` `` followed by the name, type, containing path, and reactor URL that let an agent fetch it. The composer renders one as a chip named after the item; the full text is what reaches the agent.

#### Vetra (Powerhouse)

Powerhouse's own brand for its authoring toolchain — the `@powerhousedao/vetra` package and the `ph vetra` command. Unrelated to Vetra Code. Nothing in our Powerhouse surface uses the name.

### Fork and upstream

#### Upstream

The original Vetra Code repository, [pingdotgg/t3code](https://github.com/pingdotgg/t3code), configured as Git remote `upstream`. Local `main` is a mirror of `upstream/main`. Product work does not land on `main`. See [upstream-sync.md][26].

#### Fork identity

The Vetra-owned names that must survive every upstream merge: product name, `@vetra-code/*` packages, `VETRA_*` env vars, `~/.vetra-code`, `vetra://`, desktop application IDs, and `vetra.json`. They are centralized in [productIdentity.ts][27]. A raw merge from upstream reintroduces `t3*` names; [sync-upstream.sh][28] rewrites them mechanically, then a human review keeps auth, analytics, and auto-update from talking to T3.

## Practical Shortcuts

- If you see `requested`, think "intent recorded".
- If you see `completed`, think "result applied".
- If you see `receipt`, think "async milestone signal, for tests".
- If you see `checkpoint`, think "workspace snapshot for diff/restore".
- If you see `quiesced`, think "all relevant follow-up work has gone idle".
- If you see `upstream`, think "pingdotgg/t3code, merged through the sync script, not a raw merge".

## Related Docs

- [Architecture overview][24]
- [Provider architecture][16]
- [Permission modes][18]
- [Workspace layout][2]
- [Syncing upstream Vetra Code][26]

[1]: ../../packages/contracts/src/orchestration.ts
[2]: ./workspace-layout.md
[3]: ../../apps/server/src/vcs/GitVcsDriverCore.ts
[4]: ../../apps/server/src/orchestration/projector.ts
[5]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[6]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[7]: ../../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[8]: ../../apps/server/src/orchestration/decider.ts
[9]: ../../apps/server/src/orchestration/commandInvariants.ts
[10]: ../../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
[11]: ../../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[12]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[13]: ../../apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
[14]: ../../apps/server/src/provider/Layers/ProviderService.ts
[15]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[16]: ./providers.md
[17]: ../../apps/server/src/provider/Layers/CodexAdapter.ts
[18]: ../user/permission-modes.md
[19]: ../../apps/server/src/checkpointing/CheckpointStore.ts
[20]: ../../apps/server/src/checkpointing/CheckpointDiffQuery.ts
[21]: ../../apps/server/src/persistence/Services/ProjectionCheckpoints.ts
[22]: ../../apps/server/src/checkpointing/Utils.ts
[23]: ../../apps/server/src/checkpointing/Diffs.ts
[24]: ./overview.md
[25]: ../../apps/server/src/automation/Layers/AutomationScheduler.ts
[26]: ./upstream-sync.md
[27]: ../../packages/shared/src/productIdentity.ts
[28]: ../../scripts/sync-upstream.sh
[29]: ../../apps/server/src/environmentTheme.ts
[30]: ../user/environment-theme.md
