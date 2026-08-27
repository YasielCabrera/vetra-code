# Cursor

This guide covers Cursor-specific behavior in Vetra Code. For installing and authenticating the
Cursor CLI, including the `agent login` step that catches people out, see
[Install Vetra Code](./install.md).

## Where Cursor Skills Are Loaded

Vetra Code looks for Cursor skills in four places, each holding one directory per skill with a
`SKILL.md` file:

- `~/.cursor/skills-cursor` — Cursor's own built-in skills, which the Cursor CLI installs and
  keeps up to date.
- Installed plugins — each plugin's manifest names the folder its skills live in. On a machine
  with a few plugins these are usually the majority of your skills.
- `~/.cursor/skills` — your personal skills, available in every project.
- `<workspace>/.cursor/skills` — project skills, shared with anyone using the repository.

If the same skill name exists in more than one place, the more specific one wins: project beats
personal, personal beats plugin, and plugin beats built-in, so a plugin can never shadow a skill you
wrote yourself. Personal skills that are symbolic links to a shared folder are followed, and skills
grouped into subfolders are found.

A plugin contributes only the skills its manifest declares. Files a plugin keeps elsewhere — such
as instructions bundled with an automation — are not offered as skills, matching how Cursor treats
them. A skill marked as not user-invocable stays hidden from the picker, since it is meant to be
applied automatically rather than chosen.

Skills are read on the machine running the Vetra Code server, so a remote environment contributes
its own skills rather than the ones on the device you browse from. A skill whose `SKILL.md` has
broken frontmatter is skipped, matching what Cursor itself does.

Type `$` in the composer to find and add a skill. Each row shows where the skill came from, so
plugin skills are distinguishable from your own. See [Message composer](./composer.md) for the rest
of the picker's behavior.

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
