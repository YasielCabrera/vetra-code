# Source Control Integrations

Vetra Code connects to your Git hosting provider so you can create pull requests, review code, and manage repositories without leaving the app.

## Supported Providers

Vetra Code works with the platforms your team already uses:

- **GitHub** – Pull requests, issues, repository creation, and clone integration
- **GitLab** – Merge requests, repository publishing, and hosted clones
- **Bitbucket** – Pull request workflows (via API token authentication)
- **Azure DevOps** – Pull request support for Microsoft-hosted repositories

## What You Can Do

### Start Projects from Anywhere

**Clone repositories directly**

- Open the Command Palette (`Cmd/Ctrl + K`) → **Add Project**
- Choose **GitHub repository**, **GitLab repository**, **Bitbucket repository**, **Azure DevOps repository**, or paste any **Git URL**
- Enter the repository path (`owner/repo`, `group/project`, `workspace/repository`, or `project/repository`) or a full Git URL, pick a destination, and start coding

**Publish local projects to the cloud**

- Have a local Git repository without a remote?
- Use the **Publish Repository** action to create a new hosted repository (GitHub, GitLab, Bitbucket, or Azure DevOps), add it as your origin remote, and push, in one flow
- If the local repository has no commits yet, publishing creates the remote and wires it up but does not push. Make a commit, then push normally.

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

Or an Atlassian account email plus API token, with read/write access to pull requests and
repositories, plus read access to your user account (`read:user:bitbucket`, used to verify the
connection):

```bash
export VETRA_BITBUCKET_EMAIL="you@example.com"
export VETRA_BITBUCKET_API_TOKEN="your-token"
```

If both are set, the access token wins. Restart Vetra Code and verify the connection in **Source
Control settings**.

### For Azure DevOps

1. Install Azure CLI:
   ```bash
   brew install azure-cli
   ```
2. Add the DevOps extension:
   ```bash
   az extension add --name azure-devops
   ```
3. Sign in:
   ```bash
   az login
   ```

---

## Requirements & Troubleshooting

**Git is required** – Vetra Code uses Git for all local operations. Ensure `git` is installed on your server.

**Server-side setup** – Authentication happens on the machine running Vetra Code (the server), not your local browser. If you're using a hosted or team instance, your administrator may have already configured providers.

**Common issues:**

- **Provider shows "Not authenticated"** – Run the login command for that provider (e.g., `gh auth login`) in a terminal on the server, then rescan in Settings
- **GitHub says it could not verify sign-in status** – Vetra Code needs GitHub CLI 2.81.0 or newer to check sign-in status. Update `gh` (e.g., `brew upgrade gh`), then rescan
- **Bitbucket not connecting** – Double-check your environment variables are set in the correct shell profile and the server was restarted
- **Can't push to a remote** – Verify your Git remote URL matches the provider you've authenticated with (SSH vs HTTPS remotes may need different credentials)

**Need more help?** Check your provider's CLI documentation:

- [GitHub CLI](https://cli.github.com/)
- [GitLab CLI](https://gitlab.com/gitlab-org/cli)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/)
