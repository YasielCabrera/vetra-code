#!/usr/bin/env bash
# Merge pingdotgg/t3code into this fork.
#
# The fork keeps upstream's names for everything a user never sees. Workspace
# packages, import paths, internal symbols, and scratch directories are all
# `t3*`, so most merged files apply verbatim. What the fork does rename is
# product identity -- what a user reads, what is persisted, and what would
# collide with an installed t3code -- and that lives in
# packages/shared/src/productIdentity.ts. The table below re-applies exactly
# that rename to whatever a merge brings in. The script also prunes the trees
# this fork deleted on purpose. Anything it cannot decide is left as a real
# conflict.
#
# Do not add a pair for an internal name. Renaming one here drags it back out
# of sync with upstream and undoes the reason these merges are cheap.
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
  # iOS build/debug automation for the mobile client this fork does not ship.
  .agents/skills/ios-debugger-agent
  # Upstream support automation fetches T3's playbook and files issues in
  # pingdotgg/t3code. Keep it out until Vetra owns a published CLI and support
  # destination.
  .github/ISSUE_TEMPLATE/via-triage.yml
  .github/triage
  # Upstream's PR moderation automation closes PRs against T3's own policy,
  # resolved from pingdotgg/t3code, and exempts T3 maintainers. The rename pass
  # would make it read as Vetra Code's policy.
  .agents/skills/contribution-triage
  .github/TRIAGE_EXEMPTIONS.td
  # Upstream's security policy routes reports to security@ping.gg and links
  # t3.codes/security-policy. The rename pass makes it read as Vetra Code's
  # policy while still pointing at T3, which is worse than shipping none.
  # Restore this file only once Vetra owns a reporting destination.
  .github/SECURITY.md
  apps/mobile
  apps/marketing
  scripts/mobile-showcase.ts
  scripts/mobile-showcase.test.ts
  scripts/mobile-showcase.config.ts
  scripts/mobile-showcase-environment.ts
  scripts/mobile-native-static-check.ts
  scripts/mobile-native-static-check.test.ts
  scripts/mobile-native-client.ts
  't3.json'
  # Mobile-only internals docs. The fork ships no mobile client, so these
  # describe trees the prune pass deletes.
  docs/internals/mobile-development.md
  docs/internals/mobile-navigation.md
  docs/internals/voice-input.md
  docs/user/mobile-appearance.md
  docs/user/mobile-notifications.md
  # Firebase/APNs setup for the mobile client's push notifications.
  docs/operations/android-notifications.md
  # Upstream's Connect operator guide is written for T3's hosted Clerk and
  # relay. Restore it only once Vetra owns those destinations.
  docs/operations/connect-setup.md
  # Upstream's relay-state test reads the deploy step out of release.yml, which
  # this fork prunes, so it can only fail here. scripts/release-smoke.ts drops
  # the matching invocation.
  .github/scripts/relay-state-output.test.cjs
  # Upstream's AUR publishing pipeline. The fork owns no AUR package, and
  # publish-aur.yml is only reachable from the release.yml we deleted. The
  # PKGBUILD directories also carry T3 identity in their *paths*, which the
  # rename pass below never rewrites.
  .github/workflows/publish-aur.yml
  .github/workflows/release.yml
  .github/workflows/mobile-eas-preview.yml
  .github/workflows/mobile-eas-production.yml
  .github/workflows/mobile-fingerprint-check.yml
  .github/workflows/mobile-showcase-screenshots.yml
  .github/workflows/deploy-relay.yml
  packaging/aur
  # Upstream's one-line installers. They default to downloading and executing
  # pingdotgg/t3code release binaries, and are only reachable from the t3.codes
  # pages that serve them. Restore once Vetra publishes its own archives.
  scripts/install.sh
  scripts/install.ps1
  scripts/install.test.ts
  # Upstream's desktop release job is `workflow_call`-only and reachable solely
  # from the release.yml this fork deleted; its preview-publish half is built
  # around Developer ID signing secrets we do not hold. This fork's
  # self-contained .github/workflows/desktop-macos-preview.yml owns that surface.
  .github/workflows/release-desktop.yml
  .github/workflows/desktop-macos-preview-publish.yml
  # Upgrades upstream's V2 preview ledger, where OrchestrationV2 sat at 53 or
  # 54. This fork's ids run one past upstream's from 41 on, so no fork database
  # has that layout and the test's expected ledger can never match ours.
  apps/server/src/persistence/reconcileV2PreviewMigration.test.ts
  # Deleted during fork isolation: the fork's dev setup lives in AGENTS.md, and
  # upstream's file documents the T3 CLI and t3.json worktree scripts.
  docs/operations/development.md
)
PRUNE_GLOBS=(
  'apps/server/src/cli/triage*'
  'patches/*react-navigation*'
  'patches/*react-native*'
  'patches/*expo*'
  # Mobile-only styling library; the fork ships no mobile app.
  'patches/uniwind*'
)

# Ordered: most specific first, since later patterns are substrings of earlier
# ones. `pingdotgg/t3code` is excluded -- that is the real upstream repo URL and
# must survive verbatim. Likewise t3.codes domains are deliberately absent.
# A `re:` prefix makes the left side a Perl regex instead of a literal.
#
# Every pair below is product identity. There is deliberately no pair for
# `@t3tools/`, `t3code`, `t3tools`, or any bare internal symbol: those are the
# names this fork shares with upstream, and rewriting them is what used to make
# every merge a conflict.
RENAMES=(
  # Upstream tells users to run the published CLI as `npx t3 <cmd>`. The fork's
  # server package is private, so there is no npx entry point; the command is
  # just `vetra <cmd>`. Keyed on the whole prefix, ahead of the pairs below,
  # because none of them match a bare `t3` followed by a space.
  'npx t3 =vetra '
  # Upstream's user-facing command references (`t3 service install`, `t3 update`,
  # `t3 theme set`, ...). The fork's CLI is PRODUCT_CLI_NAME, so leaving these
  # tells users to run a binary that does not exist. Keyed on the opening
  # backtick and a trailing space so repository URLs, `t3.codes` hosts, and the
  # `t3.large` instance type are untouched.
  '`t3 =`vetra '

  # Desktop application identity. Two installed apps cannot share an
  # application id, a D-Bus name, or a URL scheme.
  'com.t3tools.t3code=com.vetra.code'
  # The same id in upstream's PascalCase spelling, used by the Linux
  # window-capture code as a D-Bus well-known name and a desktop-entry name.
  'com.t3tools.T3Code=com.vetra.code'
  # Bare `com.t3tools.<Service>` D-Bus interfaces and bus names that carry no
  # product word (`com.t3tools.SnapShot`, `com.t3tools.KdeCapture.Feedback`),
  # plus the matching object paths. Must stay after the two id pairs above.
  'com.t3tools.=com.vetra.'
  '/com/t3tools/=/com/vetra/'
  # Upstream's GNOME Shell extension for active-window capture. `T3SnapShot` is
  # a D-Bus well-known name, an object path element, and the exported extension
  # class, so leaving it would claim T3's bus name and collide with an
  # installed upstream extension.
  'T3SnapShot=VetraSnapShot'
  # The same extension's GNOME UUID, which doubles as the directory GNOME
  # installs it into. Mapped onto `vetra.code` to match PRODUCT_DESKTOP_APP_ID
  # rather than inventing a domain.
  'snap-shot@t3.codes=snap-shot@vetra.code'
  # Upstream spells its URL scheme with the same word as its product slug. This
  # fork splits them: the slug is `vetra-code` but the scheme is
  # PRODUCT_DESKTOP_PROTOCOL, `vetra`. A bare `scheme: "t3code"` literal still
  # needs a human, so check every scheme fixture after a merge that touches URL
  # handling.
  'x-scheme-handler/t3code-dev=x-scheme-handler/vetra-dev'
  # The dev scheme in bare form, as return-URL allowlists and handoff links spell it.
  't3code-dev:=vetra-dev:'
  'x-scheme-handler/t3code=x-scheme-handler/vetra'
  't3code://=vetra://'
  # The systemd unit the CLI installs. Two units cannot share a name.
  't3code.service=vetra-code.service'

  # Environment variables. A machine can run both products, and an exported
  # T3CODE_HOME must not reach into this one's state. Note the leftover grep
  # below cannot see these: `T3[A-Z][a-z]` does not match an underscore.
  'T3CODE_=VETRA_'
  'T3_=VETRA_'

  # Persisted state and served paths. Rewriting any of these orphans a user's
  # stored preference or points a remote client at a path this server does not
  # serve.
  't3_session=vetra_session'
  # Persisted client keys and CSS highlight registry names. Keyed on the
  # opening quote so the `pingdotgg/t3code.git` remote is untouched.
  '"t3code.="vetra.'
  # Colon-separated `localStorage` keys (`t3code:ui-state:v1`, `t3code:theme`).
  # Four keys predate this pair and still ship as `vetra-code:*`
  # (browser-favicons, chunk-load-reloaded, default-theme-applied,
  # remote-open-hint-seen); renaming them is a migration, not a sync.
  '"t3code:="vetra:'
  't3.pullRequests.=vetra.pullRequests.'
  # Hidden git refs written into users' repositories (checkpoints). Two products
  # sharing one repo must not share a ref namespace.
  'refs/t3/=refs/vetra/'
  # The environment discovery document's well-known path.
  '.well-known/t3/=.well-known/vetra/'
  # Vetra Connect's HTTP routes. Keyed on the trailing slash so the
  # docs/internals/t3-connect.md filename, which tracks upstream, is untouched.
  't3-connect/=vetra-connect/'
  # The environment JWT's issuer and audience prefix.
  't3-env:=vetra-env:'
  # URL schemes that ride in prompts sent to providers and in persisted
  # messages, plus the composer-context clipboard MIME type.
  't3-assistant-citation=vetra-assistant-citation'
  't3-citation=vetra-citation'
  't3-context=vetra-context'
  # Theme ids persisted in a user's settings.
  't3-chat=vetra-chat'
  # The MCP server name agents address tools by.
  't3_code=vetra_code'
  # The same server in its hyphenated spelling: the name every provider adapter
  # registers, and the `mcp__vetra-code__*` prefix agents and users' permission
  # allowlists see. A regex pair, because the literal would also rewrite the
  # `t3-codex-*` scratch prefixes that stay upstream's.
  're:t3-code(?!x)=vetra-code'
  # The loose matcher for that server name in tool-call titles and metadata.
  't3[-_ ]?code=vetra[-_ ]?code'

  # Generated names written into a user's home: scratch and backup files beside
  # a compositor config, the staged GNOME extension directory, the XDG portal
  # shortcut id, and the KDE test bus socket. Each lands in a shared namespace
  # where T3's name would collide.
  '.t3-capture-=.vetra-capture-'
  't3-snap-shot-=vetra-snap-shot-'
  't3-kde-bus-=vetra-kde-bus-'

  # Product name, in every spelling that reaches a user. The all-caps form is
  # the wordmark in the DMG installer artwork; neither `T3 Code` nor the
  # leftover grep matches it.
  'T3 CODE=VETRA CODE'
  'T3 Code=Vetra Code'
  'T3-Code=Vetra-Code'
  'T3 Connect=Vetra Connect'
  'T3 Chat=Vetra Chat'
  # The product name as it reaches users in MCP tool labels and as it reaches
  # agents in tool descriptions and runtime instructions.
  'T3 thread=Vetra Code thread'
  'T3-owned=Vetra-owned'
  'T3 tool=Vetra Code tool'
  'T3 orchestration=Vetra Code orchestration'
  'T3 transport=Vetra Code transport'
  'when T3 runs as=when Vetra Code runs as'
  # Upstream's GitHub org / winget publisher, never a TypeScript identifier.
  'T3Tools=Vetra-Code'
  # The project file this fork reads. Upstream's own t3.json is pruned above.
  't3.json=vetra.json'
  # Fixture identity for the relay and the ACP test client.
  't3-relay=vetra-relay'
  't3-test=vetra-test'
)

say() { printf '\n\033[1m==> %s\033[0m\n' "$1"; }

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is dirty. Commit or stash before syncing." >&2
  exit 1
fi

say "Fetching upstream"
git fetch upstream --prune --tags

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
  grep -qE 't3|T3' "$file" 2>/dev/null || continue
  before=$(shasum "$file" | cut -d' ' -f1)
  for pair in "${RENAMES[@]}"; do
    from="${pair%%=*}"
    to="${pair#*=}"
    if [[ "$from" == re:* ]]; then
      FROM="${from#re:}" TO="$to" perl -pi -e 's{$ENV{FROM}}{$ENV{TO}}g' "$file"
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

say "Leftover T3 identity (review each -- package names, import paths, and internal symbols are meant to stay t3*)"
# Only identity spellings are reported. `t3code`, `t3tools`, and `t3`-prefixed
# symbols are deliberately absent: this fork shares those with upstream, so
# reporting them would bury the handful of hits that matter.
#
# `\.t3/` is report-only and has no RENAMES pair: it is a storage path, and a
# blind rewrite would also hit AGENTS.md, where `~/.t3/userdata` names the
# developer's real legacy install on purpose. Rebrand runtime and fixture hits;
# leave that one.
git grep -nIE 'T3 Code|T3 Connect|T3 Chat|T3CODE|T3_[A-Z]|t3_session|t3\.json|t3code://|x-scheme-handler/t3code|\.well-known/t3/|t3-(citation|context|assistant-citation)|com\.t3tools|T3SnapShot|\.t3/' -- . \
  ':!.repos' ':!*lock*' ":!${BASH_SOURCE[0]#./}" | grep -v 'pingdotgg/' | head -40 || echo "none"

say "Vetra names outside the identity surface (these should carry upstream's name)"
# The fork owns `@vetra-code/` only where a name is published or reserved: the
# CLI's npm package and its platform binaries. Anywhere else it means a merge,
# or a new package, reintroduced the scope the fork deliberately gave up.
git grep -nI '@vetra-code/' -- . \
  ':!.repos' ':!*lock*' ":!${BASH_SOURCE[0]#./}" ':!re-making-plan' \
  ':!packages/shared/src/productIdentity.ts' ':!packages/shared/src/legacyCliLauncher*' \
  ':!apps/server/scripts/cli.ts' ':!scripts/build-npm-platform-packages*' \
  ':!apps/server/src/cli/invocation.test.ts' ':!apps/server/src/cli/service.test.ts' \
  ':!docs/internals/server-updates.md' ':!docs/operations/release.md' | head -20 || echo "none"

cat <<'EOF'

Next: docs/internals/upstream-sync.md
  1. Resolve any conflicts listed above, then `git add` them.
  2. Drop restored T3 release / relay-deploy / mobile workflows if they came back.
  3. Re-run both greps above. Extend RENAMES only for product identity; an
     internal name that came back as `t3*` is correct and should stay.
     Also search t3.codes / t3.gg.
  4. Confirm Clerk, relay, PostHog, and auto-update still cannot talk to T3.
  5. pnpm install, then focused typecheck/tests for packages the merge touched.
  6. git commit    -- the merge message is already staged
  7. To bail out entirely: git merge --abort
EOF
