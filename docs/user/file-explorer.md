# Explore project files

Open **Files** in a thread's right panel to browse and edit the files in that thread's checkout.
The search field filters the tree, and the refresh button reloads both the project listing and its
local Git status.

In Git projects, the explorer decorates uncommitted files relative to `HEAD`:

- `A` is a staged addition.
- `M` is a modified tracked file.
- `R` is a renamed file.
- `U` is an untracked file.

Folders with changed descendants carry a dot and a highlighted name, including when they are
collapsed. Deleted files do not appear in the explorer because they are no longer present in the
checkout; review them from the diff panel instead. Committed differences between a feature branch
and its base branch do not decorate the explorer.
