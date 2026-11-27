# CLI reference (`vetra`)

The `vetra` command runs and manages Vetra Code servers, background services, remote access, threads, workflows, and diagnostics. Run `vetra --help` or `vetra <command> --help` for full flags.

See [Install Vetra Code](./install.md#command-line) for how to build and run the server from a checkout.

## Running and connecting

| Command                        | Description                                                                                                                         |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `vetra [path]` / `vetra start` | Start a foreground server and open the web app (optionally in a project directory).                                                 |
| `vetra serve`                  | Start the server without opening a browser (`--lan`, `--tailscale-serve`, `--host`, `--port`, `--base-dir`).                        |
| `vetra app [path]`             | Open a directory as a project/thread in the running desktop app.                                                                    |
| `vetra up`                     | Interactive setup for remote access (Vetra Connect and/or LAN) plus background service (`--connect`, `--lan`, `--no-lan`, `--yes`). |
| `vetra connect`                | Manage Vetra Connect (`vetra connect`, `status`, `login`, `logout`, `link`, `unlink`).                                              |
| `vetra status`                 | Show how other devices can reach this host (`--json`).                                                                              |
| `vetra pair`                   | Generate a one-time pairing URL / QR code (`--tailscale`, `--scope <scope>`).                                                       |

## Background service and updates

| Command                             | Description                                                                                                                                         |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vetra service`                     | Manage the background service (`install`, `status`, `restart`, `uninstall`, `protect [--undo]`). See [Background service](./background-service.md). |
| `vetra update [version]`            | Update `vetra` and the service (`--channel nightly`, `--allow-downgrade`, `--yes`).                                                                 |
| `vetra install` / `vetra uninstall` | Install or remove the `vetra` launcher and background service (keeps `~/.vetra-code/userdata`).                                                     |

## Threads, projects, and workflows

| Command          | Description                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vetra thread`   | Script threads on the host (`start`, `send`, `show`, `list`; supports `--wait`, `--json`, `--worktree`, `--provider`, `--model`, `--option`). See [Host scripts](./outside-agents.md#scripts-on-the-host). |
| `vetra project`  | Manage projects on the host (e.g. `vetra project add <path> --track <folder>`).                                                                                                                            |
| `vetra workflow` | Start and steer durable workflows (`start`, `list`, `show`, `resume`, `cancel`, `questions`, `signal`, `withdraw`, `hooks`, `store`). See [Workflows](./workflows.md).                                     |

## Environments, auth, themes, and policy

| Command             | Description                                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vetra environment` | Link or manage peer environments (`vetra environment link <addr> --pairing-code <code> --access <mode>`, `--from <file>`).                                |
| `vetra auth`        | Manage pairing codes, sessions, and Vetra Connect device approvals (`pairing create`, `session list/revoke/issue`, `connect-device list/approve/revoke`). |
| `vetra theme`       | Manage server-published themes (`set <id>`, `clear`, `show`). See [Appearance](./appearance.md#environment-themes).                                       |
| `vetra policy`      | Validate, inspect, and generate MDM/GPO templates for [managed policies](./managed-policy.md) (`check`, `show`, `settings`, `templates`).                 |

## Diagnostics and maintenance

| Command               | Description                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| `vetra doctor`        | Inspect database size and reclaim disk space (`--dry-run`, `--fix`).                                       |
| `vetra browser setup` | One-time Linux host setup (AppArmor sandbox profile, libraries, fonts) for the headless preview browser.   |
| `vetra trace summary` | Summarize local server trace latency and errors (`--since 30m`, `--limit 50`).                             |
| `vetra feedback`      | Send or inspect agent feedback reports (`list [--json]`, `--kind`, `--subject`, `--expected`, `--actual`). |
