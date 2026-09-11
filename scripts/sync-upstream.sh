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
  # Mobile-only styling library; the fork ships no mobile app.
  'patches/uniwind*'
)

# Ordered: most specific first, since later patterns are substrings of earlier
# ones. `pingdotgg/t3code` is excluded -- that is the real upstream repo URL and
# must survive verbatim. Likewise t3.codes domains are deliberately absent.
RENAMES=(
  # Upstream tells users to run the published CLI as `npx t3 <cmd>`. The fork's
  # server package is private, so there is no npx entry point; the command is
  # just `vetra <cmd>`. Keyed on the whole prefix, ahead of the pairs below,
  # because none of them match a bare `t3` followed by a space.
  'npx t3 =vetra '
  'com.t3tools.t3code=com.vetra.code'
  # Same application id in upstream's PascalCase spelling, used by the Linux
  # window-capture code as a D-Bus well-known name and a desktop-entry name.
  # Without this pair the generic `t3tools` and `T3Code` pairs compose into
  # `com.vetra-code.VetraCode`, which is both the wrong app id and an invalid
  # D-Bus name.
  'com.t3tools.T3Code=com.vetra.code'
  # Bare `com.t3tools.<Service>` D-Bus interfaces and bus names that carry no
  # product word (`com.t3tools.SnapShot`, `com.t3tools.KdeCapture.Feedback`),
  # plus the matching object paths. D-Bus name elements allow only
  # `[A-Za-z0-9_]`, so the generic `t3tools=vetra-code` pair would emit
  # `com.vetra-code.SnapShot` and the bus would reject it at runtime. Must stay
  # after the two app-id pairs above, which are more specific.
  'com.t3tools.=com.vetra.'
  '/com/t3tools/=/com/vetra/'
  '@t3tools/=@vetra-code/'
  'T3CODE_=VETRA_'
  # Upstream's SCREAMING_SNAKE constants and test env vars (T3_CHAT_THEME,
  # T3_PROJECT_FILE_NAME, T3_ACP_*, ...). The fork maps every one of these to
  # VETRA_*. Note the leftover grep below cannot see these: `T3[A-Z][a-z]`
  # does not match an underscore, so only typecheck catches a miss.
  'T3_=VETRA_'
  # Upstream's session cookie name is the lowercase literal `t3_session`, which
  # no other pair matches (`T3_` is uppercase). The fork serves this name from
  # PRODUCT_SESSION_COOKIE_NAME, so without this pair a merge that touches auth
  # leaks `t3_session` into cookie assertions and legacy-cookie fixtures.
  't3_session=vetra_session'
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
  'T3-code=vetra-code'
  't3-code=vetra-code'
  't3.json=vetra.json'
  'T3 Connect=Vetra Connect'
  't3-connect=vetra-connect'
  # Upstream spells its URL scheme with the same word as its product slug, so
  # the generic `t3code` pair maps both to `vetra-code`. This fork splits them:
  # the slug is `vetra-code` (user-data dir, WM class) but the scheme is
  # PRODUCT_DESKTOP_PROTOCOL, `vetra`. Only the mime-handler spelling can be
  # keyed mechanically; a bare `scheme: "t3code"` literal still needs a human,
  # so check every scheme fixture after a merge that touches URL handling.
  'x-scheme-handler/t3code-dev=x-scheme-handler/vetra-dev'
  'x-scheme-handler/t3code=x-scheme-handler/vetra'
  'T3Connect=VetraConnect'
  # Upstream's MCP work-log presentation helper and its lowercase server-name
  # spelling. `t3_code` survives the uppercase `T3_` pair, and `T3Mcp*` matches
  # no other pair, so without these a sync leaks both into the work log.
  'T3McpToolPresentation=VetraMcpToolPresentation'
  # Upstream's GNOME Shell extension for active-window capture. `T3SnapShot` is
  # a D-Bus well-known name, an object path element, and the exported extension
  # class; no other pair matches it, so without this one the fork would claim
  # T3's bus name and collide with an installed upstream extension.
  'T3SnapShot=VetraSnapShot'
  # The same extension's GNOME UUID, which doubles as the directory GNOME
  # installs it into. `t3.codes` is deliberately absent from this table (see the
  # header) because it must survive in comments and upstream-host fixtures, so
  # this one application identity is keyed on the whole literal. Mapped onto
  # `vetra.code` to match PRODUCT_DESKTOP_APP_ID rather than inventing a domain.
  'snap-shot@t3.codes=snap-shot@vetra.code'
  't3_code=vetra_code'
  # Upstream keys the relay's Effect services on a bare `t3code-relay/` prefix,
  # which the generic `t3code` pair below turns into `vetra-code-relay/` -- not
  # the `@vetra-code/relay/` the deterministicKeys diagnostic demands. Keyed on
  # the opening quote so prose and package paths are left alone.
  '"t3code-relay/="@vetra-code/relay/'
  # Persisted client keys and CSS highlight registry names the fork owns. The
  # generic `t3code` pair would map these to `vetra-code.*`, orphaning a user's
  # stored preference and desynchronising the CSS name from its JS registration.
  # Keyed on the opening quote so the `pingdotgg/t3code.git` remote is untouched.
  '"t3code.="vetra.'
  # Same idea for the colon-separated `localStorage` keys and the URL scheme
  # (`t3code:ui-state:v1`, `t3code:theme`, `t3code://app`). The generic `t3code`
  # pair would map these to `vetra-code:*` and orphan every user's stored client
  # state. Four keys predate this pair and still ship as `vetra-code:*`
  # (browser-favicons, chunk-load-reloaded, default-theme-applied,
  # remote-open-hint-seen); renaming them is a migration, not a sync.
  '"t3code:="vetra:'
  # Upstream's `localStorage` namespace for the pull request surfaces. Nothing
  # else matches a bare `t3.` prefix, and a blanket pair cannot be added: it
  # would also rewrite `t3.codes` hosts and the `t3.large` EC2 instance type a
  # machine-detection fixture asserts on. Extend this list per namespace.
  't3.pullRequests.=vetra.pullRequests.'
  # The environment discovery document's well-known path. A blanket `t3/` pair
  # cannot be added (it would rewrite Effect service keys and repository paths),
  # so this one namespace is listed explicitly. Without it, a merged client test
  # probes a path this server does not serve.
  '.well-known/t3/=.well-known/vetra/'
  't3-assistant-citation=vetra-assistant-citation'
  # The assistant-citation URL scheme. It rides in prompts sent to providers and
  # in persisted messages, so it is product identity, not an internal name.
  't3-citation=vetra-citation'
  'T3ProjectFile=VetraProjectFile'
  'T3Project=VetraProject'
  'T3Server=VetraServer'
  'T3Home=VetraHome'
  't3Home=vetraHome'
  # Lower-camel names upstream builds from the product word. Neither 'T3Code'
  # nor 'T3ProjectFile' matches these, so a merge otherwise keeps T3 identity in
  # a local binding ('t3File') or a module path ('lib/t3ProjectFileDefaults').
  't3ProjectFile=vetraProjectFile'
  't3File=vetraFile'
  # Upstream's remote-launch script builder. 'T3Runner' matches no other pair.
  'buildRemoteT3RunnerScript=buildRemoteVetraRunnerScript'
  # Binary names built from a variable, as in the Linux capture helpers'
  # `t3-${backend}-snap-shot`. The quoted `"t3-` pair below cannot see these,
  # and the crates in native/ rename to `vetra-*`, so a miss leaves the build
  # script staging a filename cargo never produces.
  't3-${=vetra-${'
  # Generated names the window-capture code writes into a user's home: scratch
  # and backup files beside a compositor config, the staged GNOME extension
  # directory, the XDG portal shortcut id, and the KDE test bus socket. None is
  # preceded by a quote, so the `"t3-` pair below cannot reach them, and each
  # one lands in a shared namespace where T3's name would collide.
  '.t3-capture-=.vetra-capture-'
  't3-snap-shot-=vetra-snap-shot-'
  't3-kde-bus-=vetra-kde-bus-'
  # Upstream's GitHub org / winget publisher, never a TypeScript identifier.
  # Mapped onto the same identity as the pairs below so a repo-identity fixture
  # cannot come out half-renamed (`VetraTools/vetra-code` lowercases to a
  # different canonical key than `vetra-code/vetra-code`).
  'T3Tools=Vetra-Code'
  'T3Code=VetraCode'
  # Lower-camel form used in analytics property names (`t3CodeVersion`). Neither
  # `T3Code` nor the leftover grep's `T3[A-Z][a-z]` matches it, so without this
  # pair a merged property name silently keeps T3 identity.
  't3Code=vetraCode'
  't3-resource-monitor=vetra-resource-monitor'
  't3-relay=vetra-relay'
  # Prose form of the theme name, which `t3-chat` below does not match.
  'T3 Chat=Vetra Chat'
  't3-chat=vetra-chat'
  't3-env=vetra-env'
  't3-test=vetra-test'
  # Temp-directory and fixture-identity prefixes, in tests and in the runtime
  # code that names a scratch directory. `t3-code` does not match a bare
  # `t3-<word>`, so these otherwise survive as T3 identity. Keyed on the opening
  # quote: the bare form would also rewrite `t3-code`-adjacent prose and the
  # `t3-[a-z]` hits the leftover grep only reports, some of which are real asset
  # filenames that must keep matching the file on disk.
  '"t3-="vetra-'
  't3code=vetra-code'
  # Upstream publishes these workspace packages unscoped; the fork scopes both
  # under `@vetra-code/`. Handled as special cases below because they need
  # lookbehinds: a `packages/<name>` *path* must stay unscoped, and an
  # already-scoped specifier must not double-scope. Without these pairs, an
  # upstream file that adds `from "effect-acp/errors"` merges cleanly and then
  # fails to resolve.
  'effect-acp=@vetra-code/effect-acp'
  'effect-codex-app-server=@vetra-code/effect-codex-app-server'
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
  grep -qE 't3|T3|effect-acp|effect-codex-app-server' "$file" 2>/dev/null || continue
  before=$(shasum "$file" | cut -d' ' -f1)
  for pair in "${RENAMES[@]}"; do
    from="${pair%%=*}"
    to="${pair#*=}"
    if [[ "$from" == "t3code" ]]; then
      perl -pi -e 's{(?<!pingdotgg/)\Qt3code\E}{vetra-code}g' "$file"
    elif [[ "$from" == "effect-acp" ]]; then
      perl -pi -e 's{(?<!\@vetra-code/)(?<!packages/)\Qeffect-acp\E}{\@vetra-code/effect-acp}g' "$file"
    elif [[ "$from" == "effect-codex-app-server" ]]; then
      perl -pi -e 's{(?<!\@vetra-code/)(?<!packages/)\Qeffect-codex-app-server\E}{\@vetra-code/effect-codex-app-server}g' "$file"
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
#
# `\.t3/` is likewise report-only, and deliberately has no RENAMES pair: it is a
# storage path, so a blind rewrite would also hit AGENTS.md, where `~/.t3/userdata`
# names the developer's real legacy install on purpose. Rebrand the runtime and
# fixture hits; leave that one.
git grep -nIE 't3tools|t3code|T3 Code|T3CODE|T3_|T3[A-Z][a-z]|t3-[a-z]|\.t3/' -- . \
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
