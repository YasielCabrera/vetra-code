# Automations (scheduled tasks)

Status: planned, not started. Do not implement until asked.

A sidebar entry between **Search** and **Projects** opening `/automations`: a page where a user
writes a prompt, picks when it runs, and Vetra runs it unattended — once, or on a repeating
schedule. Each firing produces its own thread. Those threads stay out of the sidebar until the user
promotes one.

## Vocabulary

Additions for `docs/internals/glossary.md`:

- **automation** — an environment-local record pairing a prompt with a schedule, a project, and the
  provider settings a run starts with.
- **run** — one firing of an automation. A run *is* a thread, created hidden.
- **owned project** — the project an automation creates for itself under Vetra home when the user
  did not pick one.

Reusing `thread`, `project`, `turn`, and `environment` as they already mean.

## Decisions

Confirmed with the developer before planning:

| Question | Decision |
| --- | --- |
| What a firing produces | A new thread per run |
| Project for a project-less automation | One folder + project per automation, under Vetra home |
| Run isolation | Support worktree-per-run (requires extracting the turn-start bootstrap) |
| Missed runs (machine asleep) | Recurring: skip to next occurrence, record it. One-time: still fire if ≤24h late |

Architecture decisions made during investigation, with the alternatives rejected:

**Automations are a new event-sourced aggregate (`automation`), not a settings key.**
`OrchestrationAggregateKind` gains `"automation"`; `aggregate_kind` is plain `TEXT` with no CHECK
constraint (`Migrations/001_OrchestrationEvents.ts`), so no event-store migration. The decisive
reason is not consistency: it is that `OrchestrationEngine` deduplicates by `commandId` against a
durable receipt table (`Layers/OrchestrationEngine.ts:138`). A firing dispatched with a
deterministic command id (`automation-run:<automationId>:<scheduledForIso>`) is therefore
exactly-once **across a crash or restart** — the one property a scheduler must not get wrong.
Storing automations in `settings.json` would have been cheaper but buys no firing idempotency and
mixes server config with orchestration state.

**Automations ride the shell snapshot.** `OrchestrationShellSnapshot` gains
`automations: Array<OrchestrationAutomation>`, with `automation-upserted` / `automation-removed`
stream events. The shell is already the cached, sequence-resumable, multi-environment-merged
projection the chrome renders from; automations are a few tiny rows. The alternative — a dedicated
snapshot RPC in the shape of `getArchivedShellSnapshot` — would duplicate the resume and cache
logic and would not live-update without more code.

**Mutations need no new RPC.** Everything goes through `orchestration.dispatchCommand`, exactly as
`thread.snooze` and friends do (`packages/client-runtime/src/operations/commands.ts`).

**Hidden-from-sidebar is a generic thread state, not an automation special case.** A nullable
`hiddenAt` on the thread with `thread.hide` / `thread.reveal` commands. The sidebar filters on
`hiddenAt === null`; automation provenance (`automationId`) stays immutable so promoting a run to
the sidebar does not erase which automation produced it. Symmetric in both directions, per the
reverse-states rule.

**`effect/Cron` computes the next run.** `Cron.parse(expr, timeZone)` + `Cron.next(cron, now)` are
pure, IANA-timezone-aware, and DST-correct, and already ship in the Effect core the repo depends on
(`.repos/effect-smol/packages/effect/src/Cron.ts:551,741`). No new dependency, and the decider can
compute `nextRunAt` without doing I/O.

**The scheduler ignores `BackgroundPolicy`.** That service gates *opportunistic* polling on client
demand and host power (`background/BackgroundPolicy.ts`). A scheduled run is demand-independent
work, like a turn already in flight: it must fire with no client connected. Worth a comment at the
call site so nobody "fixes" it later.

## Contracts

New `packages/contracts/src/automation.ts`, exported from `index.ts`. `AutomationId` joins the other
branded ids in `baseSchemas.ts`.

```
AutomationSchedule =
  | { kind: "once";      runAt: IsoDateTime }
  | { kind: "recurring"; cron: TrimmedNonEmptyString; timeZone: TrimmedNonEmptyString }

AutomationLastRun = {
  scheduledFor: IsoDateTime
  startedAt: IsoDateTime | null
  threadId: ThreadId | null
  outcome: "claimed" | "started" | "skipped-overlap" | "missed"
  detail: string | null
}

OrchestrationAutomation = {
  id, title, prompt, schedule
  projectId: ProjectId
  ownsProject: boolean
  modelSelection, runtimeMode, interactionMode
  envMode: ThreadEnvMode
  startFromOrigin: boolean
  enabled: boolean
  nextRunAt: IsoDateTime | null
  lastRun: AutomationLastRun | null
  createdAt, updatedAt, deletedAt
}
```

`nextRunAt` is derived state that is nonetheless persisted: it is the scheduler's indexed queue key,
and recomputing cron in every reader would be the kind of duplicated rule that drifts. The decider
recomputes it on every schedule change and every claim.

Commands (all client-dispatchable; the internal/client split follows
`DispatchableClientOrchestrationCommand`):

- `automation.create`
- `automation.meta.update` — title, prompt, schedule, model, modes, env mode
- `automation.enable` / `automation.disable` — pause and resume
- `automation.delete` — `force` required when revealed run threads exist; cascades to
  `project.delete({force: true})` when `ownsProject`, reusing `decideCommandSequence` exactly as
  `project.delete` cascades to `thread.delete` (`decider.ts:301`)
- `automation.run.claim` — `{automationId, scheduledFor, reason: "schedule" | "manual" | "missed"}`

Events: `automation.created`, `automation.meta-updated`, `automation.enabled`,
`automation.disabled`, `automation.deleted`, `automation.run-claimed`, `automation.run-skipped`.

Two new optional fields on the thread schemas (`OrchestrationThread`, `OrchestrationThreadShell`,
and their `ProjectionThread` twin):

- `automationId: AutomationId | null` — provenance
- `hiddenAt: IsoDateTime | null` — out of the sidebar

One on the project schemas (`OrchestrationProject`, `OrchestrationProjectShell`):

- `automationId: AutomationId | null` — set on an owned project, which listings then filter out

`ThreadCreateCommand` and `ThreadTurnStartBootstrapCreateThread` gain optional `automationId` and
`hidden`, so a run's thread is born hidden. Dispatching `thread.hide` after the fact would flash the
row into every connected sidebar for a frame first.

New commands: `thread.hide` / `thread.reveal`, events `thread.hidden` / `thread.revealed`.

Capability flag `automations` on `ExecutionEnvironmentCapabilities`
(`packages/contracts/src/environment.ts:48`), set true in `environment/ServerEnvironment.ts:143`,
read client-side via a `readEnvironmentSupportsAutomations` next to its siblings in
`apps/web/src/state/entities.ts:228`. Every new schema field is `optionalKey` / has a decoding
default, so an older server's payloads still decode.

## How a run fires

`AutomationScheduler`, a reactor in the shape of `ThreadDeletionReactor` (a `Services/` interface
plus a `Layers/` live implementation, a `DrainableWorker`, started under the `reactors.start` phase
in `serverRuntimeStartup.ts:350` via `forkParked`).

1. **Wait.** Sleep until `min(earliest nextRunAt, now + 60s)`, interruptibly. The 60s cap makes the
   loop robust to suspend, clock jumps, and DST without a tight tick; the fiber is re-armed early
   when the domain event stream carries an `automation.*` event.
2. **Claim.** For each due automation, dispatch `automation.run.claim` with command id
   `automation-run:<automationId>:<scheduledForIso>`. The decider decides the outcome, so the
   policy lives in a pure function with tests:
   - disabled, or a previous run still active → `automation.run-skipped`
   - `scheduledFor` far in the past → `automation.run-skipped(missed)` for recurring;
     still claims for `once` within 24h
   - otherwise `automation.run-claimed`, carrying the `threadId` the run will use
   In all three cases the event advances `nextRunAt` to `Cron.next(cron, now)`, which collapses a
   long backlog into one step — a week of missed runs cannot dogpile.
3. **Run.** The reactor dispatches `thread.turn.start` with `bootstrap.createThread` (and
   `prepareWorktree` when `envMode === "worktree"`), command id
   `automation-turn:<automationId>:<scheduledForIso>`, `hidden: true`, `automationId` set, title =
   the automation's title. Receipt dedup makes a retry a no-op.
4. **Recover.** On startup, any `run-claimed` with no thread is resumed; step 3 is idempotent, so a
   crash between claim and turn start costs nothing.

An automation's own project is created lazily on first save: `mkdir <stateDir>/automations/<id>` and
`project.create` with `createWorkspaceRootIfMissing: true`, which the Normalizer already honors
(`orchestration/Normalizer.ts:87`). `stateDir` comes from `deriveServerPaths` (`config.ts:106`);
`ensureServerDirectories` gains the `automations` directory.

**Unattended runs need `runtimeMode: "full-access"`** or they park on the first approval request
forever. That is the form's default, and the page surfaces a run blocked on approval or input
rather than letting it look like it is working.

## Phases

Each phase is independently reviewable. One concern per PR.

**0 — Contracts.** `AutomationId`, `automation.ts`, aggregate kind, capability flag, the new thread
and project fields, `thread.hide`/`thread.reveal`. Schema decode tests including
payloads from an older server. No behavior.

**1 — Persistence and the read model.** Migration `041` (a `projection_automations` table, indexed
on `(deleted_at, enabled, next_run_at)`; `automation_id` + `hidden_at` columns on
`projection_threads`; `automation_id` on `projection_projects` — all `ALTER TABLE ... ADD COLUMN`
guarded the way `023_ProjectionThreadShellSummary.ts` guards its own). A `ProjectionAutomations`
repository, decider cases, projector cases, `ProjectionSnapshotQuery` reads (list, due-set, by id),
`automations` on the shell snapshot, `automation-upserted`/`-removed` in the shell stream and its
coalescing in `ws.ts:544`. Server holds automations; nothing runs them yet.

**2 — Extract the turn-start bootstrap.** `dispatchBootstrapTurnStart` currently lives inside the
per-connection closure in `ws.ts:755`, so nothing without a websocket can create a thread with a
worktree. Move it to a `ThreadTurnBootstrap` service carrying the same dependencies
(orchestration engine, git workflow, setup-script runner, git-status refresh); `ws.ts` delegates.
Pure refactor, no behavior change — the risk is that this is the hottest path in the app, and the
mitigation is that `server.test.ts` already covers it heavily.

**3 — The scheduler.** `automation/Services/AutomationScheduler.ts` +
`automation/Layers/AutomationScheduler.ts`, wired in `server.ts` and started in
`serverRuntimeStartup.ts`. Tests drive `TestClock` and wait on receipts and worker drains, never
sleeps.

**4 — Hidden threads, everywhere.** `hiddenAt` filters at `Sidebar.tsx:1920`, in the command
palette's thread list, in `searchThreads` (excluded by default, with a flag), and in the project
thread counts in `projects/projectsList.logic.ts`. Owned projects filtered out of
`sidebarProjectGrouping.ts` and `hooks/useProjectGroups.ts`. Thread jump/traversal reads the
sidebar's own lists, so it follows for free — with a test that says so.

**5 — Client state.** `client-runtime` automation commands and atoms, shell reducer cases for the
new stream items (`state/shellReducer.ts`), web-side `state/automations.ts` and hooks.

**6 — UI.** The sidebar entry (a `SidebarMenuButton` with `CalendarClockIcon` between the search row
and the Projects row at `Sidebar.tsx:3337`), routes `automations.index.tsx` and
`automations.$automationId.tsx`, an `AutomationsPage` modeled on `ProjectsPage.tsx` (search, New
automation, rows carrying schedule / next run / last outcome / project / environment, empty state,
cold-start ghost), a detail page with the schedule picker, project picker, model and permission
pickers reused from the composer, enable toggle, Run now, Delete, and the run history list whose row
menu offers **Show in sidebar**. Palette entries: "Open automations", "New automation". Pure logic
(`automationsList.logic.ts`) holds the row models, search matching, the human schedule label
("Weekdays at 8:00 AM"), and the cron ↔ picker conversion — the reverse direction returns null for
an unrecognized expression, and the form then shows the raw cron field.

**7 — Docs and starter templates.** `docs/user/automations.md` in shipped-product voice, linked from
`docs/README.md`; glossary entries; a short internals note on the scheduler. Optionally the starter
gallery from the reference screenshot (Daily briefing, Inbox triage, Weekly review …) as prefilled
prompts below a dashed divider — a pure UI addition once the model exists.

## Surface checklist

Per AGENTS.md, which entries apply:

- **Entry points** — sidebar row, command palette, and the automation detail page's Run now. A
  keybinding is deliberately not added.
- **Clients** — web and desktop share the renderer, so both follow. No mobile client in this repo.
- **Providers** — provider-neutral: a run is an ordinary turn. Nothing per-adapter.
- **Contracts** — everything crossing the wire is in phase 0.
- **Reverse states** — enable/disable, hide/reveal, delete; a missed run offers Run now. No one-way
  doors.
- **Connection modes** — automations are environment-local and fire on the environment's own
  server, so a remote environment keeps running when this client is closed and a laptop-hosted one
  does not. The page names the holding environment, as the Projects page does.
- **Docs** — phase 7.

## Open questions and risks

- **Deleting an automation that owns its project.** Recommended: delete the automation, soft-delete
  the owned project, cascade-delete its hidden run threads, leave the folder on disk, and require
  `force` when any run was revealed — the UI confirm names the counts. Worth a second look before
  phase 1, because it is the one place the model can strand a revealed thread under a deleted
  project.
- **Run history depth.** History is "the threads with this automationId", which is free and
  truthful, but skipped and missed runs have no thread and so appear only as the automation's
  `lastRun`. A full run-history projection is a follow-up if the shallow version proves annoying.
- **Cost.** Unattended runs spend subscription quota. They surface on the Usage page like any turn;
  auto-pausing an automation after N consecutive failures is a deliberate follow-up, and needs a
  run-finished event this plan does not add.
- **Prompt size.** Cap the prompt well under `PROVIDER_SEND_TURN_MAX_INPUT_CHARS` (120k).
- **Notifications.** There is no OS-notification path in the repo today, only the mobile awareness
  relay. A finished run is visible in the automations page and (once revealed) the sidebar. Out of
  scope.
