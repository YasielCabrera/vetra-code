# Background service status

Vetra Code includes Linux and macOS background-service support, but installing it is not yet a
supported workflow because `@vetra-code/server` is private and unpublished. Until Vetra publishes
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
