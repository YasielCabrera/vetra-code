# Run work on a schedule

Select **Automations** in the sidebar, above Projects, to open a page listing every automation in
your workspace. It is also available from the command palette as **Open automations**.

An automation is a prompt plus a schedule. Each time it fires, Vetra opens a new thread and sends
your prompt to it, exactly as if you had done it yourself. Agents can schedule work too, through
Vetra's scheduled-task tools; what they create is listed here alongside your own.

## Creating one

Select **New automation**, then give it:

- **A name**, which is also the title of every thread it opens.
- **A prompt** — what the agent should do each time it runs.
- **A schedule**: every day, weekdays, or every week on a chosen day at a set time, or every few
  hours. Times are in the local time of the machine that runs the environment, so a run set for
  8:00 AM stays at 8:00 AM across daylight saving. An interval counts from when the previous run
  started, not from the top of the hour.
- **An agent**: the provider, model, and reasoning level a run starts with — the same pickers the
  composer uses. It defaults to the chosen project's model, or this environment's.
- **Where it runs**: an existing project, or **A new project**, which Vetra creates under its new
  projects folder, named after the automation, and adds to your projects list. If the project you
  want is not in Vetra yet, choose **Add a location…** — it opens the same importer you use to add a
  project, from a local folder or a repository to clone, and selects the result here.
- **Which checkout**: the project's own, or a fresh git worktree for each run, branched from the base
  branch you pick (the project's current branch by default). A worktree keeps an unattended agent
  away from the files you are working in, which is usually what you want when the automation edits
  code.
- **Permissions**, beside the model. Automations default to full access, because a run that stops to
  ask for approval waits for you and may sit unfinished until you open it.

Selecting an automation opens it in a panel beside the list, where everything about it stays
editable.

An automation starts active. Pause it any time with the toggle in its panel or from the row's ⋯
menu; a paused automation keeps its schedule and stops firing.

The suggestions below the list are starting points — selecting one fills the form in for you.

## Runs

Each run is its own thread, and those threads are deliberately absent from the sidebar — a schedule
firing overnight should not fill your inbox. They are listed under **Runs** in the automation's
panel, newest first. Select one to open it like any other thread.

A run finishes while you are not watching, so Vetra keeps count of the ones you have not read. A green
number beside **Automations** in the sidebar says how many finished runs are waiting, each
automation's row says how many of its own are unread, and under **Runs** the unread ones carry a green
dot. Opening a run reads it and the count goes down. To clear several without opening them, select
**Mark all read** above the run list, or **Mark runs read** in the row's ⋯ menu.

To keep a run around, select **Show in sidebar** on its row. It joins your thread list and behaves
like any thread you started yourself, while still counting as one of the automation's runs. To send
it back, choose **Hide from sidebar** in the thread's menu.

**Run now** starts a run immediately without waiting for the schedule, which is the quickest way to
see whether a prompt does what you meant. It works on a paused automation too, and starts a new run
even if an earlier one is still working.

An automation an agent set up to post into an existing thread says so under **Where it runs**; its
runs arrive in that thread instead of opening new ones.

## When a run is missed

A run needs the machine that holds its environment to be awake. If yours was asleep when a run was
due, Vetra does not run it hours late: a run more than ten minutes overdue is skipped, and the
automation waits for its next occurrence. **Run now** is there if you still want it. If a run could
not start, the row says **Failed** and Vetra keeps the reason.

Automations on a remote environment run on that environment's own machine, so they keep going with
this client closed. The list names the environment for any automation that does not run here.

## Deleting

Deleting an automation — from its panel or the row's ⋯ menu — archives its hidden runs, since those
are only reachable through the automation; you can still find them under **Settings → Archived**.
Runs you moved to the sidebar are kept, and so is the project it ran in.
