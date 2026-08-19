# Inspect Powerhouse projects

Open **Powerhouse** in a thread's right panel to read a Powerhouse project's document models and,
when one is running, browse the data in its reactor. The panel is read-only; editing documents
stays in Connect.

The surface appears only in workspaces that contain a Powerhouse project — one with a
`powerhouse.config.json`. That project does not have to be the workspace root: in a monorepo it is
usually an app directory such as `apps/connect`, and the panel finds it there. Workspaces without
one never show the panel.

When a workspace holds more than one Powerhouse project, a **Project** picker appears at the top of
the panel; your choice is remembered per workspace, and each project keeps its own mode and reactor
address.

## Models

**Models** lists the document models declared in the project's models directory — `./document-models`
unless the config says otherwise. Each row shows the model's name, file extension, newest version,
and how many modules and operations that version defines.

Open a model to inspect its definition:

- Its GraphQL schema for global state, and for local state when it declares one.
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

Models come from the working tree, so this mode works with nothing else running. Press the refresh
button after changing a model on disk.

Drag a model row onto the chat composer to reference it in a prompt. It arrives as a link to the
model's directory, not just its `<name>.json`, so the agent sees the specification, the generated
types, and the reducers together.

## Explorer

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

Open **Filters** for the exact fields supported by Switchboard:

- **Document type** — for example `powerhouse/todo`.
- **Parent identifier** — overrides the open drive or folder; at the root it can address a parent
  directly.
- **Identifiers** — exact document IDs or slugs, separated by commas or new lines.
- **Branch** and **Scopes** — choose the document view Switchboard returns. That same view follows
  into document state and operation history.

At the reactor root, a document type, parent identifier, or identifier search opens document
results across the reactor. Branch and scope alone take effect after you enter a drive, because
Switchboard requires at least one document search criterion. Applied filters stay visible below the
search field and can be cleared together.

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

## Connecting to a reactor

Explorer finds the reactor by itself: the port from `powerhouse.config.json` if it sets one, then
the standard ports. The status chip beside the mode toggle shows the address it connected to and
the reactor's version. Select that chip at any time to retry, use a different address, or return to
automatic detection.

When no reactor answers, the panel says which addresses it tried and offers two ways forward: start
one with `ph reactor`, or enter the address of a reactor to use. An address you enter is remembered
for that project and is used as the only candidate — clear the field to go back to automatic
detection. URL credentials and query fragments are discarded because Explorer does not use them
for authentication.

A reactor that requires authentication may answer without showing any drives. The empty drive list
says so rather than claiming the reactor is empty.

Explorer works over remote and tunnelled connections: your Vetra Code server reaches the reactor,
so the reactor does not have to be reachable from your browser.

## Opening and closing the panel

Open it from the right panel's launcher, the **+** menu in the panel's tab bar, or **Toggle
Powerhouse panel** in the command palette. It closes from the tab's close button like any other
surface.

To open and close it with a shortcut, assign one to the **Powerhouse: Toggle** command in
**Settings → Keybindings**. It ships without a default binding.
