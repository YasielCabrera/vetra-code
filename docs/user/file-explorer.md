# Explore project files

Open **Files** in a thread's right panel to browse and edit the files in that thread's checkout.
The search field filters the tree, and the refresh button reloads both the project listing and its
local Git status.

Clicking a file opens it in a preview tab, shown with an italic name. There is only ever one
preview tab: clicking the next file reuses it, so skimming through a project does not fill the tab
strip. To keep a file in its own tab, double-click it in the tree, double-click its preview tab,
or choose **Keep open** from the tab's context menu. Editing a previewed file also keeps it open,
and files opened from search, chat links, or the diff always get their own tab.

In Git projects, the explorer decorates uncommitted files relative to `HEAD`:

- `A` is a staged addition.
- `M` is a modified tracked file.
- `R` is a renamed file.
- `U` is an untracked file.

Folders with changed descendants carry a dot and a highlighted name, including when they are
collapsed. Deleted files do not appear in the explorer because they are no longer present in the
checkout; review them from the diff panel instead. Committed differences between a feature branch
and its base branch do not decorate the explorer.

Open a text file to see those working-tree changes in context. A green gutter bar marks added lines,
a blue bar marks modified lines, and a red wedge marks a gap where lines were removed. These markers
compare the current file, including staged changes, with `HEAD`. They follow edits while you type and
settle to Git's authoritative result after the file is saved.

Place the text caret on a line to see who last changed it and when. The hint sits after the line's
code without covering it or changing the line spacing. Blame history loads only after the first
blame interaction, so opening a file is not delayed by history. Per-line blame is enabled by default;
turn it off from **Settings → Source Control → File viewer**. Lines that have not been committed are
labeled **You**.

In-file markers and blame are available for complete text-file previews in Git projects. Truncated
large-file previews, binary files, and non-Git projects remain undecorated. The diff panel is
unchanged and remains the place to review patch-only or word-level changes.
