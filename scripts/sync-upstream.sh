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
# Usage: scripts/sync-upstream.sh [upstream-ref]   (default: upstream/main)
set -euo pipefail

UPSTREAM_REF="${1:-upstream/main}"

# Trees this fork deleted for good. Upstream edits inside them are dropped, and
# files upstream newly adds inside them never land.
PRUNE_PATHS=(
  apps/mobile
  apps/marketing
  scripts/mobile-showcase.ts
  scripts/mobile-showcase.test.ts
  scripts/mobile-showcase.config.ts
  scripts/mobile-showcase-environment.ts
  scripts/mobile-native-static-check.ts
  scripts/mobile-native-static-check.test.ts
  't3.json'
)
PRUNE_GLOBS=(
  'patches/*react-native*'
  'patches/*expo*'
)

# Ordered: most specific first, since later patterns are substrings of earlier
# ones. `pingdotgg/t3code` is excluded -- that is the real upstream repo URL and
# must survive verbatim. Likewise t3.codes domains are deliberately absent.
RENAMES=(
  '@t3tools/=@vetra-code/'
  'T3CODE_=VETRA_'
  't3tools=vetra-code'
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
  't3-chat=vetra-chat'
  't3-env=vetra-env'
  't3-test=vetra-test'
  't3code=vetra-code'
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
rewritten=0
while IFS= read -r file; do
  [[ -f "$file" ]] || continue
  grep -Iq . "$file" 2>/dev/null || continue   # skip binaries
  grep -qE 't3|T3' "$file" 2>/dev/null || continue
  before=$(shasum "$file" | cut -d' ' -f1)
  for pair in "${RENAMES[@]}"; do
    from="${pair%%=*}"
    to="${pair#*=}"
    if [[ "$from" == "t3code" ]]; then
      perl -pi -e 's{(?<!pingdotgg/)\Qt3code\E}{vetra-code}g' "$file"
    else
      FROM="$from" TO="$to" perl -pi -e 's{\Q$ENV{FROM}\E}{$ENV{TO}}g' "$file"
    fi
  done
  if [[ "$(shasum "$file" | cut -d' ' -f1)" != "$before" ]]; then
    rewritten=$((rewritten + 1))
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
git grep -nIE 't3tools|t3code|T3 Code|T3CODE|T3[A-Z][a-z]' -- . | grep -v 'pingdotgg/' | head -40 || echo "none"

cat <<'EOF'

Next:
  1. Resolve any conflicts listed above, then `git add` them.
  2. Run the leftover-t3 grep again; extend RENAMES in this script for anything
     mechanical rather than hand-editing it.
  3. pnpm install && pnpm check   (or your usual gate)
  4. git commit    -- the merge message is already staged
  5. To bail out entirely: git merge --abort
EOF
