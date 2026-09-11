# Source control

Vetra Code connects to your Git hosting provider so you can create pull requests, review code, and manage repositories without leaving the app.

## Connect an account

Vetra Code works with the platforms your team already uses:

- **GitHub** – Pull requests, issues, repository creation, and clone integration
- **GitLab** – Merge requests, repository publishing, and hosted clones
- **Bitbucket** – Pull request workflows (via API token authentication)
- **Azure DevOps** – Pull request support for Microsoft-hosted repositories

Install [GitHub CLI](https://cli.github.com/) 2.81.0 or newer, then sign in:

```bash
gh auth login
```

### GitLab

Install [GitLab CLI](https://gitlab.com/gitlab-org/cli), then sign in:

```bash
glab auth login
```

### Bitbucket

### Manage Code Reviews Without Context Switching

**Create pull requests while you work**

- Push a branch and create a pull request from the Git actions controls in the toolbar
- Vetra Code can suggest titles and descriptions based on your commits
- With **Repository conventions** selected, generated source control text follows the project's
  `AGENTS.md` along with recent commit subjects. Claude writers also follow `CLAUDE.md`
- Supports GitHub Pull Requests, GitLab Merge Requests, Bitbucket Pull Requests, and Azure DevOps Pull Requests

**Stay on top of open reviews**

- See if your current branch already has an open PR/MR
- When an agent finishes a turn on your thread's branch, Vetra Code checks for a newly opened
  PR/MR if background activity is enabled for that repository. Known reviews keep their normal
  refresh schedule.
- Open several reviews from the **Pull requests** page as tabs in the right panel
- Your authored reviews stay at the top and use the selected sort within their group. By default,
  see passing and approved reviews first, passing reviews awaiting approval next, and conflicting
  reviews last. Smaller changes come first within each readiness group, and finished reviews follow
  open work when all states are visible.
- Filter the list by author or labels, rank authors by merges in the loaded results, see label and
  change-size context on each row, and sort the results currently shown by readiness, update time,
  creation time, or change size. Your filters, search, scope, and sort are restored when you return.
- Merge now, or on GitHub, GitLab, and Azure DevOps, leave an auto-merge instruction with a chosen
  strategy while checks are outstanding; see the completed state in the same control after the
  pull request merges
- On GitHub, approve fork workflows that are waiting to run and open a revert pull request for a
  merged change
- Timeline line counts stay hidden on merge commits, where GitHub's totals include upstream changes
  brought in from the base branch
- While working in a thread, open linked reviews in the same compact right-panel tabs without
  leaving the conversation
- Show a file tree next to a review's **Code** tab, or a thread's **Diff** panel, to browse the
  changed files as folders and jump straight to any of them. The toolbar toggle remembers your
  choice.
- Enable **Settings → General → Proactive panels** to open a newly linked review automatically and
  switch to the completed turn's diff when agent work finishes
- Open the review directly in your browser with one click
- If Vetra Code cannot load a GitHub pull request, including when GitHub rate limits requests, use
  **Open on GitHub** in the error view
- Command-click (Control-click on Windows and Linux) a pull request number in the sidebar to open it in your browser instead of in Vetra Code
- Check out a teammate's branch to review code locally
- The **Pull requests** page opens on the filters you last picked — state, involvement, draft,
  review, checks, host, server, and project — so a page you narrowed to your own reviews is
  still that when you come back. A link that names its own filters is still opened as written.

**Fix what you wrote, in place**

- Comment while closing an open pull request or reopening a closed one when the host offers that
  action
- Rewrite a pull request's title and description from the review itself, in Markdown, with a
  preview before you save
- Rewrite your own comments the same way, wherever they are shown
- Works on GitHub, GitLab, and Bitbucket. Azure DevOps takes a new title and description; its
  comments stay read-only here, as they already were
- On GitHub, put a label on a pull request or take one off from the **Labels** row of the review.
  Changing labels needs triage access or better on the repository

### Know Your Setup at a Glance

The **Source Control settings** page shows you exactly what's connected:

- ✅ Which providers are authenticated and ready
- ⚠️ What's missing and how to fix it
- 👤 Which account is signed in (when available)

Run a quick **Rescan** after setting up a new machine or changing credentials.

### Browse Project Issues

Open **Issues** from the bottom of the project sidebar to see issues across your connected
projects. The page reads and behaves like the pull request workspace: a list on the left, and the
issue you pick open in a side panel beside it.

- Search the issue index, and use the filter button to narrow by state, assignee, host, server,
  or project. The filters you pick are the ones the page opens on next time; search text is not
  kept, so you always come back to the full list of whatever you filtered to
- **Assignee** starts with **Me**, so your own issues are one press away, and offers
  **Unassigned** plus everyone the loaded issues are assigned to
- Each issue row names its assignees when it has any, so you can see ownership without opening it
- Keep scrolling to load older issues automatically until every matching repository is complete
- Select an issue to open it in the side panel, where you can read its description, comments,
  assignees, labels, and milestone
- Open several issues at once: each one becomes a tab in the panel, and the tabs can be
  reordered, closed individually, or closed together
- Use the panel toggle in the top right to hide the panel and give the list the full width; it
  reopens on the issue you last had selected
- Add or remove assignees from the issue summary, including a shortcut to assign yourself
- Switch to **Timeline** to follow comments and history such as labels, assignments, milestones,
  title changes, references, closes, and reopens in either newest-first or oldest-first order
- Use **Attach to new thread** to open the issue's project with its details in the composer, or
  **Explain issue** to prefill a read-only investigation for the agent
- Use **Open on GitHub** or **New issue** for issue changes that are not available in the app yet
- Hosts that are not supported yet are reported as unavailable instead of being silently omitted

Screenshots pasted into an issue or a pull request show up inline, including in private
repositories. GitHub serves those uploads only to a signed-in viewer, so the environment that owns
the project fetches them with its own GitHub login. An image the environment cannot fetch is
labelled as unavailable rather than left as a broken tile.

Issue browsing and assignment currently support GitHub repositories. They use the GitHub CLI
authentication on the environment that owns each project, including remote and relay environments.

## Getting Started

### For GitHub (Recommended for most users)

1. Install the GitHub CLI (version 2.81.0 or newer) on the machine running Vetra Code:
   ```bash
   brew install gh
   ```
2. Sign in:
   ```bash
   gh auth login
   ```
3. Open **Settings → Source Control** in Vetra Code and verify GitHub shows as authenticated

You can now clone, publish, and create pull requests.

### For GitLab

1. Install the GitLab CLI:
   ```bash
   brew install glab
   ```
2. Authenticate:
   ```bash
   glab auth login
   ```
3. Check **Settings → Source Control** to confirm the connection

### For Bitbucket

Bitbucket uses tokens instead of a CLI tool. Two options, both set as environment variables on the
machine running Vetra Code.

Recommended, a Bitbucket access token:

```bash
export VETRA_BITBUCKET_ACCESS_TOKEN="your-access-token"
```

Or use an Atlassian account email and API token with read/write access to repositories and pull
requests, plus user read access (`read:user:bitbucket`):

```bash
export VETRA_BITBUCKET_EMAIL="you@example.com"
export VETRA_BITBUCKET_API_TOKEN="your-token"
```

If both are set, the access token wins. Restart Vetra Code and verify the connection in **Source
Control settings**.

### Azure DevOps

Install [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/), add the DevOps extension, and sign in:

```bash
az extension add --name azure-devops
az login
```

## Clone or publish a project

**Git is required** – Vetra Code uses Git for all local operations. Ensure `git` is installed on your server.

**Server-side setup** – Authentication happens on the machine running Vetra Code (the server), not your local browser. If you're using a hosted or team instance, your administrator may have already configured providers.

## Create a pull request

- **Provider shows "Not authenticated"** – Run the login command for that provider (e.g., `gh auth login`) in a terminal on the server, then rescan in Settings
- **GitHub says it could not verify sign-in status** – Vetra Code needs GitHub CLI 2.81.0 or newer to check sign-in status. Update `gh` (e.g., `brew upgrade gh`), then rescan
- **Bitbucket not connecting** – Double-check your environment variables are set in the correct shell profile and the server was restarted
- **Can't push to a remote** – Verify your Git remote URL matches the provider you've authenticated with (SSH vs HTTPS remotes may need different credentials)

Choose the writing style and model in **Settings → Source Control**. **Repository conventions**
uses the project's instructions and recent commit subjects.

## Review and merge

Open **Pull requests** to review changes and comments, request reviewers, check out a branch,
or merge. You can edit review titles and descriptions and your own comments where the host allows it.
GitLab calls these merge requests.

GitHub, GitLab, and Azure DevOps support auto-merge while checks are outstanding. GitHub also
supports approving waiting fork workflows and opening a revert pull request for a merged change.

For Azure DevOps, use the host website to view diffs or change comments. Bitbucket does not support
reopening a declined pull request.

## Troubleshooting

- **Not authenticated:** run the provider's login command on the server, then rescan. For Bitbucket,
  confirm the running server received the environment variables.
- **GitHub sign-in cannot be verified:** update GitHub CLI to at least 2.81.0.
- **Push fails despite a connected account:** check the Git remote's credentials. SSH and HTTPS
  remotes can require separate setup from the hosting provider's API access.
- **A review cannot load:** open it on the host website while resolving connectivity, permissions,
  or rate limits.

## Linked pull requests

A thread can hold several pull requests, including reviews from another repository on the same host.
Use **Link pull request** in the command palette or **Linked pull requests** panel, or right-click a
pull request link in the conversation. Creating a pull request from Git actions links it automatically.
Agents can link their pull requests with the `link_pull_request` tool.

Use **Link this PR** in a branch-detected badge's tooltip to keep it with the thread. From a review
on the Pull Requests page, **Link to thread** lets you search for an active thread. The review header
also lists the threads that link to it, including archived threads, so you can return to their context.

Thread badges show a stack's layer count or the current review number with a count of additional
links. On mobile, the Git overview lists linked reviews and their stacks; tap a review to open it.
Linking and unlinking are available in the web and desktop clients.

The **Linked pull requests** panel lists every review and groups stacks. Unlink a review from its
row menu. An unlinked stack layer stays out of later syncs. Open linked reviews refresh on the server;
closed reviews refresh periodically so reopening one on the host is detected. Merged reviews refresh
when requested. With **Auto-settle merged threads** enabled, a thread can settle after every linked
review is terminal. An open or unsynced link keeps it active.

Cross-repository links use a project on the same host. Azure DevOps reviews require a project checked
out from the matching organization and repository.

## GitHub stacks

The Pull Requests page shows each PR's position in its GitHub stack. Open the stack badge in a
review to navigate its layers. **Merge stack** submits the selected pull request and every unmerged
layer below it to GitHub together, respecting branch rules and merge queues. The confirmation shows
the scope and merge strategy. GitHub rebases the remaining stack after merging.

**Rebase stack** updates remote branches from bottom to top without changing your local checkout.
It can rewrite history and restart checks. If a layer fails, earlier updates remain; resolve that
layer before retrying. GitHub may require manual conflict resolution after a lower layer is amended,
even when its changes look independent. Stack actions require an environment that supports them.
