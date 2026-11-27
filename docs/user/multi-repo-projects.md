# Projects with several repositories

A single Vetra Code project can span multiple Git repositories so one thread can read and edit all of them. This supports:

- A plain folder containing multiple repositories (e.g. `shop/api` and `shop/web`)
- A repository paired with external sibling repositories anywhere on disk
- A repository with Git submodules

The project folder itself does not need to be a Git repository.

## Discovery and configuration

Vetra Code automatically discovers every Git repository inside the project folder—one level down, plus one level deeper inside non-repo folders (such as `src/` or `packages/`). Cloned or deleted repos update automatically; worktrees of other repos are ignored. View covered repos in **Settings → Projects → Repositories**.

- **Add external folders**: Use **Add folder** in **Settings → Projects → Repositories** import entries from a `.code-workspace` file, or run `vetra project add <path> --track <folder>`. Added folders are per machine (up to 128 folders per project); removing one never deletes files.
- **Ignore a repository**: Add relative paths to `vetra.json` in the project folder (applies on every machine):

```json
{
  "ignoreRepositories": ["vendor/big"]
}
```

- **Submodules**: Checked out automatically when creating a worktree. If checkout fails, run `git submodule update --init` in the thread folder. Modified submodules appear as their own repository for diffs and Git actions, while the parent shows the updated pin.

## Review, commit, and open pull requests

- **Turn diffs**: Each turn groups changed files by repository. In the Diff pane (web/desktop), **Uncommitted**, **Changes**, and **Commits** read one repository at a time via the repository picker. See [Review turn changes](./source-control.md#review-turn-changes).
- **Git actions**: Commit, push, and PR actions run per repository—expand a repository in the thread details panel. Use **Other repositories…** to include untouched repos. PRs link under their own repository.

## Worktree threads

**New worktree** creates a thread folder matching the project layout, giving each selected repository its own worktree on the thread's branch.

- Choose repositories from the repositories control next to the workspace picker before sending (all repos are selected by default when there are 8 or fewer; none when more; repos with no commits are excluded).
- Add more repositories to a running thread from **Other repositories…**.
- Each repository branches from the thread's base branch if it has one, otherwise its own default branch.
- In a plain project folder, files outside repositories are linked (shared) rather than copied—editing them affects all threads.

### Custom worktree layout

For custom workspace generation (e.g., per-thread build dirs or submodule setup), declare `worktreeLayout` in the project folder's `vetra.json`:

```json
{
  "worktreeLayout": {
    "create": "./scripts/new-workspace.sh",
    "remove": "./scripts/remove-workspace.sh"
  }
}
```

`create` runs in the project folder (10-minute timeout, serialized per project) with these environment variables:

| Variable                      | Value                                         |
| ----------------------------- | --------------------------------------------- |
| `VETRA_PROJECT_ROOT`          | The project folder.                           |
| `VETRA_WORKTREE_ROOT`         | Empty folder to populate for this thread.     |
| `VETRA_WORKTREE_PROJECT_PATH` | Target path for the project folder inside it. |
| `VETRA_WORKTREE_BRANCH`       | The thread's branch name.                     |
| `VETRA_WORKTREE_BASE`         | Base branch, or empty if none.                |
| `VETRA_WORKTREE_REPOSITORIES` | Selected repositories, one path per line.     |

Requirements for layout scripts:

- Create linked worktrees on `VETRA_WORKTREE_BRANCH` via `git worktree add` (clones or other branches are rejected).
- `create` must be idempotent (if re-run when a folder is missing, check out the existing branch). Failed `create` runs roll back created checkouts.
- `remove` (optional) runs before Vetra Code cleans up and should handle partially missing folders and delete generated files.

Example (`sh`) for a single repo that also initializes submodules:

```json
{
  "worktreeLayout": {
    "create": "(git worktree add \"$VETRA_WORKTREE_PROJECT_PATH\" \"$VETRA_WORKTREE_BRANCH\" 2>/dev/null || git worktree add -b \"$VETRA_WORKTREE_BRANCH\" \"$VETRA_WORKTREE_PROJECT_PATH\" ${VETRA_WORKTREE_BASE:-HEAD}) && git -C \"$VETRA_WORKTREE_PROJECT_PATH\" submodule update --init"
  }
}
```

#### Command approval and security

Vetra Code prompts you to approve the exact `create` and `remove` command strings on web/desktop before running them (manage approvals in **Settings → Projects → Worktree layout**; requires `terminal:operate`). Approvals are stored per environment and invalidated if the command string in `vetra.json` changes.

- Unapproved commands block worktree creation from scheduled tasks and agents.
- Agents can never approve commands and must be in **Full access** to trigger `worktreeLayout` or worktree-creation setup scripts.
- Administrators can disable layout commands with [`worktreeLayoutCommands`](./managed-policy.md#other-capabilities).

## Rewind and limits

- **Rewind**: Restores every repository with an earlier snapshot. Plain-folder files outside repositories and repositories with no earlier snapshot keep their current contents (the rewind reports any skipped repos).
- **Limits**: Git actions run one repository at a time; only the project folder's `vetra.json` is read; the Diff pane repository picker and plain-folder base branch field are web/desktop only.
