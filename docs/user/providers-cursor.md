# Cursor

This guide covers Cursor-specific behavior in Vetra Code. For installing and authenticating the
Cursor CLI, including the `agent login` step that catches people out, see
[Install Vetra Code](./install.md).

## Where Cursor Skills Are Loaded

Vetra Code looks for Cursor skills in three folders, each holding one directory per skill with a
`SKILL.md` file:

- `~/.cursor/skills-cursor` — Cursor's own built-in skills, which the Cursor CLI installs and
  keeps up to date.
- `~/.cursor/skills` — your personal skills, available in every project.
- `<workspace>/.cursor/skills` — project skills, shared with anyone using the repository.

If the same skill name exists in more than one folder, the more specific folder wins: project beats
personal, and personal beats built-in. Personal skills that are symbolic links to a shared folder
are followed.

Skills are read on the machine running the Vetra Code server, so a remote environment contributes
its own skills rather than the ones on the device you browse from. A skill whose `SKILL.md` has
broken frontmatter is skipped, matching what Cursor itself does.

Type `$` in the composer to find and add a skill. Cursor's built-in skills appear with a
**Provider** badge. See [Message composer](./composer.md) for the rest of the picker's behavior.

## When A Cursor Turn Ends Early

Cursor can stop before the work is finished — most often after reaching its own
per-turn limit on agent requests, or its token limit. Vetra Code records the reason in
the thread's work log, so a turn that quit partway is distinguishable from one that
finished. The turn still keeps its checkpoint, so you can review or restore whatever
the agent changed before it stopped. Send another message to continue from where it
left off.

Separately, if the Cursor CLI goes completely silent — no output and no tool progress
for ten minutes, or thirty while a tool is still running — Vetra Code cancels the turn
and marks it failed instead of leaving it running forever. A turn waiting on your
approval or on an answer to a question is not counted as silent and will wait
indefinitely.
