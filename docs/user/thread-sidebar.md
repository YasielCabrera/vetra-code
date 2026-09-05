# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

On web and desktop, a new thread keeps the current project and carries your model
and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
an existing worktree, use **New thread in this worktree** from the branch toolbar.

Each server stores its own copy of the automatic settlement settings and checks them even when no
web, desktop, or mobile client is connected. By default, it settles threads after three days without
activity and when their pull request merges. An eligible idle thread also settles when its pull
request closes. An open pull request blocks inactivity settlement. Active work, pending input, and
live background work keep the thread active. Vetra Code settles from a closed or merged pull request
only when its timestamp is not older than the user's latest activity. If that timestamp is not
available, the inactivity rule still applies. A manual un-settle also keeps the thread active.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work. Drag pinned threads
to reorder them on web and desktop, or use **Move up** and **Move down** on mobile.
The order syncs across devices.

Pinning does not prevent automatic settlement. Settling a thread removes its pin.

## Settle finished work

Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.

If reordering is unavailable for one environment, update the Vetra Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

Change these rules in **Settings → General**. They continue to run when your apps
are closed. Changes apply to connected environments that support shared settings;
offline environments and older servers keep their previous values. If connected
environments disagree, **Apply to all** copies your current settings to those named
in the warning. Changing a rule does not reopen already settled threads.

## Link a pull request

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread**. Use **Unlink from thread** on the same link to remove it.
The linked pull request participates in automatic settlement.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments. Message search starts after two characters and
includes your messages and final agent responses.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise its thread ID. See [keybindings](./keybindings.md)
for custom configuration.

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by Vetra Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While Vetra Code is generating it, the action reads **Regenerating…** and
cannot be selected again. The option is hidden when the connected environment needs a server update.
