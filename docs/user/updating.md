# Updates during bootstrap

Vetra Studio does not currently publish versioned CLI or desktop releases. Automatic desktop
updates are disabled by default, and the inherited production release workflow was removed so a
development build cannot target Vetra Studio's update feed.

Update a source checkout through its Vetra-owned Git remote, then reinstall and rebuild:

```bash
git pull --ff-only
pnpm install
pnpm exec vp run --filter @vetra-studio/server build
pnpm exec vp run --filter @vetra-studio/desktop build
```

Finish active agent work and terminal processes before restarting development servers. A registry-based
update command is unavailable until the Vetra server package is published.

Versioned server updates and desktop auto-update can be enabled only after the release prerequisites
in the [release runbook](../operations/release.md) are owned and configured by Vetra Studio.
