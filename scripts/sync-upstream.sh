#!/usr/bin/env bash
# Merge pingdotgg/t3code into this fork.
#
# The fork renamed almost every t3* identifier to vetra* and deleted whole app
# trees (mobile, marketing). Upstream keeps shipping the old names into the old
# paths, so a raw `git merge` drags them back in. This script merges, prunes the
# trees we deleted on purpose, and re-applies the rename to whatever the merge
# just brought in -- turning what would be recurring hand-editing into a
# mechanical pass. Anything it cannot decide is left as a real conflict.
#
# This is only the mechanical pass. After it runs, follow
# docs/internals/upstream-sync.md: resolve conflicts, drop restored T3 release
# / mobile workflows, rebrand leftovers, and keep auth, analytics, and
# auto-update from talking to T3 until Vetra owns those destinations.
#
# Usage: scripts/sync-upstream.sh [upstream-ref]   (default: upstream/main)
set -euo pipefail

UPSTREAM_REF="${1:-upstream/main}"

# Trees this fork deleted for good. Upstream edits inside them are dropped, and
# files upstream newly adds inside them never land.
PRUNE_PATHS=(
  .agents/skills/test-t3-mobile
  # Upstream support automation fetches T3's playbook and files issues in
  # pingdotgg/t3code. Keep it out until Vetra owns a published CLI and support
  # destination.
  .github/ISSUE_TEMPLATE/via-triage.yml
  .github/triage
  apps/mobile
  apps/marketing
  scripts/mobile-showcase.ts
  scripts/mobile-showcase.test.ts
  scripts/mobile-showcase.config.ts
  scripts/mobile-showcase-environment.ts
  scripts/mobile-native-static-check.ts
  scripts/mobile-native-static-check.test.ts
  't3.json'
  # Upstream's AUR publishing pipeline. The fork owns no AUR package, and
  # publish-aur.yml is only reachable from the release.yml we deleted. The
  # PKGBUILD directories also carry T3 identity in their *paths*, which the
  # rename pass below never rewrites.
  .github/workflows/publish-aur.yml
  packaging/aur
)
PRUNE_GLOBS=(
  'apps/server/src/cli/triage*'
  'patches/*react-navigation*'
  'patches/*react-native*'
  'patches/*expo*'
)

# Ordered: most specific first, since later patterns are substrings of earlier
# ones. `pingdotgg/t3code` is excluded -- that is the real upstream repo URL and
# must survive verbatim. Likewise t3.codes domains are deliberately absent.
RENAMES=(
  'com.t3tools.t3code=com.vetra.code'
  '@t3tools/=@vetra-code/'
  'T3CODE_=VETRA_'
  # Upstream's SCREAMING_SNAKE constants and test env vars (T3_CHAT_THEME,
  # T3_PROJECT_FILE_NAME, T3_ACP_*, ...). The fork maps every one of these to
  # VETRA_*. Note the leftover grep below cannot see these: `T3[A-Z][a-z]`
  # does not match an underscore, so only typecheck catches a miss.
  'T3_=VETRA_'
  't3tools=vetra-code'
  # Upstream's oxlint plugin is named `t3code`, ours is `vetra`, so a rule
  # reference must not go through the generic `t3code` pair below (it would
  # yield `vetra-code/<rule>` and silently stop matching). Keyed on the rule
  # name prefixes rather than a bare `t3code/` so repository URLs such as
  # `pingdotgg/t3code/main/...` are left alone.
  't3code/no-=vetra/no-'
  't3code/namespace-=vetra/namespace-'
  # All-caps wordmark used in the DMG installer artwork. Neither `T3 Code` nor
  # the leftover grep below matches it (the space defeats `T3CODE`, the case
  # defeats `T3 Code`), so without this pair it ships T3 branding silently.
  'T3 CODE=VETRA CODE'
  'T3 Code=Vetra Code'
  'T3-Code=Vetra-Code'
  't3-code=vetra-code'
  't3.json=vetra.json'
  'T3 Connect=Vetra Connect'
  't3-connect=vetra-connect'
  'T3Connect=VetraConnect'
  'T3ProjectFile=VetraProjectFile'
  'T3Project=VetraProject'
  'T3Server=VetraServer'
  'T3Home=VetraHome'
  't3Home=vetraHome'
  'T3Tools=VetraTools'
  'T3Code=VetraCode'
  't3-resource-monitor=vetra-resource-monitor'
  't3-relay=vetra-relay'
  # Prose form of the theme name, which `t3-chat` below does not match.
  'T3 Chat=Vetra Chat'
  't3-chat=vetra-chat'
  't3-env=vetra-env'
  't3-test=vetra-test'
  't3code=vetra-code'
  # Upstream publishes this workspace package unscoped as `effect-acp`; the
  # fork renamed it to `@vetra-code/effect-acp`. Handled as a special case
  # below because it needs lookbehinds: a `packages/effect-acp` *path* must
  # stay unscoped, and an already-scoped specifier must not double-scope.
  # Without this pair, an upstream file that adds `from "effect-acp/errors"`
  # merges cleanly and then fails to resolve.
  'effect-acp=@vetra-code/effect-acp'
)

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit or stash before syncing." >&2
  exit 1
fi

say "Fetching upstream"
git fetch upstream --prune --tags

# Keep local `main` a pristine mirror of upstream so diffs against it stay
# meaningful. Never commit to main in this fork.
if git rev-parse --verify --quiet main >/dev/null \
  && [[ "$(git symbolic-ref --quiet --short HEAD || true)" != "main" ]] \
  && git merge-base --is-ancestor main "$UPSTREAM_REF"; then
  git update-ref refs/heads/main "$(git rev-parse "$UPSTREAM_REF")"
fi

say "Merging $UPSTREAM_REF ($(git rev-list --count HEAD.."$UPSTREAM_REF") new commits)"
git merge --no-commit --no-ff "$UPSTREAM_REF" || true

say "Pruning deleted trees"
for path in "${PRUNE_PATHS[@]}"; do
  git rm -rf --quiet --ignore-unmatch -- "$path" 2>/dev/null || true
done
for glob in "${PRUNE_GLOBS[@]}"; do
  git rm -rf --quiet --ignore-unmatch -- $glob 2>/dev/null || true
done

say "Re-applying the vetra rename to merged files"
# Only touch files this merge actually changed, and only text files.
#
# A rewrite of a cleanly merged file has to be staged, or it lives only in the
# worktree and `git commit` drops it -- the merge then records upstream's
# original names while the worktree looks correct. Conflicted files are
# deliberately left unstaged: staging one would mark it resolved with the
# conflict markers still inside.
unmerged=$'\n'"$(git diff --name-only --diff-filter=U)"$'\n'
rewritten=0
while IFS= read -r file; do
  # `perl -pi` writes a fresh file and renames it over the target, which turns a
  # symlink into a regular copy of whatever it pointed at. CLAUDE.md -> AGENTS.md
  # was silently flattened this way. Nothing in RENAMES applies to a link target,
  # so skipping links loses nothing.
  [[ -L "$file" ]] && continue
  [[ -f "$file" ]] || continue
  grep -Iq . "$file" 2>/dev/null || continue   # skip binaries
  grep -qE 't3|T3|effect-acp' "$file" 2>/dev/null || continue
  before=$(shasum "$file" | cut -d' ' -f1)
  for pair in "${RENAMES[@]}"; do
    from="${pair%%=*}"
    to="${pair#*=}"
    if [[ "$from" == "t3code" ]]; then
      perl -pi -e 's{(?<!pingdotgg/)\Qt3code\E}{vetra-code}g' "$file"
    elif [[ "$from" == "effect-acp" ]]; then
      perl -pi -e 's{(?<!\@vetra-code/)(?<!packages/)\Qeffect-acp\E}{\@vetra-code/effect-acp}g' "$file"
    else
      FROM="$from" TO="$to" perl -pi -e 's{\Q$ENV{FROM}\E}{$ENV{TO}}g' "$file"
    fi
  done
  if [[ "$(shasum "$file" | cut -d' ' -f1)" != "$before" ]]; then
    rewritten=$((rewritten + 1))
    [[ "$unmerged" == *$'\n'"$file"$'\n'* ]] || git add -- "$file"
  fi
done < <(git diff --name-only --diff-filter=ACMR HEAD -- . | sort -u)
echo "rewrote $rewritten file(s)"

say "Remaining conflicts"
conflicts=$(git diff --name-only --diff-filter=U)
if [[ -z "$conflicts" ]]; then
  echo "none"
else
  echo "$conflicts"
fi

say "Leftover t3 references (review each -- upstream URLs and t3.codes domains are expected)"
# Excluded, all pure noise: vendored reference checkouts and lockfiles match on
# base64 `sha512-` integrity hashes, and this script matches on its own table.
# `t3-[a-z]` is report-only on purpose: these are usually temp-dir prefixes that
# are safe to rebrand, but some are real asset filenames where rewriting the
# string without renaming the file breaks the lookup. Decide per hit.
git grep -nIE 't3tools|t3code|T3 Code|T3CODE|T3_|T3[A-Z][a-z]|t3-[a-z]' -- . \
  ':!.repos' ':!*lock*' ":!${BASH_SOURCE[0]#./}" | grep -v 'pingdotgg/' | head -40 || echo "none"

cat <<'EOF'

Next: docs/internals/upstream-sync.md
  1. Resolve any conflicts listed above, then `git add` them.
  2. Drop restored T3 release / relay-deploy / mobile workflows if they came back.
  3. Re-run the leftover-t3 grep; extend RENAMES in this script for anything
     mechanical rather than hand-editing it. Also search t3.codes / t3.gg.
  4. Confirm Clerk, relay, PostHog, and auto-update still cannot talk to T3.
  5. pnpm install, then focused typecheck/tests for packages the merge touched.
  6. git commit    -- the merge message is already staged
  7. To bail out entirely: git merge --abort
EOF
