# Running Vetra Code in the background

On Linux, macOS, and Windows, Vetra Code can run as a service for your user so you
do not need to keep a terminal open.

## Manage the service

Install the `vetra` CLI first ([Install Vetra Code](./install.md#command-line)), then
run these commands on the machine that will host Vetra Code:

| Task                                  | Command                   |
| ------------------------------------- | ------------------------- |
| Set up access from your other devices | `vetra up`                |
| See how your other devices reach it   | `vetra status`            |
| Install and start                     | `vetra service install`   |
| Inspect status and log location       | `vetra service status`    |
| Move to a newer release               | `vetra update`            |
| Restart                               | `vetra service restart`   |
| Stop and remove from startup          | `vetra service uninstall` |

Uninstalling the service leaves your projects, threads, and settings intact.
Running `vetra service install` again repairs a service that `vetra service status`
reports as broken.

`vetra update` downloads the newest release on your channel and switches `vetra`
and the service to it. Restarting interrupts running agent turns, terminals,
and remote clients, so it asks first; answer no and the service keeps running
the old version until you run `vetra service restart`. Pass `--yes` from a
script. A server you started by hand is left running; stop and start it again
to pick up the new version. Wait for any remote update already in progress
before updating; to match a remote client's version, follow
[Updating Vetra Code](./updating.md).

Pass an exact version (`vetra update 0.0.42`) to pin one, `--channel nightly` to
switch trains, or `--allow-downgrade` to move backwards. `preview` is a
maintainers' test train: its builds can be broken and are never offered as
updates, so the installer and `vetra update` ask for confirmation before
installing one.

`vetra uninstall` removes the background service, the `vetra` launcher, and the
downloaded versions after showing you the list and asking once. Your projects,
threads, and settings under `~/.t3/userdata` are kept, along with `service.env`
under Vetra home. Pass `--yes` from a script.

Vetra Code includes Linux and macOS background-service support, but installing it is not yet a
supported workflow because `t3` is private and unpublished. Until Vetra publishes
and validates its own server package, keep a source-built server running in a terminal or in a
process supervisor that you configure explicitly.

Service distribution becomes supported after the package is published from a Vetra-owned registry
and the install, update, rollback, and uninstall paths are validated against Vetra's own identifiers
and data directories.

## Implemented behavior

The gated service uses a small stable launcher. Exact Vetra Code versions are installed separately,
so a failed remote candidate can return to the previous version without rewriting the service
definition. The launcher snapshots the database before a remote candidate starts, allowing database
updates to roll back with the server version.

- **Linux** uses a systemd user unit at `~/.config/systemd/user/vetra-code.service`. The service
  starts when the machine boots and can keep running after logout when lingering is enabled.
- **macOS** uses a launch agent at
  `~/Library/LaunchAgents/com.vetra.code.service.plist`. It starts at login and stops at
  logout; macOS has no equivalent of Linux lingering for user agents.
- **Windows** is not supported yet.

On macOS, installing over SSH requires a user to be logged in at the Mac's screen for the launch
agent to start immediately. Protected folders may also require Full Disk Access for the Node binary
listed in the launch agent's `ProgramArguments`. The agent appears in System Settings under General
→ Login Items.

Updating the service briefly restarts Vetra Code, so active agent work and terminal commands should
finish first. If a remote update is already in progress, wait for it to finish before retrying a
local update.

The install and update paths refuse to replace a newer service with an older version, so a
Vetra Connect setup leaves a newer service unchanged. Downgrading is deliberate: it requires the
exact older version and `--allow-downgrade`.

## Local network access

The service listens on your local network and Tailscale addresses, so the
desktop app and locally served web clients can connect directly. HTTPS-hosted
clients need an explicitly configured secure connection because browsers block
plain HTTP from an HTTPS page. The service does not answer on
public addresses, and every device still needs to pair or sign in. To keep the service reachable from this machine only, set
`VETRA_HOST=127.0.0.1` in `service.env` (below). Any `VETRA_HOST` value
replaces this default.

## Configure the service environment

Put custom environment variables in `service.env` under the service's Vetra home
directory, normally `~/.vetra-code/service.env`. This file survives service installation
and updates. For example:

```dotenv
VETRA_PORT=3773
VETRA_HOST=127.0.0.1
```

Use `KEY=VALUE` entries, quoting values that contain spaces or `#`. Values are
literal: shell commands and variable expansion are not evaluated. Entries
override the inherited service environment, except for `PATH`, `VETRA_HOME`,
`VETRA_BOOT_SERVICE_UNIT`, and `VETRA_SERVICE_LAUNCHER_CONTEXT` (including case variants).

Run `vetra service restart` after changing the file. Changes apply when the service
starts again; switching the server version alone keeps the current values.
For a service installed before env-file support, run `vetra service install` once
with an up-to-date CLI.
A missing file is ignored; other read failures stop service startup.
If the file contains credentials, restrict access to that file with `chmod 600`
(for the default Vetra home, `chmod 600 ~/.vetra-code/service.env`).

## Service status problems

`vetra service status` reports what is installed and, on Linux, whether the service is running,
enabled at startup, and allowed to survive logout. It lists any problems it finds:

| Code                       | What it means                                                                    |
| -------------------------- | -------------------------------------------------------------------------------- |
| `linger-disabled`          | The service stops after your last login session ends and does not start at boot. |
| `linger-unavailable`       | Vetra Code could not verify the logout setting.                                  |
| `user-manager-unavailable` | Vetra Code cannot reach your systemd user manager.                               |
| `service-disabled`         | The service is not enabled to start automatically.                               |
| `service-stopped`          | The service is installed but is not running.                                     |

Windows starts the service when you log in and stops it when you sign out. It
runs without a window as the `t3code-<domain>-<user name>` task in Task Scheduler, and Task
Scheduler starts it again within a minute if it exits. Lock the screen instead
of signing out, and keep the PC awake, for unattended remote access. Installing
over SSH while nobody is signed in at the PC can fail at the final start step;
the service is still installed and will start at the next sign-in.

While service distribution stays gated, these codes describe a source-built server you supervise
yourself.

## Keep the server responsive when agents use all memory

On Linux, agents already run with lower priority than the server. When they
fill the machine's memory, though, the kernel may still slow down or stop the
server, because only an administrator can reserve memory for it. Run, as your
normal user:

```sh
vetra service protect
```

It shows the system settings it will change, asks before applying them, and
then asks for your sudo password. If the machine runs Tailscale or SSH, it
also offers to protect them, so you can still reach the machine. Memory
protection takes effect at once. The server's protection from the kernel's
out-of-memory killer takes effect after `vetra service restart`. `vetra service status` reports whether
the protection is in place, and `vetra service protect --undo` removes it.

## Vetra Connect

Vetra Connect remains unavailable until Vetra-owned cloud configuration is present. Once enabled,
its setup may offer to install the background service so the environment stays reachable. The two
features remain independently managed: signing out of Vetra Connect does not uninstall the service.
Start with `vetra service status` on the host. It prints the log path and, on Linux,
checks whether the installed service is running, enabled, and allowed to survive
logout.

If it stops when your SSH session closes, check for `linger-disabled`. An
administrator can enable lingering with:

```sh
sudo loginctl enable-linger "$(id -un)"
```

Over SSH, allow sudo to prompt:

```sh
ssh -t your-server 'sudo loginctl enable-linger "$(id -un)"'
```

Then retry service setup as your normal user. Run only the `loginctl` command
with sudo; running Vetra Code as root creates a separate installation and Connect
identity. Without administrator access, run `vetra serve` in a terminal and keep
that session open.

| Status problem                          | Next step                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `linger-unavailable`                    | Run `loginctl show-user "$(id -un)" --property=Linger` and check that systemd-logind is available.                             |
| `user-manager-unavailable`              | Run `systemctl --user status` in a login session for the service user; check your distribution's systemd user-session support. |
| `service-disabled` or `service-stopped` | Read the log and, on Linux, `systemctl --user status vetra-code.service`, then use the repair command printed by Vetra Code.   |
| `restart-pending`                       | A newer version is installed but the service still runs the previous one. Run `vetra service restart`.                         |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the `vetra` executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/com.vetra.code.service.plist`.

For failures after signing in to Vetra Connect, see
[connection troubleshooting](./t3-connect-troubleshooting.md).

## Reclaim database space

Vetra Code removes internal history older than a day on its own while it runs;
your conversations are kept. Databases created before this shrank automatically
still hold the freed space on disk until a one-time offline repair returns it
and turns on automatic shrinking. Settings > Storage suggests the repair when at least 1 GiB can be
reclaimed.

When the desktop app or the background service runs Vetra Code on that machine,
select **Reclaim** in Settings on web or desktop. Vetra Code checks for free disk
space, then stops, repairs the database, and starts again. It is offline while
the repair runs, and running agents stop. If the repair fails, Settings shows
why.

In other cases, such as a server you started by hand, run `vetra doctor` on the
machine that hosts the environment. It reports the database size and the
space it can reclaim, then asks which repairs to run;
pass `--fix` to run the recommended ones without a prompt (for scripts), or
`--dry-run` to only report. An installed background service for the same data
directory is stopped for the repair and started again afterwards, also when
the repair fails. Quit a server you started by hand, or the desktop app, first:
the repair refuses to touch a database that is in use. Use `--base-dir` for a
different data directory.

The repair's time grows with the size of the whole database, not only the
space it reclaims, and can exceed an hour on a large database or a slow disk;
`vetra doctor` shows each step as it runs. It rebuilds the database through a
temporary copy, so it needs free space of about twice the data still in use
(the database size minus the reclaimable space): once in the system temporary
directory (on Linux and macOS, `TMPDIR`, or `/var/tmp` when it is not set) and
once next to the database for its write-ahead log.

If you upgraded from a version before 0.1.0, its database (`state.sqlite`) is
still kept next to the current one so you can roll back. `vetra doctor` offers to
delete it, but never selects that repair for you and `--fix` skips it: once it
is gone, a version before 0.1.0 starts with no threads or settings.
