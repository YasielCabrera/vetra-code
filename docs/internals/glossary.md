# Glossary

Terms whose meaning matters across Vetra Code. Architecture and lifecycle constraints belong in the
[overview](./overview.md), not in these definitions.

## Workspace and conversation

| Term           | Meaning                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------- |
| Environment    | One running server and the machine, credentials, workspace access, and state it owns.             |
| Client         | A web or desktop UI connected to an environment. The desktop app can also host a server.          |
| Project        | An environment-local workspace record rooted at a directory.                                      |
| Workspace root | The project's base filesystem directory on the environment.                                       |
| Worktree       | A separate Git checkout a thread can use instead of the project's main checkout.                  |
| Thread         | The durable conversation and work history for a project. It survives provider process exits.      |
| Turn           | One user-to-agent cycle, a V2 run. Provider work can end before checkpoint and diff work settles. |
| Activity       | A non-message timeline item, such as a tool action, approval, or failure.                         |
| Vetra home     | The base data directory. Runtime state normally lives under its `userdata` directory.             |

## Orchestration

| Term                    | Meaning                                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| Command                 | A request to change domain state. Accepting it does not mean its side effects have finished.              |
| Event                   | A persisted fact produced by a command.                                                                   |
| Orchestrator            | The service that serializes commands and decides their events from current state, without I/O.            |
| Projection / read model | A persisted view of current state, committed in the same transaction as the events that change it.        |
| Command receipt         | A durable record of a command's result, used to make retries idempotent.                                  |
| Outbox effect           | Side-effect intent committed with the events, such as starting a provider turn or capturing a checkpoint. |
| Effect worker           | The worker that runs outbox effects after commit and feeds their results back as commands.                |

## Providers and checkpoints

| Term                | Meaning                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Provider            | The agent runtime Vetra Code controls, such as Codex or Claude Code.                                         |
| Driver              | The integration for a provider kind.                                                                         |
| Provider instance   | One configured provider, with its own settings and lifecycle. Multiple instances can use the same driver.    |
| Adapter             | The boundary translating a provider's native protocol into Vetra Code operations and events.                 |
| Session             | The provider runtime attached to a thread. A session can be stopped and resumed without deleting the thread. |
| Runtime mode        | The thread's permission policy. See [permission modes](../user/permission-modes.md).                         |
| Interaction mode    | How the agent approaches the task, such as planning. Separate from permission policy.                        |
| Checkpoint          | A saved workspace state used for diffs and restore, stored as a hidden Git ref.                              |
| Checkpoint baseline | The workspace state captured before the work being compared.                                                 |
| Turn diff           | The workspace changes attributed to one turn.                                                                |

## Pull requests

| Term                 | Meaning                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request link    | A persisted thread association identified by host, repository, and number. Links can cross projects within an environment and carry a server-maintained snapshot.                        |
| Pull request sync    | The worker that refreshes each distinct linked review once per cadence and discovers native stack layers. Explicit refreshes and failed stack reads trigger another read.                |
| Current pull request | The link used by single-review controls and older clients. Open work takes precedence; a completed single chain points at its top layer. Unrelated terminal links use the latest update. |

## Composer context

| Term                 | Meaning                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Context record       | The typed payload behind a composer chip, keyed by `contextId` in `message.context.records`. It never holds bytes.                     |
| Context reference    | One occurrence of a record in message text: `[label](vetra-context://v1/<kind>/<contextId>)`. Several references can share one record. |
| Attachment binding   | The link from an image or file record to its server-owned attachment. Its attachment ID can change without changing `contextId`.       |
| Attachment inventory | The ordered image records shown as thumbnails above the prose, including images with no inline references.                             |

See [composer context references](./composer-context-references.md) for the contract and lifecycle.

## File annotations

| Term             | Meaning                                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content revision | A token derived from the exact file bytes a client last confirmed on disk. The server rejects annotation requests for a stale revision before invoking Git.                                 |
| Line changes     | The `HEAD`-relative added, modified, and removed-line ranges shown in the full-file reader. They describe the working tree, including staged changes, not the branch-range diff.            |
| Blame run        | A contiguous sequence of lines with the same blame commit, stored as a line count plus a commit-table index. Runs cover the whole file without gaps; that coverage is a contract invariant. |

Extraction lives in [GitVcsDriverCore.ts](../../apps/server/src/vcs/GitVcsDriverCore.ts); byte
verification and non-Git behavior live in
[FileAnnotationService.ts](../../apps/server/src/vcs/FileAnnotationService.ts).

## Automations

| Term           | Meaning                                                                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automation     | A scheduled task, edited from the Automations page. The fork adds no scheduler of its own.                                                                              |
| Automation run | A thread an automation's scheduled task launched, recorded by [AutomationRuns.ts](../../apps/server/src/automation/AutomationRuns.ts) so it lists under its automation. |
| Hidden run     | A run kept out of the sidebar (`hiddenAt`). Runs start hidden; revealing one clears the flag without removing it from the automation's history.                         |

## Powerhouse

Powerhouse is a separate open-source project. Vetra Code ships a read-only panel for its projects;
see [powerhouse-panel.md](./powerhouse-panel.md).

| Term                 | Meaning                                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Powerhouse reactor   | Powerhouse's document server, also called a switchboard. It stores documents, serves them over GraphQL, and is what the panel's Explorer mode reads. Unrelated to Vetra Code's orchestration.       |
| Document model       | A Powerhouse document type, declared on disk as `<documentModelsDir>/<name>/<name>.json`. Versions are repeated entries in the file's `specifications` array rather than separate files.            |
| Powerhouse drive     | A container document in a reactor, identified by its document type. The reactor has no query that lists drives; they are found by searching for documents of the drive container types.             |
| Powerhouse reference | The text a dragged panel row leaves in the composer: a file mention for a model row, or `` `powerhouse:<drive\|folder\|doc>/<id>` `` plus the details an agent needs to fetch it for a reactor row. |
| Vetra (Powerhouse)   | Powerhouse's own brand for its authoring toolchain, the `@powerhousedao/vetra` package and the `ph vetra` command. Unrelated to Vetra Code. Nothing in our Powerhouse surface uses the name.        |
