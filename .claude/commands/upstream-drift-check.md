---
description: Read-only daily check of how far this fork has drifted from pingdotgg/t3code, and whether to sync now.
allowed-tools: Bash(git fetch:*), Bash(git log:*), Bash(git diff:*), Bash(git merge-base:*), Bash(git merge-tree:*), Bash(git rev-list:*), Bash(git rev-parse:*), Bash(git status:*), Bash(git ls-files:*), Bash(git show:*), Bash(git branch:*), Bash(git remote:*), Bash(git cat-file:*), Bash(comm:*), Bash(sort:*), Bash(uniq:*), Bash(awk:*), Bash(grep:*), Bash(wc:*), Bash(head:*), Bash(sed:*), Read, Grep, Glob
---

# Upstream drift check

You are producing a **daily read-only status report** on how far this fork
(`vetra-code`, product branch `vetra-studio`) has drifted from its upstream,
[`pingdotgg/t3code`](https://github.com/pingdotgg/t3code) (Git remote `upstream`).

Answer two questions, and nothing else:

1. **Is there anything upstream we should bring over?**
2. **Has drift grown enough that we should sync now, before the merge gets heavier?**

Background on the sync itself lives in `docs/internals/upstream-sync.md` and
`scripts/sync-upstream.sh`. Read the doc's **Take / Drop / Keep disabled** section
before classifying commits — it is the authority on what this fork wants. Do not
re-derive that policy from scratch.

## Read-only contract

This command **must not change the repository.** It runs unattended every day,
possibly while a human has work in progress.

**Allowed** — these do not touch the index, working tree, or local branches:

- `git fetch upstream --prune --tags` (updates remote-tracking refs only)
- `git log`, `git diff`, `git show`, `git rev-list`, `git rev-parse`, `git merge-base`,
  `git status`, `git ls-files`, `git cat-file`
- `git merge-tree --write-tree` — writes loose objects to the object database, but
  never a ref, the index, or a file. This is the sanctioned dry-run merge.

**Forbidden** — do not run these, even to "check something":

- `scripts/sync-upstream.sh`
- `git merge`, `git rebase`, `git cherry-pick`, `git revert`, `git merge --abort`
- `git stash` (in either direction — never leave or pop a stash)
- `git checkout`, `git switch`, `git reset`, `git clean`, `git add`, `git rm`, `git commit`
- `git update-ref`, `git branch -f`, any push
- `pnpm install`, builds, typechecks, tests
- Any file write, edit, or creation. **The chat report is your only output.** No
  summary file, no scratch notes, no dated artifact under `docs/` or `.plans/`, no
  temp file — not even one you would delete afterward.
- Shell redirection or piping into a file: no `>`, `>>`, or `tee` anywhere, including
  to `/tmp`. Run each command bare and read its output from the terminal. The `git`
  allowlist covers the _command_, not a redirect appended to it.

A dirty working tree does **not** block this check: every measurement below reads
commits, not the index. Note the dirty state in the report (it blocks a _sync_, not
this _check_) and move on. Never "clean up" to make a command work.

If local `main` lags `upstream/main`, **report it, do not fix it.** Fast-forwarding
the mirror is `sync-upstream.sh`'s job.

## Step 1 — Establish the refs

```bash
git remote -v
git rev-parse --abbrev-ref HEAD
git fetch upstream --prune --tags
MB=$(git merge-base HEAD upstream/main)
git rev-parse HEAD upstream/main main
git rev-list --count HEAD..upstream/main
```

Notes that keep this honest:

- **Only `upstream/main` matters.** The remote carries hundreds of bot branches
  (`codething/*`, `t3bot/*`, `coderabbitai/*`, `agent/*`) and nightly tags
  (`v0.0.34-nightly.*`). Fetch churn in those refs is noise — never report it as drift.
- **Use the merge-base two-dot range for file lists**: `$MB..upstream/main`.
  A plain `git diff HEAD..upstream/main` also lists every Vetra-only path
  (`re-making-plan/`, `packages/web3`, `scripts/sync-upstream.sh`, …) as if upstream
  deleted it. That preview is wrong. Commit lists use `HEAD..upstream/main`, which is
  correct as written.

**Early exit.** If `git rev-list --count HEAD..upstream/main` is `0`, the fork already
contains upstream. Emit the short `UP TO DATE` report (see Output) and stop — do not
manufacture analysis. Still report whether `main` equals `upstream/main`.

## Step 2 — Measure volume

```bash
git log --oneline --no-decorate HEAD..upstream/main
git diff --shortstat "$MB"..upstream/main
git diff --name-only "$MB"..upstream/main | awk -F/ '{if (NF>2) print $1"/"$2; else print $1}' | sort | uniq -c | sort -rn
git log --reverse --format='%ci %h %s' HEAD..upstream/main | head -1
```

Capture: commit count, files changed, insertions/deletions, the ranked area
histogram, and the **date of the oldest unmerged commit** (drift age — the single
best predictor of merge pain).

## Step 3 — Predict merge friction

This is the part that answers "will it get harder if we wait?". Do not skip it or
guess at it.

```bash
git merge-tree --write-tree --name-only HEAD upstream/main
```

Output format: line 1 is a tree OID; subsequent lines up to the first blank line are
**conflicted paths**; after the blank line come informational `Auto-merging` /
`CONFLICT` messages. Exit `0` means a clean merge; exit `1` means conflicts. Read the
exit code — do not infer cleanliness from the absence of the word CONFLICT.

Then measure how _entrenched_ each conflict is. A conflict in a file this fork has
rewritten repeatedly is far more expensive than one in a file we never touched:

```bash
# files both sides changed since the merge base — tomorrow's conflicts, today
comm -12 <(git diff --name-only "$MB"..upstream/main | sort) \
         <(git diff --name-only "$MB"..HEAD | sort)

# fork-side churn for each conflicted / overlapping file
git log --oneline "$MB"..HEAD -- <path> | wc -l
```

Also flag **structurally expensive** incoming changes, which rot faster than ordinary
code and force a lockfile regeneration:

```bash
git diff --name-only "$MB"..upstream/main | grep -E 'pnpm-lock.yaml|package.json|pnpm-workspace.yaml|patches/'
```

## Step 4 — Scan for fork-policy risk

The fork deletes trees, renames identifiers, and keeps T3-owned backends dark. An
incoming change that lands in one of those areas needs a human, regardless of size.

```bash
# trees we deleted on purpose (PRUNE_PATHS in the script)
git diff --name-only "$MB"..upstream/main \
  | grep -E '^(apps/mobile|apps/marketing|t3\.json|scripts/mobile-|patches/.*(react-native|expo))'

# CI we removed and do not want back
git diff --name-only "$MB"..upstream/main \
  | grep -E '^\.github/workflows/(release|deploy-relay|mobile-)'

# identity / auth / analytics / updater surfaces
git diff --name-only "$MB"..upstream/main \
  | grep -iE 'productIdentity|analytics|posthog|clerk|relay|updater|auto-?update|telemetry|pairing'

# NEW upstream identity the rename table does not cover yet. Package names,
# import paths, and internal symbols are shared with upstream and are not drift.
git diff "$MB"..upstream/main | grep -E '^\+' \
  | grep -oE 'T3 (Code|Connect|Chat)|T3CODE_[A-Z_]+|T3_[A-Z_]+|com\.t3tools\.[A-Za-z.]*|x-scheme-handler/t3code[a-z-]*|t3code://|t3code\.[a-z]+|t3_[a-z]+|t3\.codes' \
  | sort | uniq -c | sort -rn
```

For the last one: cross-check every distinct hit against the `RENAMES` table in
`scripts/sync-upstream.sh`. Report only identifiers **absent** from that table — those
are the ones that would survive a sync and leak T3 identity into the product. A hit
already in the table is handled mechanically and is not news.

A new upstream file whose _name_ carries T3 identity needs no action: this fork keeps
upstream's paths, so only a path that would collide with Vetra identity (brand assets,
`t3.json`) is worth a line.

## Step 5 — Classify each commit: Take / Drop / Review

Per `docs/internals/upstream-sync.md`:

- **Take** — execution runtime we still run: provider adapters and orchestration,
  checkpoints, git, files, terminal, preview, typed contracts, client-runtime
  behavior, and any non-T3-specific fix in `apps/server`, `apps/web`, `apps/desktop`,
  `packages/*`.
- **Drop** — mobile, marketing, inherited release/relay CI, `t3.json`, T3-product
  chrome, upstream contributor/vouching bookkeeping, T3 cloud copy.
- **Review** — touches identity, auth, telemetry, updater, hosted/relay endpoints, or
  anything whose desirability is a judgment call.

Mark a commit **notable** when it is a correctness or security fix, a crash or data-loss
fix, a provider-protocol change, or a perf fix in a hot path — those are the "we should
bring this over" items the human is scanning for. Aim for a handful, not a highlight
on every line.

## Step 6 — Verdict

Apply this rubric mechanically and take the **highest tier that fires**. Upstream is
very active (roughly 7–15 commits/day), so thresholds are tuned to that cadence, not
to calendar intuition.

| Verdict        | Any one of these fires                                                                                                                                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SYNC NOW**   | ≥ 5 predicted conflicts · a conflict in a file with ≥ 5 fork-side commits · oldest unmerged commit ≥ 10 days old · ≥ 75 commits · ≥ 150 files · an unhandled new `T3*` identifier · an incoming change to identity/telemetry/updater/Clerk/relay defaults · incoming `pnpm-workspace.yaml` or `patches/` change |
| **SYNC SOON**  | 1–4 predicted conflicts · 21–74 commits · 40–149 files · oldest unmerged commit 4–9 days old · ≥ 10 overlapping files · incoming `pnpm-lock.yaml` / `package.json` change · upstream touched a pruned tree or a deleted workflow                                                                                |
| **NO ACTION**  | ≤ 20 commits, zero predicted conflicts, no policy risk, oldest unmerged commit < 4 days                                                                                                                                                                                                                         |
| **UP TO DATE** | `HEAD..upstream/main` is empty                                                                                                                                                                                                                                                                                  |

State plainly **which rules fired**. A verdict with no cited rule is not a verdict.
If signals genuinely straddle a boundary, pick the higher tier and say so in one line —
the cost of syncing early is much lower than the cost of syncing late.

Two independent flags to add when true, which do not change the tier:

- `⚠ Working tree dirty` — a sync cannot start until it is clean.
- `⚠ Local main lags upstream/main` — the mirror is stale; the script fixes it.

## Output

Terse, skimmable, stable day over day — this lands in a notification. **Report only;
propose no edits and do not offer to run the sync.** Ranges and hashes go in the
report so consecutive days can be compared.

```markdown
## Upstream drift — YYYY-MM-DD

**Verdict: <SYNC NOW | SYNC SOON | NO ACTION | UP TO DATE>**
<one sentence: N commits, N files, ±N lines, N predicted conflicts, oldest N days old.>

### Snapshot

| Ref                   | Commit                          |
| --------------------- | ------------------------------- |
| `vetra-studio` (HEAD) | `abc1234`                       |
| `upstream/main`       | `def5678`                       |
| local `main` (mirror) | `def5678` <or "lags — ghi9012"> |
| merge base            | `jkl3456`                       |

### Volume

- Commits: N · Files: N · Lines: +N / -N
- Areas: `apps/web` (N), `apps/server` (N), …
- Oldest unmerged commit: YYYY-MM-DD (N days)

### Merge friction

- Predicted conflicts: N — `path/one.ts` (N fork-side commits), …
- Files changed on both sides: N
- Structural churn: <lockfile / workspace / patches / none>

### Policy risk

- <one bullet per hit, or "None — no pruned trees, deleted workflows, identity,
  telemetry, or updater surfaces touched; no new T3 identifiers.">

### What's coming

**Take**

- <≤ 12 words> (#PR) — _notable_ if it qualifies
  **Review**
- …
  **Drop**
- …

### Why this verdict

- <rule that fired> → <tier>
- …

### Next step

<one line. e.g. "Run scripts/sync-upstream.sh; expect 1 conflict in
CodexDeveloperInstructions.ts." or "Nothing to do — re-check tomorrow.">
```

Rules for the bullet list:

- One line per commit, ≤ 12 words, PR number kept. No commit bodies, no diffs, no
  file paths unless the path _is_ the point.
- Group under Take / Review / Drop. Omit an empty group's heading entirely.
- **If more than 30 commits**, summarize by area instead of per-commit — but say so
  explicitly and print the command to see the rest:
  `Showing 12 grouped themes covering 84 commits; full list: git log --oneline HEAD..upstream/main`.
  Never silently truncate; a capped list that reads as complete is worse than no list.
- Collapse runs of near-identical commits (dependency bumps, nightly version bumps,
  contributor-list edits) into one line with a count.

## Failure modes

- **Fetch fails** (offline, auth, rate limit): say so, report the drift computed from
  the _last_ fetch, and stamp the report `stale — fetch failed, refs as of <date of
.git/FETCH_HEAD>`. Never present stale numbers as current.
- **`upstream` remote missing**: report that and stop. Do not add the remote.
- **`upstream/main` is already an ancestor of HEAD but `main` differs**: that is
  `UP TO DATE` with the mirror-lag flag, not drift.
- **Uncertain classification**: put the commit under **Review** rather than guessing
  Take or Drop. Review is the safe default; a wrong Drop is how a fix gets silently lost.
