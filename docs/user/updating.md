# Updates during bootstrap

Vetra Code does not currently publish versioned CLI or desktop releases. Automatic desktop
updates are disabled by default, and the inherited production release workflow was removed so a
development build cannot target Vetra Code's update feed.

Update a source checkout through its Vetra-owned Git remote, then reinstall and rebuild:

```bash
git pull --ff-only
pnpm install
pnpm exec vp run --filter @vetra-code/server build
pnpm exec vp run --filter @vetra-code/desktop build
```

Finish active agent work and terminal processes before restarting development servers. A
registry-based update command is unavailable until the Vetra server package is published.

Versioned server updates and desktop auto-update can be enabled only after the release
prerequisites in the [release runbook](../operations/release.md) are owned and configured by Vetra
Code. See [Background service status](./background-service.md) for the currently supported path.

**Settings** → **General** carries a **Continue threads after server updates** preference, off by
default. It only takes effect once a versioned server update path exists: when enabled, a server
update resumes supported provider threads after the replacement server is ready, using native
promptless continuation where the provider has it and a short continue instruction otherwise.
Terminal commands and other running work are still interrupted by the restart.
