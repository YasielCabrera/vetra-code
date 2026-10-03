# Updates during bootstrap

Vetra Code does not currently publish versioned CLI or desktop releases. Automatic desktop
updates are disabled by default, and the inherited production release workflow was removed so a
development build cannot target Vetra Code's update feed.

Update a source checkout through its Vetra-owned Git remote, then reinstall and rebuild:

```bash
git pull --ff-only
pnpm install
pnpm exec vp run --filter t3 build
pnpm exec vp run --filter @t3tools/desktop build
```

Finish active agent work and terminal processes before restarting development servers. A
registry-based update command is unavailable until the Vetra server package is published.

Versioned server updates and desktop auto-update can be enabled only after the release
prerequisites in the [release runbook](../operations/release.md) are owned and configured by Vetra
Code. See [Background service status](./background-service.md) for the currently supported path.

Restarting a server interrupts active agents and terminal commands. Saved threads, settings, and
project files remain.

**Settings → General → Continue threads after restarts** is off by default. Enable it to resume
supported active threads after the server restarts, including after a crash or machine restart.
Vetra Code must start again on that machine; the setting does not enable automatic startup.
Terminal commands may still be interrupted, and threads without saved provider resume state need a
new message.

Updates from the previous orchestration system preserve conversation transcripts but cannot carry
every kind of runtime history forward. Read [Threads from older Vetra Code versions](./thread-migration.md)
before continuing an important older thread.

## When versions don't match

A client and server must speak the same orchestration protocol. If they do not, the connection is
refused rather than running half-upgraded:

- An app newer than the server is blocked before connecting, with a notice telling you to update
  Vetra Code on the machine named in the notice.
- A server newer than your app refuses the connection with an update message.

Update the side the notice names, then reconnect.

## Update providers

**Settings → Providers** shows provider updates for the selected environment.
**Update all** updates every outdated provider on every connected environment
at once. Hover it to see which providers it will update. Providers that only
offer a manual update command are not included.
