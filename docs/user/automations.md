# Run work on a schedule

Select **Automations** in the sidebar, above Projects, to open a page listing every automation in
your workspace. It is also available from the command palette as **Open automations**.

An automation is a prompt plus a schedule. Each time it fires, Vetra opens a new thread and sends
your prompt to it, exactly as if you had done it yourself.

## Creating one

Select **New automation**, then give it:

- **A name**, which is also the title of every thread it opens.
- **A prompt** — what the agent should do each time it runs.
- **A schedule**: every day, weekdays, every week on a chosen day, every few hours, or a cron
  expression of your own. Schedules run in your time zone, so a run set for 8:00 AM stays at 8:00 AM
  across daylight saving.
- **An agent**: the provider, model, and reasoning level a run starts with — the same pickers the
  composer uses. It defaults to the chosen project's model, or this environment's.
- **Where it runs**: an existing project, or a workspace of its own that Vetra creates for it.
  Automations with their own workspace do not appear in your projects list. If the project you want
  is not in Vetra yet, choose **Add a location…** — it opens the same importer you use to add a
  project, from a local folder or a repository to clone, and selects the result here.
- **Which checkout**: the project's own, or a fresh git worktree for each run. A worktree keeps an
  unattended agent away from the files you are working in, which is usually what you want when the
  automation edits code.
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

To keep a run around, select **Show in sidebar** on its row. It joins your thread list and behaves
like any thread you started yourself, while still counting as one of the automation's runs. To send
it back, choose **Hide from sidebar** in the thread's menu.

**Run now** starts a run immediately without waiting for the schedule, which is the quickest way to
see whether a prompt does what you meant. It works on a paused automation too. If a run is already
in progress, Vetra tells you instead of starting a second one beside it.

## When a run is missed

A run needs the machine that holds its environment to be awake. If yours was asleep when a run was
due, Vetra does not run it late: a recurring automation skips to its next occurrence and its row
shows **Missed**, with **Run now** available if you still want it. A one-time schedule is the
exception — it still fires when the machine wakes, as long as it is within a day.

Automations on a remote environment run on that environment's own machine, so they keep going with
this client closed. The list names the environment for any automation that does not run here.

## Deleting

Deleting an automation — from its panel or the row's ⋯ menu — removes its hidden runs along with it,
since those are only reachable through the automation. Runs you moved to the sidebar are kept.

An automation with a workspace of its own is different: deleting it deletes that workspace and
everything in it, including runs you moved to the sidebar. Vetra says so before it does.
