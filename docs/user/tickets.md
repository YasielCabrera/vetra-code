# Track work with tickets

A ticket is a piece of work you have not finished: a bug, an idea, a follow-up. Select **Tickets**
in the sidebar, under Automations, to open the board. It is also in the command palette as **Go to
tickets**. Each environment keeps its own tickets, and the board shows every connected
environment's tickets together. Every ticket has a short reference such as `T-42`.

## Create and edit a ticket

Select **New ticket** on the board, choose **New ticket** in the command palette, or press
`Cmd+Option+K` on macOS or `Ctrl+Alt+K` on Windows and Linux. Give it a title, a description in Markdown, a status, labels, and a project. Paste or
drop files into the description to attach them; images and videos show inline and other files as
links. The 50 MB attachment limit applies.

Select a ticket to open it. Edit the title in place, and select **Edit** to change the
description. Changes save on their own after a short pause. Check a task list item in the
description to tick it off without opening the editor. If an agent or another device changed the
description while you were editing it, a banner asks whether to **Reload** their version or **Keep
mine**. Changes to the status, labels, or title elsewhere apply without interrupting you.

The description editor has two modes. **Write** is a rich editor. **Markdown** edits the raw
text. A description that contains a table or HTML opens in Markdown mode.

The panel beside the ticket holds its status, labels, and projects, and the threads, pull
requests, and issues it links to. Select **Link** to add one. Pull requests and issues come from
the repositories of the ticket's projects, so link a project first. A link to a thread or project
you since deleted stays, marked missing, until you unlink it. Leave comments under the activity
history. Delete a ticket from its **⋯** menu.

## Create a ticket from a selection

Turn something you are looking at into a ticket:

- Select text in an agent's reply and choose **Create ticket** beside **Cite**.
- Choose **Create ticket…** in a thread's menu, or **Create ticket from this thread** in the
  command palette, to start from the whole thread.
- Select lines in a file preview or a diff and choose **Create ticket** instead of **Comment**.
- Right-click a file in the file tree, or a file's header in the diff, and choose **Create
  ticket…**.

A dialog shows what you captured. Optionally say what the ticket should cover, and check the
project and model. **Create with agent** starts a new thread in that project, visible in the
sidebar, where an agent investigates and files the ticket with a title, a description that cites
the code it found, and a suggested status. You stay where you are; a notice says the ticket is
being drafted, and another names it once it exists. The ticket links the project and the thread
the selection came from. The agent is told not to change files, but it runs with the
project's usual permissions, so review what it does as with any thread. If it ends without filing
a ticket, a notice says so and links its thread, where you can follow up.

Choose **Write it myself** to open a new ticket instead, with the selection as a quote or code
block and the same links filled in.

Select a linked pull request to open it in the panel, with the same details, checks, and actions as
the Pull Requests page. Select a linked issue to open it in the panel. Select a linked thread to
see its status, model, and project, and open it from there. Select **Properties** to return to the
ticket's properties. A pull request or issue opens in the panel only when one of the ticket's
projects, or a GitHub source, uses its repository; otherwise the panel offers to open it on GitHub.

## Find tickets

The board lists tickets grouped by status. Collapse a group by selecting its name. Search matches
titles, references, labels, and description text. Select the filter button next to the view
switcher to narrow the list by status, kind, project, label, who created the ticket, or whether a
thread or pull request is linked. GitHub tickets can also be filtered by repository, author, and
assignee; with more than one environment connected, filter by environment too. Active filters show
under the search box, where you can change or remove each one. The search and filters stay in the
page address, so going back or sharing the link keeps them. Use the arrow keys to move through the list and Enter to open a ticket.

Switch to the board view to see one column per status, and drag a ticket to change its status or
its place in a column. Moving a GitHub ticket into or out of a closed status asks first, because it
closes or reopens the issue on GitHub.

## Statuses

Statuses live in **Settings → Tickets**, per environment. Each status belongs to a category: open
for work not started, active for work in progress, or closed. A closed status also says whether
the work was completed or not planned. Add, rename, recolor, and reorder statuses there, and choose
which ones start collapsed on the board. Each category keeps a default status, where new tickets
land, and at least one status. Deleting a status asks which status in the same category takes its
tickets. A status that holds GitHub tickets cannot move into or out of the closed category, since
that would close or reopen their issues; move the tickets first.

## GitHub sync

Bring a repository's open GitHub issues onto the board. In **Settings → Tickets**, under GitHub
sources, select **Add repository** and pick a project whose remote is on GitHub. The environment
runs the GitHub CLI (`gh`) in that project, so `gh` must be installed and signed in there. The
first sync starts at once; after that, enabled sources sync every 10 minutes. Select **Sync now**
on a source, or the sync button on the board, to sync right away. A source that cannot sync
shows why, such as `gh` being signed out. A repository with more than 1,000 open issues shows a
warning.

Each issue becomes a ticket with its own `T-` reference, linked to the project, and marked with
the GitHub logo. GitHub owns the issue's title, description, and labels; select **Edit on GitHub**
to change them. Vetra keeps the ticket's status, links, and notes. The panel beside the ticket
shows the repository, issue number, state, author, assignees, and when it last synced. Assign
people from there, and select **Refresh** to read the issue again. The activity shows the issue's
GitHub comments, and a comment you write there posts to GitHub.

Status and issue state follow each other:

- Moving the ticket into a closed status closes the issue, as completed or not planned to match
  the status. Moving it out of a closed status reopens the issue. Both ask first, and if GitHub
  refuses, the ticket stays where it was.
- Moves between open and active statuses stay in Vetra.
- When the issue closes on GitHub, the ticket moves to the first closed status with the matching
  reason, such as **Done** or **Canceled**. When it reopens, the ticket moves to the open default,
  such as **Todo**.

You can also close or reopen the issue from the ticket's **⋯** menu. To take an issue off the
board, choose **Stop tracking** there; sync leaves it alone from then on. Set the **Visibility**
filter on the board to **Hidden tickets** to find it again and select **Track again**. Removing a source hides its
tickets, or deletes them if you choose **Remove and also delete cached tickets**. Either way the
issues stay on GitHub. Adding the repository again brings back the tickets its removal hid; ones
you stopped tracking stay hidden.

## Plans

A plan is a Markdown document on a ticket that describes how to do the work, without changing
code. Plans on a ticket are numbered, so `T-42/P1` is the first plan on `T-42`.

Write one with **New plan** in the ticket's Plans section, or select **Ask agent to plan** to have an
agent draft it. Select text in a plan to comment on it. When the plan is ready, select **Open in new
thread** to have an agent carry it out, or **Ask agent to revise** to have it address your comments.
A new thread waits for you to send its first message.

Plans start **Draft**. Select **Mark Ready** after reviewing a plan, or **Return to Draft** to change
it back. Agents can change the review status too. Title and content edits retain **Ready** until
you or an agent explicitly returns the plan to Draft. Archiving preserves its review status.
Marking a plan Ready does not start implementation. You can ask an agent to implement or revise
either a Draft or a Ready plan.

- Edits save on their own. If an agent or another device changed the plan while you were editing,
  choose **Reload** or **Keep mine**. Earlier versions are not kept.
- Deleting a plan leaves its images on the ticket.
- A comment whose passage an edit removed is marked **Outdated**, and keeps that passage as it was.
- An agent reads a plan's current text, so edits made after you attach it still count.
- Type `#` and a reference, such as `#T-42/P1`, to attach that plan to a message.
- Plans listed on an attached ticket are context only. Attach a plan, or name it, to have the agent
  carry it out.
- When an agent proposes a plan in a thread linked to one ticket, choose **Save as plan on T-42**.
  When the thread links several tickets, choose **Save as plan on…**.

## Start a thread from a ticket

Select **Start thread** on a ticket to open a new thread with the ticket attached. A ticket linked
to one project starts there; otherwise choose the project. Choose **Start in new worktree** to work
on a separate branch. The attached ticket gives the agent its reference, title, description, and
links, and the agent can read the rest.

You can also attach a ticket while writing any message: type `#` and then the ticket's reference,
such as `#T-42`, or a word from its title, and pick it from the list above the pull requests.

When you send a message with a ticket attached, the thread is linked to the ticket. The thread's
header shows its tickets; select one to open it.

## Auto-advance

Tickets move forward on their own as the work progresses:

- Sending a message with an open ticket attached moves it to **In progress**.
- A pull request on a linked thread is linked to the ticket too, and moves it to **In review**.
- When that pull request merges, a local ticket moves to **Done**. A GitHub ticket follows its
  issue instead, which GitHub closes when the pull request says `Fixes #123`.

Tickets only move forward, never back, and a closed ticket stays where it is. Each step happens
once, so a ticket you move back stays where you put it. Choose the target
status for each step, or turn auto-advance off, in **Settings → Tickets**. Links are added either
way.

## Agents and tickets

Agents can read and update tickets. A ticket an agent creates is linked to the agent's thread and
project. An agent can change a ticket's title, body, labels, and status, link it to pull requests
and other threads, and add notes to its activity. If you edited the ticket after the agent last
read it, changes to the title, description, labels, or status are refused, so it cannot overwrite
your work. Attachment-only additions and removals preserve the description. Agents cannot close or
reopen a GitHub issue, or edit the issue's title, body, or labels. They ask you to do that instead.
Agent notes stay in Vetra and never post to GitHub.

Ask an agent to attach images, videos, or files when it creates or updates a ticket or plan, or to
remove a ticket attachment. Files already on the connected environment can be attached in the
same request, without a separate upload. Plans show those files in their body; tickets keep them
in their attachment list unless the agent adds an inline reference.

Agents can also write plans. Ask an agent to plan a ticket and it saves the plan on the ticket
rather than in the chat. Name a plan in a message and the agent implements it, reading it first
and resolving its open comments as it addresses them. Agents can comment on a passage of a plan,
and an agent's change to a plan you edited after it last read the plan is refused.
