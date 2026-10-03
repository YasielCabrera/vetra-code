# Syncing upstream T3 Code

> For maintainers. Using Vetra Code? See [docs/user](../user/).

Vetra Code is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code). We keep that
repository as Git remote `upstream` so we can take bugfixes and new execution-runtime features
without giving up Vetra identity, and without talking to T3 cloud, auth, analytics, or update
infrastructure.

This is a recurring process. Do not raw-merge `upstream/main`. Use
[`scripts/sync-upstream.sh`](../../scripts/sync-upstream.sh), then complete the human review in this
doc. The script is mechanical. The review is the rest of the job.

## Why a script exists

The fork deleted whole trees (mobile, marketing, inherited release automation) and renames a small
set of product identity strings. A plain `git merge` therefore:

- restores deleted apps and workflows;
- reintroduces `T3 Code`, `T3CODE_*`, `t3.json`, `com.t3tools.*` application ids, and the other
  identity spellings mapped below;
- can re-enable Clerk, relay, PostHog, and desktop auto-update against Vetra-owned destinations.

The script merges, prunes the trees we deleted on purpose, and re-applies that rename to files the
merge actually changed. Anything it cannot decide is left as a real conflict.

What the script deliberately does **not** rename is everything else. Workspace packages, import
paths, internal symbols, file paths, and scratch directories all keep upstream's `t3*` names. That
is why roughly half the files this fork touches are byte-identical to upstream and can never
conflict. Renaming one of them back is the easiest way to make every future sync expensive again:
the fork once carried the `@vetra-code/*` scope, and import lines alone accounted for about half of
all merge conflicts.

## Git layout

| Ref             | Role                                                                                                |
| --------------- | --------------------------------------------------------------------------------------------------- |
| `upstream`      | `https://github.com/pingdotgg/t3code.git`. Fetch-only source of T3 Code.                            |
| `upstream/main` | The T3 Code default branch we sync from. It is the only mirror of upstream; there is no local copy. |
| `main`          | The Vetra product branch. Merge upstream _into this branch_; feature branches start and land here.  |
| `origin`        | `YasielCabrera/vetra-code`, private. `main` pushes here and tracks `origin/main`, never `upstream`. |

Confirm remotes before the first sync on a machine:

```bash
git remote -v
```

If `upstream` is missing:

```bash
git remote add upstream https://github.com/pingdotgg/t3code.git
git fetch upstream --prune --tags
```

Run the sync on `main`.

## What we take, drop, and keep disabled

### Take

Upstream changes to the execution runtime we still run:

- provider adapters and orchestration;
- checkpoints, Git, files, terminal, preview;
- typed contracts and client-runtime behavior;
- bugfixes and features in `apps/server`, `apps/web`, `apps/desktop`, and `packages/*` that are not
  T3-product-specific.

After the merge, those changes must appear under Vetra names (`Vetra Code`, `@t3tools/*`,
`VETRA_*`, `vetra.json`, `~/.vetra-code`, `vetra://`, and so on).

### Drop

Surfaces this fork deleted and will not ship:

| Path                                                                         | Why                               |
| ---------------------------------------------------------------------------- | --------------------------------- |
| `.agents/skills/test-t3-mobile/`                                             | Mobile-only testing skill.        |
| `.github/ISSUE_TEMPLATE/via-triage.yml`, `.github/triage/`                   | Vetra-owned support workflow.     |
| `.agents/skills/contribution-triage/`, `.github/TRIAGE_EXEMPTIONS.td`        | Vetra-owned PR moderation.        |
| `apps/mobile/`                                                               | Mobile client removed.            |
| `apps/marketing/`                                                            | Marketing site removed.           |
| `apps/server/src/cli/triage*`                                                | Files issues in T3's repo.        |
| `scripts/mobile-showcase*` and `scripts/mobile-native-static-check*`         | Mobile-only tooling.              |
| `t3.json`                                                                    | Replaced by `vetra.json`.         |
| `docs/user/mobile-*`, `docs/operations/android-notifications.md`             | Mobile-only guidance.             |
| `docs/operations/connect-setup.md`                                           | Written for T3's Clerk and relay. |
| `patches/*react-navigation*`, `patches/*react-native*`, and `patches/*expo*` | Mobile dependency patches.        |

The script's `PRUNE_PATHS` / `PRUNE_GLOBS` lists are the source of truth for the mechanical drop.
If upstream adds a new file inside those trees, the prune pass deletes it again. If upstream adds a
_new_ tree we also do not want (for example another mobile workflow outside those paths), extend the
lists rather than deleting by hand every sync.

### Keep disabled until Vetra owns the destination

Auth, cloud, analytics, and auto-update code may still exist in the tree. That is fine. Runtime
must not send users, tokens, or events to T3 until we configure Vetra-owned replacements.

| Concern                     | Vetra policy                                                                  | How it is gated today                                                                                                                                                                                                                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clerk / hosted auth         | Off until we have our own Clerk application and OAuth callbacks.              | Cloud UI and Clerk providers stay dark unless Clerk + relay public config is present. Do not copy T3 keys into `.env` / `.env.local`.                                                                                                                                                         |
| Vetra Connect / relay       | Off until we have our own relay and hosted app.                               | `hasCloudPublicConfig` requires a publishable key, JWT template, and HTTPS relay URL. Absent config hides connect UI.                                                                                                                                                                         |
| Hosted app URL              | Must not fall back to `app.t3.codes`.                                         | [`packages/shared/src/productIdentity.ts`](../../packages/shared/src/productIdentity.ts) sets `PRODUCT_DEFAULT_HOSTED_APP_URL` to `https://app.vetra.invalid`.                                                                                                                                |
| Desktop auto-update         | Off until we own signing and a release repository.                            | Disabled unless `VETRA_ENABLE_AUTO_UPDATE=true`. The desktop build does not infer the current GitHub repo as an updater feed.                                                                                                                                                                 |
| Product analytics (PostHog) | Off until we own a PostHog project. Do not ship the inherited T3 project key. | `VETRA_TELEMETRY_ENABLED` defaults to false and `VETRA_POSTHOG_KEY` has no default; a blank key is treated as disabled, so opting in without your own project sends nothing. Upstream defaults the other way, so a merge touching `AnalyticsService` is a required review item every sync.    |
| Model manifest refresh      | Off until we host a manifest. Upstream fetches its own repository on `main`.  | `ModelManifest` reads its bundled `model-manifest.json` and only fetches when `VETRA_MODEL_MANIFEST_URL` is set; a blank URL skips the network entirely. Upstream hardcodes `raw.githubusercontent.com/pingdotgg/t3code`, so a merge touching `ModelManifest.ts` is a review item every sync. |
| OTLP / Grafana              | Optional, and only to endpoints we own.                                       | Unset by default. See [observability](../operations/observability.md).                                                                                                                                                                                                                        |
| Release / relay-deploy CI   | Absent until we own every publish target.                                     | `.github/workflows/release.yml` and `deploy-relay.yml` were deleted. Upstream still has them. The script does **not** prune `.github/workflows`.                                                                                                                                              |

Canonical disable-list for publishing is [Release bootstrap status](../operations/release.md).
Identity constants live in [`packages/shared/src/productIdentity.ts`](../../packages/shared/src/productIdentity.ts).
Optional cloud/update env vars are documented in [`.env.example`](../../.env.example); that file
must stay commented and must never contain T3 production identifiers.

## What the script does

```bash
scripts/sync-upstream.sh                 # default: upstream/main
scripts/sync-upstream.sh upstream/main   # or another fetched ref
```

It will:

1. Exit if the working tree is dirty. Commit or stash first.
2. `git fetch upstream --prune --tags`.
3. `git merge --no-commit --no-ff <ref>` into the current branch. Merge conflicts do not abort the
   rest of the script (`|| true` after merge).
4. `git rm` the prune paths and globs above, including files upstream newly added inside them.
5. Walk files this merge changed (`ACMR` vs `HEAD`). For text files that still contain `t3` / `T3`,
   apply the ordered `RENAMES` table in the script. The table holds product identity only:
   `t3.codes` domains are absent on purpose, and so are package names, import paths, and internal
   symbols.
6. Stage rewritten files that merged cleanly. Leave conflicted files unstaged: staging one would
   mark it resolved with conflict markers still inside.
7. Print remaining unmerged paths, then two greps: T3 identity that should have been renamed, and
   `@vetra-code/` names that escaped outside the published-package surface. Noisy hits in
   `.repos/`, lockfiles, and the script itself are excluded from both.

The merge commit message is already prepared. The script does **not** commit.

## What the script does not do

These are the recurring human (or follow-up) steps. Skipping them is how T3 identity and T3
backends leak back in.

- Resolve conflicts. Semantic choices stay with the reviewer.
- Rename identity that is not in `RENAMES`. A new upstream application id, URL scheme, cookie, or
  persisted key survives until someone adds a pair. An ordinary new `T3SomethingNew` symbol needs
  no pair: internal names are meant to stay upstream's.
- Rename **files**. The rewrite pass edits contents, not paths. This rarely matters now that the
  fork keeps upstream's paths — an incoming `T3ConnectUserProfilePage.tsx` lands where it belongs.
  It matters only for the few paths that carry identity, such as brand assets under `assets/`.
- Rewrite `t3.codes` / `t3.gg` URLs. Expected in comments, licenses, and tests that mention
  upstream. Not acceptable as a runtime default, Clerk host, relay, updater feed, or analytics
  destination.
- Rewrite generic `t3.` prefixes. A blanket `t3.` → `vetra.` pair would smash `t3.codes`. Persistence
  keys such as `t3.pullRequests.list` therefore survive until a specific `RENAMES` pair exists or
  you fix them by hand. Search `` `t3. `` / `"t3.` in code (not docs) after every sync.
- Renumber an incoming migration. This fork inserted `041_ProjectionAutomations`, so every upstream
  migration after it collides one number low (upstream's `055_OrchestrationV2` is our `056`). Take
  the incoming file, `git mv` it past our highest number, and shift the `toMigrationInclusive`
  boundaries in its test, and in any test that imports migrations by file name, by the same offset —
  the migration test asserts on the schema _before_ and _after_ its own migration, so a stale
  boundary fails with a missing table rather than a wrong number. Do not add fork migrations to the
  ledger: fork-owned tables such as `automation_runs` are created by their service outside the
  migrator (see [legacy orchestration migration](./legacy-orchestration-migration.md)).
- Keep Automations on upstream's scheduled tasks. The Automations page is a second editor for
  `ScheduledTaskService`; the only fork backend is run tracking in
  [AutomationRuns](../../apps/server/src/automation/AutomationRuns.ts), which wraps
  `ThreadLaunchService` for the scheduler alone to hide each run and give it a stable thread id. If
  upstream changes how the scheduler launches threads (another service, a `threadId` it picks
  itself), runs stop being tracked and flood the sidebar — re-point the wrapper rather than patch
  `ScheduledTaskService`.
- Prune GitHub workflows. Upstream still has `release.yml`, `deploy-relay.yml`, and the
  `mobile-*.yml` workflows. A merge can restore them or conflict on the deletion. Delete them again
  if they return.
- Keep telemetry defaults off. This fork defaults `VETRA_TELEMETRY_ENABLED` to false and ships no
  PostHog project key; upstream defaults to enabled with its own key, so a merge that touches
  `AnalyticsService` will try to restore both. Revert those hunks rather than re-deriving the policy,
  and let the "sends nothing" tests confirm it.
- Protect [`productIdentity.ts`](../../packages/shared/src/productIdentity.ts) as a concept. Upstream
  has no such file today; if it grows one, the merge will not know our constants are sacred.
- Run `pnpm install`, typecheck, or tests.
- Review lockfile, `package.json` workspace members, or root scripts that mention `mobile` /
  `marketing`.
- Touch binaries. The rename pass skips non-text files.

If a miss is mechanical (same string, many files), extend `RENAMES` and re-run the leftover grep.
Do not hand-edit a hundred occurrences of a new pattern.

## Run a sync

Do this on `main`, with no unrelated local changes.

Before fetching, identify the branch and inspect the worktree:

```bash
git status --short --branch
git branch --show-current
```

The script refuses a dirty tree. Treat existing changes as user-owned until you know otherwise:
never discard them to make the sync run. Finish or commit known sync work separately; if the
changes are unrelated and their ownership is unclear, stop and ask before stashing them. A stash
is not part of the sync and must not be left behind silently.

1. **Read what is coming.**

   ```bash
   git fetch upstream --prune --tags
   git log --oneline HEAD..upstream/main
   MB=$(git merge-base HEAD upstream/main)
   git diff --name-only "$MB"..upstream/main
   git merge-base --is-ancestor upstream/main HEAD
   ```

   Use the merge-base two-dot range for the file list. `git diff HEAD..upstream/main` is every
   Vetra-only path plus incoming work (this fork's `re-making-plan/`, `packages/web3`,
   `sync-upstream.sh`, and so on look like upstream deletions). That is the wrong preview.

   Skim for mobile/marketing, release/deploy workflows, Clerk/PostHog/updater, new public
   identifiers, and new `T3*` filenames. That preview is how you know which review items will
   matter.

   The final ancestry command exits successfully when the product branch already contains the
   fetched upstream ref. If it succeeds and the incoming log/file list are empty, there is nothing
   to merge: do not manufacture an empty merge commit. Run only the post-sync audit needed for the
   task.

2. **Run the script.**

   ```bash
   scripts/sync-upstream.sh
   ```

3. **Resolve conflicts.** Prefer Vetra identity and the disable-until-we-own-it policy over
   restoring T3 names or T3 backends. `git add` each resolved file. To abandon the whole attempt:

   ```bash
   git merge --abort
   ```

   Patterns that dominate a typical sync:

   - **Import-only.** The rest of the file already uses the new symbols. Take upstream's import
     block (the script has already rewritten `@t3tools` → `@vetra-code` inside conflicted files).
   - **Fork UI vs upstream UI.** Take the incoming behavior; keep Vetra copy and gates. Example:
     the draft hero. Upstream added a project picker that carries the typed prompt across a repo
     change (`carryComposerContent`). This fork also has a pending-project builder headline.
     Call hooks first, keep the pending-project early return, use the picker when a project is
     already selected, and pass any new props through `ChatView`.
   - **User docs vs bootstrap docs.** `docs/user/remote-access.md` in this fork is bootstrap-status
     (pairing from source, deferred Connect/hosted/SSH). Upstream's file is a shipped-product
     guide (`npx t3 serve`, `https://app.t3.codes`, mobile). Do not take the whole file. Keep our
     framing and extract only new behaviors that exist in our tree, still described as gated.
     Same call as the last sync's `t3-connect.md` drop.

4. **Re-apply prune if workflows or other dropped trees came back.** At minimum:

   ```bash
   git rm -rf --ignore-unmatch \
     .agents/skills/test-t3-mobile \
     .github/workflows/release.yml \
     .github/workflows/deploy-relay.yml \
     .github/workflows/mobile-eas-preview.yml \
     .github/workflows/mobile-eas-production.yml \
     .github/workflows/mobile-fingerprint-check.yml \
     .github/workflows/mobile-showcase-screenshots.yml \
     apps/mobile apps/marketing t3.json \
     'patches/*react-navigation*'
   ```

   If upstream added a new workflow or app we also do not want, delete it and add the path to
   `PRUNE_PATHS` in the script so the next sync is mechanical.

5. **Rebrand leftovers.** Re-run the script's leftover grep, then search for destinations the grep
   does not cover:

   ```bash
   git grep -nIE 't3tools|t3code|T3 Code|T3CODE|T3_|T3[A-Z][a-z]' -- . \
     ':!.repos' ':!*lock*' ':!scripts/sync-upstream.sh' | grep -v 'pingdotgg/' | less

   git grep -nIE 't3\.codes|t3\.gg|T3CODE_|@t3tools' -- . ':!.repos' ':!*lock*'
   ```

   Also search paths and persistence keys the leftover grep does not cover:

   ```bash
   git ls-files | grep -iE 't3connect|T3Connect|^t3[^.]'
   git grep -nIE '`t3\.|"t3\.' -- . ':!.repos' ':!*lock*' ':!docs' ':!scripts/sync-upstream.sh'
   ```

   Acceptable leftovers: the upstream remote URL, copyright/license lines, historical comments,
   and tests that fixture an upstream host on purpose. Unacceptable: runtime product name, package
   scope, env vars, storage paths, URL schemes, application IDs, default hosted/relay/Clerk/PostHog
   /updater endpoints.

   Visible and persistence-bearing names must match
   [`productIdentity.ts`](../../packages/shared/src/productIdentity.ts). Do not add fallback aliases
   that could reconnect this runtime to T3 state (`T3_HOME`, `t3://`, `~/.t3`, and similar).

   **Case-fold fixtures.** Upstream tests often pair `t3code` with `T3Code` because they lower-case
   to the same slug. After rename they become `vetra-code` and `VetraCode` (`vetracode`), which do
   **not** collide. Worktree / repo-identity tests must keep the hyphen in both forms
   (`vetra-code` / `Vetra-Code`). URL-parser tests must expect `toLowerCase()` of the rewritten
   input, not a slug that went through a different `RENAMES` pair. When a test derives repository
   identity from a PR URL, keep the URL's repository path and any `repositoryCloneUrls` fixture key
   identical after rebranding. A mismatch bypasses the fake remote and can surface only as an
   opaque Git exit 128 while the test attempts a real clone.

6. **Enforce the disable policy.** After the merge, confirm all of the following still hold:

   - No T3 Clerk publishable key, JWT template, or OAuth client id in tracked files or `.env.local`.
   - `PRODUCT_DEFAULT_HOSTED_APP_URL` is still `https://app.vetra.invalid` (or a Vetra-owned URL
     once we have one). It must not be `https://app.t3.codes`.
   - Desktop auto-update still defaults off (`VETRA_ENABLE_AUTO_UPDATE` unset/false; no inferred
     T3 GitHub releases repo).
   - Product analytics does not send to T3. This fork now holds both halves of that:
     `VETRA_TELEMETRY_ENABLED` defaults to false **and** `VETRA_POSTHOG_KEY` has no default, with a
     blank key treated as disabled. The inherited default key
     `phc_XOWci4oZP4VvLiEyrFqkFjP4CZn55mjYYBMREK5Wd6m` is T3's project; if a merge restores it or
     flips the flag back on, revert those hunks. The two "sends nothing" cases in
     [`AnalyticsService.test.ts`](../../apps/server/src/telemetry/AnalyticsService.test.ts) fail when
     either default regresses, so run them whenever a sync touches telemetry.
   - `.github/workflows/release.yml` and `deploy-relay.yml` are still absent.
   - Cloud UI still requires explicit Vetra config; `.env.example` stays commented.

7. **Install and verify the scope you changed.**

   ```bash
   pnpm install
   ```

   Then run focused typecheck/tests for packages the merge touched. Do not run the repository-wide
   suite unless a human asked for it. If identity files changed, include the focused identity,
   pairing, telemetry, desktop-update, and public-config tests.

   Repository scripts use Vite Plus (`vp`). If `vp` is not installed globally but dependencies are
   present, invoke the repository-local binary rather than treating the tool as unavailable:

   ```bash
   pnpm exec vp test run path/to/focused.test.ts
   pnpm exec vp run --filter t3 typecheck
   ```

8. **Commit the merge.** The message is already staged from `git merge --no-commit`. Do not squash
   this into a product feature commit; keep it a merge commit so later syncs have a merge base.

9. **Prove the final state.** Record the exact refs in the handoff rather than saying only
   "up to date":

   ```bash
   git merge-base --is-ancestor upstream/main HEAD
   git rev-parse HEAD upstream/main
   git status --short --branch
   ```

   The ancestry check must exit zero, and the status may contain only the changes intentionally
   kept outside the merge. Then `git push` to `origin`.

## Identity map

The script's `RENAMES` table is ordered most-specific first. Keep it that way: later patterns are
substrings of earlier ones. Every pair is product identity — something a user reads, something
persisted, or something that would collide with an installed t3code (see the script for the live
list):

| Upstream                                               | Vetra                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------- |
| `T3 Code` / `T3-Code` / `T3 CODE`                      | `Vetra Code` / `Vetra-Code` / `VETRA CODE`                      |
| `T3 Connect` / `t3-connect/`                           | `Vetra Connect` / `vetra-connect/`                              |
| `T3 Chat` / `t3-chat`                                  | `Vetra Chat` / `vetra-chat`                                     |
| `T3Tools`                                              | `Vetra-Code`                                                    |
| `npx t3 ` / `` `t3 ``                                  | `vetra ` / `` `vetra ``                                         |
| `T3CODE_` / `T3_`                                      | `VETRA_`                                                        |
| `com.t3tools.*` / `/com/t3tools/`                      | `com.vetra.*` / `/com/vetra/`                                   |
| `T3SnapShot` / `snap-shot@t3.codes`                    | `VetraSnapShot` / `snap-shot@vetra.code`                        |
| `x-scheme-handler/t3code` / `t3code://`                | `x-scheme-handler/vetra` / `vetra://`                           |
| `t3code-dev:`                                          | `vetra-dev:`                                                    |
| `t3code.service` / `t3.json`                           | `vetra-code.service` / `vetra.json`                             |
| `t3_session` / `t3_code`                               | `vetra_session` / `vetra_code`                                  |
| `t3-code` (MCP server name, not `t3-codex`)            | `vetra-code`                                                    |
| `T3 thread` / `T3-owned` / `T3 tool`                   | `Vetra Code thread` / `Vetra-owned` / `Vetra Code tool`         |
| `"t3code.` / `"t3code:` / `t3.pullRequests.`           | `"vetra.` / `"vetra:` / `vetra.pullRequests.`                   |
| `.well-known/t3/` / `t3-env:`                          | `.well-known/vetra/` / `vetra-env:`                             |
| `t3-citation` / `t3-context` / `t3-assistant-citation` | `vetra-citation` / `vetra-context` / `vetra-assistant-citation` |
| `.t3-capture-` / `t3-snap-shot-` / `t3-kde-bus-`       | `.vetra-capture-` / `vetra-snap-shot-` / `vetra-kde-bus-`       |
| `t3-relay` / `t3-test`                                 | `vetra-relay` / `vetra-test`                                    |

Names that stay upstream's. Adding any of these to the table would undo the reason merges are
cheap:

| Kind                | Value                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------ |
| Workspace packages  | `@t3tools/*`, `t3` (server), `t3code-relay`, unscoped `effect-acp` and `effect-codex-app-server` |
| Lint plugin         | `oxlint-plugin-t3code`, rules `t3code/*`                                                         |
| Internal symbols    | `t3Home`, `T3ProjectFile*`, `RemoteT3Runner`, `T3Connect*` components, `T3Wordmark`, `allT3`     |
| Effect service keys | `t3/<path>` and `@t3tools/<package>/<path>`, enforced by the `deterministicKeys` diagnostic      |
| Scratch prefixes    | `t3code-*` and `t3-*` mkdtemp names, `t3env_*` test credentials                                  |
| Native crates       | `t3-resource-monitor`, `t3-kde-snap-shot`, `t3-hyprland-snap-shot`                               |
| File paths          | every path upstream also ships, including `T3Wordmark.tsx` and `.agents/skills/test-t3-app`      |

Runtime constants that must not drift, even if a merge conflict "resolves" them back:

| Constant       | Value                                                       |
| -------------- | ----------------------------------------------------------- |
| Product name   | `Vetra Code`                                                |
| npm identity   | `@vetra-code/server`, `@vetra-code/vetra-<platform>-<arch>` |
| CLI            | `vetra`                                                     |
| Home directory | `.vetra-code`                                               |
| Project file   | `vetra.json`                                                |
| Session cookie | `vetra_session`                                             |
| Ports          | production `4873`; dev server `14873`, web `6733`           |
| Desktop IDs    | `com.vetra.code`, `com.vetra.code.dev`                      |
| Launch agent   | `com.vetra.code.service`                                    |
| Protocols      | `vetra://`, `vetra-dev://`                                  |
| Git refs       | `refs/vetra/**` (V1 and V2 checkpoints, pre-refresh)        |
| Env prefix     | `VETRA_*` only. No `T3CODE_*` aliases.                      |

## Conflict patterns that keep coming back

- **Deleted by us, modified by them.** Common for `apps/mobile`, `apps/marketing`, and the inherited
  GitHub workflows. Keep the deletion unless we have explicitly decided to restore that surface.
- **Both edited identity strings.** Take the incoming behavior, keep the Vetra names. If the
  incoming hunk is a new `T3_*` constant, add `VETRA_*` in our tree and a `RENAMES` pair.
- **Lockfile vs deleted workspaces.** After prune, `pnpm install` must regenerate the lockfile so
  it does not reference `@t3tools/mobile` / marketing packages.
- **Clean merge, wrong names.** If the script printed `rewrote N file(s)` but `git diff --cached`
  still shows `T3 Code`, the rewrite was not staged. That was a real bug once; the script now
  stages clean rewrites. If it happens again, stop and fix the script rather than committing.

## Abort and recovery

- Before commit: `git merge --abort`.
- After a bad merge commit that has not been pushed: do not `reset --hard` unless a human
  explicitly asked. Prefer a follow-up commit that restores identity and prune.
- Never rebase, squash, or force-push `main` across a sync merge; later syncs need it as their
  merge base. Never push to `upstream`.

## Related docs

- [Workspace layout](./workspace-layout.md)
- [Scripts](./scripts.md)
- [CI gates](./ci.md)
- [Release bootstrap status](../operations/release.md)
- [Safe first run](../../re-making-plan/03-safe-first-run.md) (why identity isolation exists)
- [Bootstrap progress](../../re-making-plan/08-bootstrap-progress.md)
