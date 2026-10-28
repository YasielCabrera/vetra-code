# Updating Vetra Code

The app you use and the server running your agents can be on different machines.
When a server is behind your web or desktop app, the update button at the bottom
of the sidebar and **Settings → Environments** offer to update it.

## Update everything at once

The update button at the bottom of the sidebar updates every connected machine
in one step. It updates outdated providers, then servers that are behind, then
the desktop app you are using, which restarts last. Servers move to the
version your desktop app is installing, or to your web app's version. A
background service stays on its current release channel. A remote desktop app
installs the latest release from its own channel. Hover the button to see what
it will update.

Vetra Code does not publish server releases yet. A desktop app installed from a release
updates itself; rebuild a checkout as described below.

Server updates appear only after that version is published to npm. Remote
desktop apps do not wait for npm. The confirmation lists each machine it skips
and why, such as a machine that is offline or needs a manual update. Use
**Settings → Environments** for those.

If a desktop app restarts on its old version, Vetra Code tells you the update did
not apply. It does not install that version again on its own, even when another
device asks. Use the update button on that machine to retry.

The confirmation counts the running threads that the restarts will interrupt,
and how many can resume afterwards. See **Continue threads after restarts**
below.

## Before you update

Server updates restart the connection and can interrupt active agents and
terminal commands. Saved threads, settings, and project files remain.

**Settings → Maintenance → Continue threads after restarts** is on by default.
It resumes supported active threads after an update, crash, or machine
restart. Changes are saved to connected environments that support this setting;
update older servers first. If a supported environment was offline or has a
different value, use **Apply to all** in Settings after it connects.
Vetra Code must start again on that machine;
the setting does not enable automatic startup. Terminal commands may still be
interrupted, and threads without saved provider resume state need a new message.
A thread that finished its turn to wait on a subagent, a background task, or a
command or monitor the agent said it was waiting on is woken and told that this work
stopped. Other background shells and monitors, such as a dev server and its
watchdog, do not wake it; the thread learns about them with your next message.
A thread is not resumed while it waits for your approval, answer, or secret, or
while it is archived, snoozed, or settled. After three automatic resumes in a row,
the thread waits for your next message.

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

## Update a connected server

Vetra Code does not publish server releases yet, so the offered update actions
cannot install a new version. Rebuild the server from its checkout instead.

On the host, run:

```sh
git pull && pnpm install && pnpm build:desktop
```

Then restart the desktop app if it hosts the server. For a server you started by hand,
stop it and start it again afterwards with your usual options such as `--host`
or `--tailscale-serve`.

Only one server can use a Vetra home directory at a time. If startup reports that
another server owns it, stop that server before retrying, or use a separate home
directory and pair with the running server.

## If the desktop app does not start

If the desktop app's server keeps failing at startup, Vetra Code shows a "Vetra Code
could not start" window instead of the app. If a newer version is available,
choose **Update** to install it. If not, the window links to the last version
that started on your computer. Download and install it to go back. Use **Copy
details** to include the error in a bug report.

## Update providers

**Settings → Providers** shows provider updates for the selected environment.
**Update all** updates every outdated provider on every connected environment
at once. Hover it to see which providers it will update. Providers that only
offer a manual update command are not included.

After a successful provider CLI update, Vetra Code refreshes model discovery for
every enabled instance of that provider using its own configuration. Connected
clients receive the refreshed catalogs automatically. Vetra Code downloads model
catalog updates only when `VETRA_MODEL_MANIFEST_URL` is set and provider update
checks are enabled.

Provider updates do not restart running chats. An existing session can keep
using the previous CLI until it ends. If discovery fails, check the provider
status and refresh it again.
