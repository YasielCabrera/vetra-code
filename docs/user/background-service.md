# Background service status

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

Status prints a repair command alongside these. It names the CLI version, or the installed service
version when that is newer, so an older CLI never recommends a downgrade. Enabling lingering needs
`sudo loginctl enable-linger "$(id -un)"`; run only that command with elevated permissions.

While service distribution stays gated, these codes describe a source-built server you supervise
yourself.

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
| `service-disabled` or `service-stopped` | Read the log and `systemctl --user status vetra-code.service`, then use the repair command printed by Vetra Code.              |
| `restart-pending`                       | A newer version is installed but the service still runs the previous one. Run `vetra service restart`.                         |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the `vetra` executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/com.vetra.code.service.plist`.

For failures after signing in to Vetra Connect, see
[connection troubleshooting](./t3-connect-troubleshooting.md).

## Reclaim database space

Vetra Code removes superseded internal history on its own while it runs; your
conversations are kept. Databases created before this shrank automatically
still hold the freed space on disk until a one-time offline repair returns it
and turns on automatic shrinking. Settings > Storage suggests the repair when at least 1 GiB can be
reclaimed.

Run `vetra doctor` on the machine that hosts the environment. It reports the
database size and the space it can reclaim, then asks which repairs to run;
pass `--fix` to run the recommended ones without a prompt (for scripts), or
`--dry-run` to only report. An installed background service for the same data
directory is stopped for the repair and started again afterwards, also when
the repair fails. Quit a server you started by hand, or the desktop app, first:
the repair refuses to touch a database that is in use. Use `--base-dir` for a
different data directory.

The repair can take several minutes on a large database. It rebuilds the
database through a temporary copy, so it needs free space of about the
database's size twice over: once in the system temporary directory (`TMPDIR`
or `/tmp` on Linux and macOS) and once next to the database for its
write-ahead log.

If you upgraded from a version before 0.1.0, its database (`state.sqlite`) is
still kept next to the current one so you can roll back. `vetra doctor` offers to
delete it, but never selects that repair for you and `--fix` skips it: once it
is gone, a version before 0.1.0 starts with no threads or settings.
