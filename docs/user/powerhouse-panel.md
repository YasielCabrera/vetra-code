# Inspect Powerhouse projects

Open **Document models**, **Document explorer**, or **Powerhouse Database** in a thread's right
panel. These tools let you read a Powerhouse project's document models, browse a running reactor,
and inspect the generated database shape. They are read-only. Editing documents stays in Connect.

The three tools appear only in workspaces that contain a Powerhouse project with a
`powerhouse.config.json`. That project does not have to be the workspace root. In a monorepo it is
usually an app directory such as `apps/connect`, and the tools find it there. Workspaces without
one never show them.

When a workspace holds more than one Powerhouse project, a **Project** picker appears at the top of
each panel. Every panel instance remembers its own project choice, and each project keeps its own
reactor address.

## Document models

**Models** lists the document models declared in the project's models directory — `./document-models`
unless the config says otherwise. Each row shows the model's name, file extension, newest version,
and how many modules and operations that version defines.

Open a model to inspect its definition:

- Its GraphQL schema for global state, and for local state when it declares one.
- Line numbers beside the SDL for each state schema, so a type or field can be cited by line in
  chat or a review. The numbers stay in place while long lines scroll sideways, and they are left
  out when you copy the schema.
- An **SDL / Diagram** switch for each state schema. Diagram view lays out types, inputs,
  interfaces, enums, unions, and custom scalars, with labeled connections for fields, arguments,
  implemented interfaces, and union members. Drag the canvas to pan and use its controls to zoom
  or fit the complete graph. Long declarations start with 16 members; select their **+N more** row,
  or double-click the declaration, to expand it. Select **Show less** or double-click again to
  collapse it. The image menu can download the complete diagram as a PNG or copy the PNG to the
  clipboard, ready to paste into the agent composer or another app. Both actions preserve the
  current expanded declarations and theme rather than capturing only the visible viewport.
- Each module's operations, with the input schema for each.
- A version picker when the model carries more than one version, and that version's change log.

A model file that cannot be read does not hide the rest. The list names the file and what is wrong
with it — invalid JSON, a missing `<name>/<name>.json`, an unreadable or oversized file, or a file
that is not a document model — above the models that loaded normally.

Models come from the working tree, so this panel works with nothing else running. Press the refresh
button after changing a model on disk.

Drag a model row onto the chat composer to reference it in a prompt. It arrives as a link to the
model's directory, not just its `<name>.json`, so the agent sees the specification, the generated
types, and the reducers together.

## Document explorer

**Explorer** shows live data from the project's reactor: its drives, the documents inside them, and
each document's operation history.

Start from the drive list, open a drive to see its contents, and open a document to see:

- Its type, identifiers, and per-scope revisions.
- **State** — the document's current state as JSON.
- **Operations** — the document's history. Expand a row for the full input, the
  operation hash, and any error recorded against it.

The search field narrows the rows already loaded by name, slug, identifier, or document type. At
the reactor root it searches the drive rows; after you open a drive or apply a document filter it
searches document rows. Multiple words all have to match, but they can match different fields.

Open **Filters**, choose the fields you need, enter their values, and press **Apply filters**. Each
applied condition stays visible below search with its field, operator, and value; select one to edit
it, remove conditions individually, or clear them all together. Explorer offers the exact fields
supported by Switchboard:

- **Document type** — choose a known project model or a built-in document drive, reactor drive, or
  folder type. You can still enter a custom type ID when it is not listed.
- **Parent identifier** — overrides the open drive or folder; at the root it can address a parent
  directly.
- **Identifiers** — exact document IDs or slugs, separated by commas or new lines.
- **Branch** — choose **Main branch** (`main`), Powerhouse's default, or search for and use a custom
  branch name.
- **Scopes** — choose one or more standard document scopes (`global` and `local`) or system scopes
  (`document`, `auth`, and `header`). Selected scopes appear as removable chips, and custom scope
  names remain available. Remove the Scopes condition entirely to include every scope.

Branch and scope selections choose the document view Switchboard returns. That same view follows
into document state and operation history.

At the reactor root, a document type, parent identifier, or identifier search opens document
results across the reactor. Branch and scope alone take effect after you enter a drive, because
Switchboard requires at least one document search criterion.

A drive or folder lists all of its documents at once, up to 500. Past that the reactor gives Explorer
no way to ask for more, so the list says it is showing the first 500 rather than presenting a partial
list as the whole drive.

Operation history loads a page at a time as you scroll and keeps going until there is nothing left to
send — there is nothing to press. Footers count what has loaded rather than claiming a total, because
the reactor reports one page's length as its total.

If a page fails to load, the list says so and stops there rather than retrying on its own. Press the
reload button above the list to start again.

Model and drive overviews are capped at 500 entries. If a project or reactor exceeds that bound,
the panel labels the list as truncated instead of silently pretending it is complete.
Document detail similarly labels omitted revisions or child identifiers when their bounded lists
are unusually large.

Drag a drive, folder, or document row onto the chat composer to point the agent at it. It arrives as
a chip named after the item, carrying — behind the chip — its identifier, its type, where it sits,
and the reactor's address, so the agent can look it up without you retyping an id. Hover the chip to
see everything it carries.

Very large document state and operation input are not transferred; the panel says so instead of
stalling. Syntax-highlighted SDL and JSON previews are limited to their first 100,000 characters;
the panel labels the cutoff when a valid value is longer. Model details also label when unusually
dense version, module, operation, or change-log lists have been shortened to keep the panel
responsive. Diagram view is loaded only when selected and has its own explicit complexity limits;
when a schema is too large or declarations are initially collapsed, the diagram says so and SDL
remains available. PNG generation loads only after an image action is selected and limits image
dimensions to avoid browser canvas failures on unusually large graphs. Copying depends on image
clipboard access in a secure browser connection; the panel reports when the browser cannot provide
it, while PNG download remains available.

## Powerhouse Database

**Database** inspects the two stores Powerhouse builds:

- **Read models** contains the generated processor schemas and read-model tables.
- **Reactor** contains the reactor's operational storage.

Choose a target at the top of the view. Its status always says whether you are looking at a
point-in-time **Snapshot** or **Live Postgres**. Vetra Code does not poll either database in the
background; use **Refresh** when you want to capture a newer local snapshot or re-read a live
catalog.

The left side lists schemas and their tables, partitioned tables, views, materialized views, and
foreign tables. Search matches both schema and relation names. PostgreSQL system schemas are
hidden by default and can be included explicitly. Generated read-model schema hashes are shown as
Powerhouse created them; the panel does not guess which processor name produced a hash.

Open a relation to inspect:

- **Data** — a bounded, read-only preview. Select a cell to copy it.
- **Columns** — current types, nullability, defaults, and generated values.
- **Indexes** and **Constraints** — their exact catalog definitions.
- **Definition** — the exact view definition, or a clearly labeled reconstructed table structure.
  PostgreSQL does not retain the original migration statement for a table.

**Open in SQL** prepares an identifier-safe `SELECT` for the current relation. The SQL console
accepts one row-producing PostgreSQL statement (`SELECT`, `WITH`, `VALUES`, or `TABLE`), runs it in
a read-only transaction, and always rolls that transaction back. Use Cmd+Enter or Ctrl+Enter to
run it. Results can show 50, 100, or 200 rows and stop at the transfer-size limit. Query drafts and
the 20 most recent queries live only for the current Vetra Code session; they are not saved to
browser storage.

**Add schema to chat** and **Add result to chat** put a capped plain-text excerpt in the composer
without sending it. You can edit the context before asking the agent anything.

For local Powerhouse storage, the Database view reads only Powerhouse's atomic `snapshot.bin` and
restores it into temporary Vetra-owned storage. It never opens the working storage directory.
Snapshots are near-live rather than live: press **Refresh** after database changes. Snapshots over
512 MiB, older loose-file PGlite stores, in-memory stores, and unsupported snapshot versions show
setup guidance instead of being opened.

Postgres inspection is intentionally limited to loopback and local Unix-socket connections in
this version. Vetra Code keeps connection URLs and credentials on the server; they are never sent
to the browser. A privileged PostgreSQL function can still have side effects when invoked from a
`SELECT`, so use a least-privilege, read-only database role for inspection.

Database locations follow Powerhouse's standard environment settings. If you launch `ph vetra`
with a command-line-only `--db-path`, add the equivalent `DATABASE_URL`,
`PH_REACTOR_DATABASE_URL`, or `PH_SWITCHBOARD_DATABASE_URL` to the project's `.env` so Vetra Code
can discover it. A project-local `.env` value is used only when the Vetra Code server environment
does not already define that setting. Custom PGlite directories must stay inside the selected
Powerhouse project.

## Connecting to a reactor

Document explorer finds the reactor by itself. It tries the port from `powerhouse.config.json` when
one is set, then the standard ports. The status chip in the panel header shows the address it
connected to and the reactor's version. Select that chip at any time to retry, use a different
address, or return to automatic detection.

When no reactor answers, the panel says which addresses it tried and offers two ways forward: start
one with `ph reactor`, or enter the address of a reactor to use. An address you enter is remembered
for that project and is used as the only candidate — clear the field to go back to automatic
detection. URL credentials and query fragments are discarded because Explorer does not use them
for authentication.

A reactor that requires authentication may answer without showing any drives. The empty drive list
says so rather than claiming the reactor is empty.

Explorer works over remote and tunnelled connections: your Vetra Code server reaches the reactor,
so the reactor does not have to be reachable from your browser.

## Opening and closing panels

Open any of the three tools from the right panel's launcher, the **+** menu in the panel's tab bar,
or its **Open** action in the command palette. Every action adds a new tab. You can open the same
tool more than once, such as two Document models panels on different models or two Document
explorer panels on different documents. Close each tab with its close button like any other
surface.

To open one with a shortcut, assign a binding to **Powerhouse: Open Models**, **Powerhouse: Open
Explorer**, or **Powerhouse: Open Database** in **Settings → Keybindings**. They ship without
default bindings.
