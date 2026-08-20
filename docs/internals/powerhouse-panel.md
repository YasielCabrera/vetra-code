# Powerhouse panel architecture

> For maintainers. Using Vetra Code? See [docs/user](../user/).

Status: implemented

## Purpose

A read-only right-panel surface for developers working in [Powerhouse](https://github.com/powerhouse-inc/powerhouse)
projects. It has three modes behind one toggle:

- **Models** — document model definitions read from the project's working tree. Needs nothing
  running, and is the default and the fallback.
- **Explorer** — drives, documents, and operation history from a live reactor (switchboard) over
  GraphQL.
- **Database** — generated read-model and reactor database shape, using a point-in-time PGlite
  snapshot or a live local Postgres connection.

The panel is deliberately confined to modules that can be lifted out in one pass; see
[Removal map](#removal-map) below. Everything outside those modules is a short, named edit.

## Naming

Powerhouse ships its own unrelated package called `@powerhousedao/vetra` and a `ph vetra` CLI
command. Nothing in this surface is named "Vetra". The panel kind is `powerhouse` and the title is
"Powerhouse".

## Discovery

The panel exists only in workspaces that hold a Powerhouse project. Finding one is a server call
(`powerhouse.listProjects`), not a config-file read, because **the project is frequently not the
workspace root**: in a monorepo it is usually an app directory such as `apps/connect`, and there can
be more than one. A client cannot scan below the root, so it cannot answer this on its own.

`PowerhouseProject.listProjects` walks the workspace to `MAX_SCAN_DEPTH = 2` — enough for the
conventional `apps/<name>` and `packages/<name>` layouts — skipping dot-directories and
`node_modules`, `dist`, `build`, `out`, `coverage`, `target`, `vendor`, `tmp`, `.next`, `.turbo`,
`.cache`. A directory that has a config is recorded and **not** descended into: its subdirectories
are its models and editors, not more projects. The bounded result is cached for 60 s per workspace.

Every other RPC takes `cwd` (the workspace root) plus an optional `projectPath` (workspace-relative,
empty for the root). The server first applies the workspace's lexical path guard and then checks
canonical paths, so a path or symlink that escapes the workspace is rejected rather than followed.
The same canonical containment check protects the config, models directory, model directories, and
model files.

When a workspace has several projects the panel shows a picker in its header and remembers the
choice per workspace; mode and reactor address are remembered per _project_, since two projects run
two different reactors.

Two traps are handled in `parsePowerhouseConfig` (`packages/contracts/src/powerhouse.ts`):

- **Connect's same-named file.** Connect ships a _runtime_ config also called
  `powerhouse.config.json`, distinguished by a `schemaVersion` key. A project config never has one.
  A file carrying it reads as "not a Powerhouse project".
- **Configs that violate their own schema.** Powerhouse's `getConfig` swallows parse errors and
  returns defaults; real projects ship configs that do not validate. Parsing here is equally
  lenient: fields of the wrong type are dropped, not rejected. A file that is not JSON at all is
  still a Powerhouse project — the panel says so in its header and uses defaults.

When no project is found, the launcher card and the `+` menu entry are **omitted**, not dimmed, and
the `powerhouse.toggle` keybinding is a no-op. This deviates from the surrounding convention (other
surfaces render a disabled card with a hint) because a Powerhouse card in a non-Powerhouse repo is
never actionable.

## Why the server proxies the reactor

The reactor listens on a loopback port of the machine hosting the Vetra server. On a remote,
relay, or tunnel connection that is not the machine running the browser, so a browser-side
`fetch("http://127.0.0.1:4001")` would silently work for local users and fail for everyone else.

All reactor traffic therefore goes through typed RPCs. There is no generic HTTP proxy in this
codebase and this feature does not add one:

- The client passes a **base URL only**; `PowerhouseReactorClient` appends `/graphql` itself.
- The queries are fixed strings in the server module. A caller chooses which host answers, never
  what is asked of it.
- Only `http` and `https` are accepted; credentials, fragments, and query strings are stripped
  before an override is persisted or returned to the client.
- Every call has a timeout (3s per probe candidate, 10s for data) and a response size ceiling.
- Reactor identifiers, list-valued filters, and paging cursors are length-bounded at the RPC
  boundary.
- Every method requires the same read scope as `projectsReadFile`, which is strictly more
  sensitive than anything here.

## Connection discovery

`powerhouse.reactorProbe` resolves the address once; every other reactor RPC takes the resolved
`url`. Candidates, in order:

1. The user's explicit override, **alone** — an override that silently fell back would report a
   connection to somewhere the user did not ask for.
2. `http://127.0.0.1:<reactor.port from powerhouse.config.json>`.
3. `http://127.0.0.1:4001` — the `ph` CLI and `ph init` scaffold default.
4. `http://127.0.0.1:4000` — reactor-api's default when embedded as a library rather than run by
   the CLI.

A candidate is identified by `{ system { version gitHash gitUrl } }`, answered by the reactor's
SystemSubgraph on `/graphql`. `/health` is deliberately not used: it returns a bare `OK` and
identifies nothing. The probe distinguishes _nothing listening_ (`unreachable`), _a listener that
did not answer in time_ (`timeout`), and _something listening that is not a reactor_
(`not_a_reactor`), because those are different problems for the user.

The connection chip remains interactive after a successful probe. Its popover uses the same URL
form as the offline state, so an override is a reversible choice: users can replace it, retry it,
or return to autodetection without first stopping the reactor.

## Database inspector

The database feature is implemented entirely in Vetra Code. The Powerhouse repository and the
selected Powerhouse project are read-only inputs: no Powerhouse source is imported, vendored,
patched, or written. `PowerhouseDatabaseInspector` is the deep server module. Its six-operation
interface owns discovery, catalog reads, relation detail, previews, query execution, and snapshot
refresh; PGlite snapshots and Postgres are private adapters behind that seam.

Every database RPC takes only `cwd`, optional `projectPath`, a logical target (`read_models` or
`reactor`), and — where applicable — a catalog relation identifier or SQL text. It never accepts a
path or connection URL. This keeps local filesystem and database authority on the environment
server, which also makes the feature behave identically for local, relay, tunnel, and desktop
clients. The browser never receives database locations or credentials, and errors are reduced to
credential-free structured failures before encoding.

### Discovery

Discovery mirrors the current `ph vetra`/Switchboard precedence:

- Read models: `DATABASE_URL`, then `PH_SWITCHBOARD_DATABASE_URL`, then `.ph/read-storage`.
- Reactor: `PH_REACTOR_DATABASE_URL`, then `PH_SWITCHBOARD_DATABASE_URL`, then
  `.ph/reactor-storage`.

For each allowlisted variable, the Vetra server environment wins over the selected project's
`.env`; no other `.env` values are retained. Project configuration still determines which nested
Powerhouse project is selected. PGlite directories are resolved canonically and must stay inside
that project. The storage directory and `snapshot.bin` must be real directories/files rather than
links. Postgres URLs are accepted only for loopback IPv4/IPv6, `localhost`, or an absolute local
Unix-socket `host` parameter. Discovery results contain backend, status, source class, and snapshot
mtime, never the configured value.

A path supplied only to `ph vetra --db-path` is inherently undiscoverable outside that process.
The missing state tells the user which standard variable to add instead of probing the filesystem
or process table. Empty/in-memory URLs, project-external PGlite paths, loose-file legacy stores,
remote Postgres, and oversized snapshots are explicit unsupported states.

### Atomic PGlite snapshots

Powerhouse's current `AtomicNodeFs` keeps the working PGlite filesystem in memory and atomically
renames a complete `snapshot.bin`. Opening the live storage path with another PGlite instance would
therefore be both inaccurate and unsafe. Vetra opens the current snapshot with `O_NOFOLLOW` and
keeps that descriptor while decoding, so a concurrent atomic rename cannot mix two snapshots.

The Vetra-owned decoder supports format version 1 (`PGLA`, version, entry count, then typed/mode/path/
length/data entries). It streams file bytes rather than loading up to 512 MiB into another buffer,
and validates the header, supported version, entry count, entry and path lengths, UTF-8, duplicate
paths, traversal, containment, types, truncation, trailing bytes, and `PG_VERSION`. Unknown format
or PostgreSQL versions are rejected rather than guessed. Restored files live under a unique
Vetra-owned temporary directory; cleanup refuses any path outside that exact temp prefix.

`PG_VERSION` selects the installed Powerhouse runtime: PostgreSQL 16 resolves
`pglite-legacy-02`, while PostgreSQL 17 resolves `@electric-sql/pglite`, both starting from the
selected project's installed `@powerhousedao/ph-cli`/Switchboard dependency graph. Vetra does not
depend on or copy `@powerhousedao/pglite-fs`. The restored database opens in an isolated Node child
using an inline protocol, so the server and desktop bundle have no helper asset to lose. Every
request runs `BEGIN TRANSACTION READ ONLY`, establishes the fixed statement timeout, reads through
a cursor, and rolls back. Interrupting the RPC terminates that captured child process, never a PID
found by pattern.

At most two restored sessions exist. They expire opportunistically after five idle minutes — no
timer or polling loop — and are removed on explicit refresh, LRU eviction, interruption, and server
scope shutdown. A cached session retains the mtime from the exact inode it restored, so the UI does
not claim newer source bytes are already loaded.

### Postgres and SQL

Postgres uses one `pg` client and `pg-cursor` per operation. It opens `BEGIN READ ONLY`, sets the
10-second local statement timeout with fixed SQL, performs a fixed probe query, reads at most the
requested rows plus one through a cursor, closes the cursor, and rolls back even after success.
RPC interruption closes the client. A local role can still expose a side-effectful function through
`SELECT`; the user documentation therefore recommends a least-privilege read-only role rather than
claiming transaction mode is an absolute sandbox.

The SQL-console scanner understands comments, quoted strings and identifiers, and dollar-quoted
text. It accepts one `SELECT`, `WITH`, `VALUES`, or `TABLE` statement, permits one final semicolon,
and rejects extra statements, transaction control, DDL/DML, `COPY`, `CALL`, and `DO`. Mutating CTEs
are rejected before execution; Postgres read-only mode is the second boundary. SQL is capped at 64
KiB, output at 200 rows and 2 MiB, and every cell becomes a JSON-safe string or null. SQL syntax
errors retain useful database wording after configured URLs and paths are redacted.

Catalog and relation inspection use fixed `pg_catalog` statements. Catalogs include schemas,
relation kinds, and approximate `reltuples`; relation detail uses `format_type`, `pg_get_expr`,
`pg_get_indexdef`, `pg_get_constraintdef`, and `pg_get_viewdef`. View text and each index/constraint
definition are exact catalog output. A table's `CREATE TABLE` is explicitly labeled reconstructed,
because Postgres does not preserve its original migration statement.

The typed RPC surface is:

- `powerhouse.databaseDiscover`
- `powerhouse.databaseCatalog`
- `powerhouse.databaseGetRelation`
- `powerhouse.databasePreviewRelation`
- `powerhouse.databaseExecuteQuery`
- `powerhouse.databaseRefreshSnapshot`

Database UI state follows the existing panel ownership. Mode remains a persisted per-project
preference; target, relation, SQL draft, row limit, and a deduplicated 20-query history are
session-only Zustand state excluded from persistence. CodeMirror and PostgreSQL completion are a
lazy child chunk loaded only when SQL is opened. Completion is derived from the already loaded
catalog. There is no database polling. “Add schema/result to chat” inserts capped plain text through
the existing composer handle and never sends a turn.

The deliberate limitations are point-in-time rather than exact-live PGlite data, snapshot restore
disk/WASM cost, dependence on an internal snapshot version, no CLI-only or external PGlite paths,
no loose-file/in-memory PGlite, no remote Postgres, and no reliable processor-name mapping for
hashed read-model schemas. The next high-leverage improvement is catalog-signature diffing between
refreshes/checkpoints, followed by Find in code and visual `EXPLAIN`; a generic admin iframe would
not handle Powerhouse PGlite and would add another authentication/process boundary.

`PortScanner` is untouched. Its probe only accepts `text/html` — it would reject a reactor — and it
polls `lsof` every three seconds for the preview feature. The Powerhouse module probes on demand
only: opening the Explorer, or pressing Retry.

## Reactor facts worth knowing

Verified against `packages/reactor-api` in the Powerhouse repo. These are the non-obvious ones:

- **There is no `drives` query.** The `{ drives { id name } }` in `ph-cli`'s help text is stale.
  Drives are documents whose `documentType` is `powerhouse/document-drive` or
  `powerhouse/reactor-drive`, so `listDrives` runs `findDocuments(search: { type })` once per type
  and merges. Every in-repo drive listing (the MCP tool, reactor-browser, the gateway's ownership
  cache) does the same.
- **`totalCount` is the page length, not a total.** The panel never renders "N of M"; it renders
  "N loaded".
- **`SearchFilterInput.identifiers` and `PagingInput.offset` are ignored by the resolvers.** Only
  `type`, `parentId`, `cursor`, and `limit` do anything natively. Explorer compensates for the
  advertised identifier filter; see [Document filtering](#document-filtering).
- **`findDocuments` never returns a `cursor`**, capped result or not, so its `limit` is the only
  paging control there is. `documentOperations` does return one. See [Paging](#paging).
- **Operation fields are nested.** `ReactorOperation` carries `index`, `timestampUtcMs` (a String),
  `hash`, `skip`, and `error`; the type, input, and scope live under `action`. The server lifts them
  out so the contract stays flat. In particular, the reactor GraphQL type has no `deniedReason`
  field even though similarly named internal operation types may have one.
- **The reactor's own `documentModels` query is a poor Models source** and is deliberately unused:
  its adapter returns `specifications[0]` — the _oldest_ spec — hardcodes `version: null`, and
  derives `namespace` by splitting the display name. Disk is the source of truth for Models. Do not
  "simplify" Models mode onto it.
- **Auth is opt-in and off by default.** When it is on, an unauthenticated POST yields an anonymous
  context rather than a 401, so the Explorer can be connected and still see nothing. The empty
  drive list says so instead of claiming the reactor is empty.

## Document filtering

The document-list RPC mirrors both filter inputs accepted by `findDocuments`:

- `SearchFilterInput`: `type`, `parentId`, and `identifiers`.
- `ViewFilterInput`: `branch` and `scopes`.

`PagingInput.limit`, `offset`, and `cursor` are list mechanics rather than user filters. Limit and
cursor remain internal to the bounded auto-paging path; offset is not sent because the resolver
ignores it.

The exact API filters live behind the Explorer's filter builder. It progressively reveals only the
fields the user selects, presents the API's fixed matching semantics as field/operator/value
conditions, and keeps applied conditions individually editable and removable below search. Parent
defaults to the open drive or folder unless the user supplies an override. At reactor root, type,
parent, or identifiers can start a document result set; branch and scopes alone wait until
navigation supplies a parent. The selected view is also passed to `document` and folded into the
matching branch/scope fields on `documentOperations`, so opening a result does not silently switch
back to the default view.

The document-type condition reuses the environment-scoped document-model listing that backs the
Models tab, then adds the built-in `powerhouse/document-drive`, `powerhouse/reactor-drive`, and
`powerhouse/folder` identifiers. Built-ins remain selectable when the project catalog cannot load,
and an explicit custom-value option preserves access to reactor types not declared by the current
project.

Branch and scope conditions expose Powerhouse's canonical values instead of requiring recall.
`main` is the document header default and the reactor's fallback branch. `global` and `local` are
the model-state scopes every document starts with; `document`, `auth`, and `header` are grouped
separately as engine-owned scopes. Branch remains single-select, scopes use a multi-select chip
control, and both accept an explicit custom value for project-specific behavior. An absent scope
condition intentionally means all scopes, so adding the condition never silently preselects a
subset. The model-list summary and reactor API expose no branch/scope catalog, which is why the
canonical choices are local UI metadata rather than another network request.

The schema/resolver mismatch around identifiers needs a compatibility path:

- With a parent, the server sends `identifiers` for future resolvers, asks for the bounded parent
  result, and exact-matches the returned IDs and slugs itself for today's resolver.
- Without a parent, the server resolves each deduplicated identifier through the fixed
  `document(identifier:)` summary query, at concurrency 8, and applies an optional type match. It
  deliberately does not fetch document state for a result row.

Filter arrays hold at most 100 values. Parent-backed searches are still subject to the 500-document
bound and say when matches beyond that window may have been omitted.

The main search field is deliberately local: it AND-matches words case-insensitively across the
loaded name, slug, ID, and document type. `useDeferredValue` keeps typing urgent while as many as
500 summaries are narrowed. The local query never causes websocket traffic. Filter and query state
are session-only and reset when the selected project or resolved reactor URL changes.

## Document models on disk

The layout is rigid and enforced by Powerhouse's own codegen
(`packages/codegen/src/utils/syntax-getters.ts`): `<documentModelsDir>/<name>/<name>.json`, one
level deep, filename matching the directory. A directory whose JSON file is named anything else is
reported as `missing_json` rather than silently skipped.

Versions are repeated entries in a single file's `specifications` array, not separate files. The
list row summarizes the newest (highest `version`, last entry breaking ties); detail offers a
picker when there is more than one.

One unreadable model never blanks the list: per-file problems come back as `failures` entries and
render inline beside the models that did load. Config files are capped at 256 KB and individual
model files at 2 MB before their contents cross the websocket.

### State schema diagrams

Global and local state SDL default to the existing highlighted source view, now numbered so a type
or field can be cited by line. The gutter is a single sticky, non-selectable text node holding every
number rather than an element per line, so a several-thousand-line schema adds no per-line layout
work and copying the schema never picks the numbers up. Counting newline separators matches Shiki,
which keeps a trailing empty line for source that ends in a newline. Numbering is opt-in per code
surface, so the compact operation-input and document-state previews stay unnumbered.

Selecting **Diagram** crosses a lazy boundary that loads GraphQL.js, React Flow, and Dagre only for
that view. GraphQL.js provides the specification parser; the local projection merges type extensions
and records field, field-argument, interface, and union-member relationships. Dagre calculates a
left-to-right directed layout, then React Flow supplies the read-only pan and zoom canvas. Nodes and
controls use the same semantic CSS variables as the rest of the panel, including custom light and
dark themes.

The projection excludes undeclared built-in scalars, bundles every source/target pair into one
labeled edge, and keeps the source view as the canonical textual representation. Work is bounded
before layout: 500,000 source characters, 80,000 parser tokens, 150 declarations, 500 relations,
16 initially visible rows per declaration, and 3 visible labels per relation. All declaration rows
remain in the parsed model; the final row expands or collapses one declaration at a time and reruns
Dagre only after that explicit action. A declaration can also be toggled by double-clicking it.
React Flow otherwise sets a non-selectable node wrapper to `pointer-events: none`, so the canvas
registers a node click handler even though the row owns the single-click action; removing that
handler makes the visible expansion button unreachable. Any remaining simplification is stated
below the canvas. Invalid or over-budget SDL becomes a contextual diagram error without affecting
source view.

PNG export follows React Flow's full-graph capture pattern. It temporarily disables visible-node
virtualization, calculates the complete node bounds and fitted viewport, then dynamically imports
the React Flow-recommended `html-to-image@1.11.11` to capture only the graph viewport. Controls are
not exported. The shared render returns an `image/png` blob: download gives that blob a temporary
object URL, while copy writes it as a `ClipboardItem`. Copy passes the still-pending render promise
to `clipboard.write` synchronously from the menu action so browsers with strict transient-activation
rules accept it. The composer already treats pasted `image/*` clipboard files as attachments. The
current theme and expansion state are preserved, while output is capped at 8,192 pixels on either
axis and 16 megapixels to avoid oversized browser canvases. Normal diagram use does not load the
export library or render offscreen nodes.

## Dragging items into the composer

Panel rows are drag sources for the chat composer. The composer side needed no changes: it reads
the `application/x-vetra-code-composer-mention` drag type
(`apps/web/src/components/chat/composerMentionDrag.ts`) and appends whatever string it carries to
the end of the prompt, discriminating only on MIME type. So this is a source-only feature living
entirely in `powerhouseDragMention.ts`, which imports that one constant — a one-way dependency, so
the removal map below is unchanged.

Two payload shapes, because the two modes address different things:

- **Models get a mention of their directory**, not of the `<name>.json` inside it. The JSON is only
  the specification; the generated types and the reducers beside it are part of the same model, and
  the layout is identical for every model. The path is composed lexically from `projectPath`, the
  configured `documentModelsDir`, and `directoryName` — all already in scope in `ModelsView` — then
  run through `serializeComposerFileLink`, so it renders as the same chip a folder drag from the
  Files panel produces. A configured directory that is absolute or climbs out of the workspace
  yields no mention and the row is simply not draggable, matching the file tree's "no mention, no
  drag" rule.
- **Reactor items get a text reference**: `` `powerhouse:doc/<id>` `` plus the name, type, crumb
  path, and reactor URL. There is no path to link and no per-document HTTP endpoint to point at,
  and a markdown link with an invented `powerhouse://` destination would not even render as a chip
  — `composerInlineTokens.ts` rejects destinations carrying an external URI scheme. Fields that
  would only repeat the token are omitted: the name when it fell back to the id, the type for
  drives and folders, the slug when it is already the id or the display name.

The reactor URL in a reference is a loopback address on the machine hosting the Vetra server, which
is also the machine the agent runs on — so it is correct for the agent even when the browser is
remote.

`onDragStart` sets `effectAllowed = "move"` to match the `dropEffect = "move"` the composer answers
with; any other pairing makes the browser cancel the drop with no error and no `drop` event. Only
the custom type is written — no `text/plain` — and no `dragend` bookkeeping is needed, because the
panel has no row selection for a drag to disturb.

### Why the reference grammar lives in the composer

A dropped reference renders as a chip, so the composer has to read the text back. That makes the
reference a grammar, not a string the panel formats — and grammars need one owner. Both halves
therefore live in `packages/shared/src/composerInlineTokens.ts` beside the file-link reader:
`serializePowerhouseReference` writes one and the token collector reads one back, with a test that
round-trips every combination of present and absent facts through both. The panel only decides
_which_ facts are worth carrying.

Facts are emitted in a fixed order — name, type, slug, path, reactor URL — with empty ones left
out. The parser reads them back from the right: the URL is always last, `slug` and `in` announce
themselves with a prefix, a type slot exists only for a `doc`, and whatever survives on the left is
the name. That is why the reference needs no field labels and still cannot be misread, and why a
name containing the `·` separator survives intact.

A reference is one collapsed character to the composer's cursor arithmetic, exactly like a file
mention — see the shared `mention`/`powerhouse` arm in `apps/web/src/composer-logic.ts`. The chip
node keeps the reference's whole source text, because that, not the label, is what the agent
receives.

Two deliberate limits:

- **The transcript renders a sent reference as text, not a chip.** Only markdown-link mentions chip
  in `ChatMarkdown`; a bare `@path` mention is plain text there too, so this matches. Making it a
  chip means matching across sibling markdown nodes, since a reference is inline code followed by a
  parenthesized run.
- **`resolveInlineCodeFileLinkMeta` must keep rejecting a reference.** Resolving one as a file would
  render a chip linking nowhere. The shape checks already reject it — an id has no explicit path
  prefix — and `apps/web/src/markdown-links.test.ts` pins that, including ids that carry a dot.

## Live updates

The panel does not subscribe. The reactor exposes `documentChanges` over graphql-ws
(`/graphql/subscriptions`) and SSE (`/graphql/stream`), but relaying that reactor → server → client
websocket would multiply traffic for a read-only diagnostic surface, and websocket volume is this
repo's most common performance regression. The panel uses unary RPCs behind the shared SWR atom
layer: 30s stale time for disk data, 15s for the probe, 10s for reactor data, plus explicit refresh
controls. A failed refresh retains the most recent successful result and labels it as stale instead
of blanking the panel. Database catalog reads are similarly manual; refreshing a PGlite target is
the explicit moment a new atomic snapshot is restored. Subscriptions can be added later without
changing the contract.

## Paging

**`findDocuments` never issues a cursor.** It honours `limit` — verified against a live 6.2 reactor,
where `limit: 5` returns 5 items and `limit: 1000` returns everything — but `cursor` comes back
`null` whether or not the result was capped, and `PagingInput.offset` is ignored by the resolvers. So
there is nothing to page with, and a parent/type document listing is one bounded request:
`listDocuments` asks for `MAX_DOCUMENTS = 500` and reports `truncated` when a full result arrives
with no cursor to follow, matching how `listDrives` bounds itself at 500. A client that names a
smaller `limit` only hides children, so the panel names none. Identifier-only lookup is a separate
bounded fan-out described above and has no paging cursor.

`documentOperations` **does** issue one (`c:{"global":"1"}`-shaped) when it caps a result, so the
operation log genuinely pages.

The cursor plumbing stays on both paths: the contract carries `nextCursor`, and the day
`findDocuments` starts issuing one the document list pages without another change.

`useListEndAutoLoad` observes a sentinel placed after the last row and appends the reactor's next
cursor whenever that sentinel comes within `256px` of the viewport, so a list keeps growing as it is
read and there is no Load more button. With today's reactor that drives the operation log; for
documents it is inert, because there is never a next cursor to follow.

An `IntersectionObserver` rather than a scroll listener, because a scroll handler on a list this
long runs per frame and this repo's most common performance regression is exactly that. Cost scales
with what someone actually scrolls past: a drive holding thousands of documents opens in one request,
same as a small one. Eagerly walking every cursor was considered and rejected — it turns opening a
large drive into dozens of sequential round trips and a list nobody asked to render.

`canAutoLoadNextPage` is the whole guard, and the run stops on any of:

- The reactor reported no next cursor.
- A page came back empty. A reactor that hands out a non-null cursor forever cannot spin the list,
  because `useCursorPages` treats an empty page as the end.
- A page is in flight, so one visible sentinel cannot queue the same cursor twice.
- A page failed. Auto-retrying a reactor that just refused would hammer it; the inline notice and
  the list's reload control are the way forward instead.

## Payload guards

Document `state` and operation `input` are unbounded JSON that crosses the client websocket:

- A document `state` that serializes past 512 KB is dropped and reported as `stateTruncated`; the
  panel says the state was too large rather than showing nothing.
- An operation `input` that serializes past 256 KB is dropped and reported as
  `actionInputTruncated`; retained inputs across one operation page are capped at 512 KB.
- A document model file larger than 2 MB is reported beside the models that did load.
- Model, drive, and per-parent document listings stop at 500 entries and report that they were
  truncated; summary text, identifiers, metadata, and cursors are independently length-bounded.
- Document detail keeps at most 100 revisions and 500 child identifiers, with explicit truncation
  flags for both.
- Syntax-highlighted SDL and JSON previews stop at 100,000 characters and label the omitted tail,
  keeping unusually large valid payloads from monopolizing the renderer.
- State schema diagrams parse at most 500,000 source characters or 80,000 tokens and render at most
  150 declarations, 500 relations, 16 rows per declaration, and 3 labels per relation. Diagram code
  is lazy-loaded and every cutoff is labeled.
- Model detail renders at most 100 version controls, 100 modules, 500 operations, and 500
  change-log entries at once. Each cutoff is explicit, so a syntactically valid model made of
  thousands of tiny entries cannot freeze the right panel.
- Operation page limits are clamped to 100 server-side; the panel requests 50. Document listings
  clamp to 500 instead, since they cannot be paged.
- `listDrives` walks at most 10 pages per drive type.
- Response bodies are capped at 8 MB before decoding.
- Database snapshots are capped at 512 MiB, SQL at 64 KiB, results at 200 rows and 2 MiB, restored
  sessions at two, and statements at 10 seconds.

## Removal map

Delete these six units and the feature is gone:

1. `packages/contracts/src/powerhouse.ts`
2. `apps/server/src/powerhouse/`
3. `packages/client-runtime/src/state/powerhouse.ts`
4. `apps/web/src/state/powerhouse.ts`
5. `apps/web/src/components/powerhouse/`
6. `docs/internals/powerhouse-panel.md`, `docs/user/powerhouse-panel.md`

Then remove these small integration edits:

| File                                                  | Edit                                                                                                          |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/rpc.ts`                       | import block, 14 `WS_METHODS` entries, 14 `Rpc.make` consts, 14 `WsRpcGroup` entries                          |
| `packages/contracts/src/index.ts`                     | one re-export                                                                                                 |
| `packages/contracts/src/keybindings.ts`               | `"powerhouse.toggle"` in `STATIC_KEYBINDING_COMMANDS`                                                         |
| `apps/server/src/auth/RpcAuthorization.ts`            | 14 entries in `RPC_REQUIRED_SCOPES`                                                                           |
| `apps/server/src/ws.ts`                               | import plus one `...powerhouseHandlers` spread                                                                |
| `apps/server/src/server.ts`                           | imports, `PowerhouseLayerLive`, one `Layer.provideMerge`                                                      |
| `apps/server/src/server.test.ts`                      | layer entries in `buildAppUnderTest`, one e2e test                                                            |
| `apps/server/src/auth/RpcAuthorization.test.ts`       | one scope test                                                                                                |
| `apps/web/src/rightPanelStore.ts`                     | kind, surface variant, `singletonSurface` arm                                                                 |
| `apps/web/src/components/RightPanelTabs.tsx`          | `Zap` import, 2 props, launcher card, `+` menu item, title and icon switch arms                               |
| `apps/web/src/components/RightPanelTabs.test.tsx`     | fixture props, launcher visibility tests                                                                      |
| `apps/web/src/components/ChatView.tsx`                | lazy import, detection hook, `addPowerhouseSurface`, keybinding arm, render branch, props at both mount sites |
| `apps/web/src/components/CommandPalette.tsx`          | availability query and one toggle action                                                                      |
| `apps/web/src/routes/_chat.pull-requests.tsx`         | two no-op props                                                                                               |
| `apps/web/src/rightPanelStore.test.ts`                | two tests                                                                                                     |
| `packages/client-runtime/package.json`                | one subpath export                                                                                            |
| `apps/server/package.json`, `apps/web/package.json`   | database adapter and lazy SQL-editor dependencies                                                             |
| `packages/shared/src/composerInlineTokens.ts`         | the `powerhouse` token variant, its grammar, and its serializer                                               |
| `apps/web/src/composer-editor-mentions.ts`            | one `ComposerPromptSegment` variant and its arm                                                               |
| `apps/web/src/composer-logic.ts`                      | `"powerhouse"` in the two cursor arms                                                                         |
| `apps/web/src/components/ComposerPromptEditor.tsx`    | `ComposerPowerhouseNode`, its decorator, and its registration                                                 |
| `apps/web/src/components/composerInlineTokenPaste.ts` | the `createPowerhouseNode` option                                                                             |
| `apps/web/src/components/chat/PowerhouseTagChip.tsx`  | delete                                                                                                        |

`RIGHT_PANEL_STORAGE_VERSION` was **not** bumped. The right-panel migration is a normalizer that
passes unknown kinds through, and no persisted state could contain `powerhouse` before this change.
An older client reading state that contains the surface renders a blank-titled tab — degenerate but
not a crash.

## Testing

No running Powerhouse project is needed anywhere:

| Area                       | How                                                                                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Config and payload schemas | `packages/contracts/src/powerhouse.test.ts`                                                                      |
| Model file parsing         | `apps/server/src/powerhouse/documentModelFile.test.ts`, inline JSON                                              |
| Disk reads                 | `apps/server/src/powerhouse/PowerhouseProject.test.ts`, temp-dir fixture projects                                |
| Reactor client             | `apps/server/src/powerhouse/PowerhouseReactorClient.test.ts`, a hand-built `HttpClient` answering canned GraphQL |
| RPC wiring                 | one e2e case in `apps/server/src/server.test.ts`                                                                 |
| Project discovery          | `PowerhouseProject.test.ts`, including a monorepo fixture with the project under `apps/`                         |
| Database discovery         | `PowerhouseDatabaseInspector.test.ts`, including precedence, containment, monorepos, local Postgres, redaction   |
| Snapshot decoder           | `powerhouseDatabaseSnapshot.test.ts`, PG16/17, malformed/traversal/truncation/version/size/source-integrity      |
| SQL guard                  | `powerhouseDatabaseSql.test.ts`, statement classes, quoting, multiple statements, size                           |
| Panel state and copy       | `apps/web/src/components/powerhouse/*.test.ts`                                                                   |
| Database panel logic       | `apps/web/src/components/powerhouse/database/databaseViewLogic.test.ts`                                          |
| Schema diagram projection  | `apps/web/src/components/powerhouse/models/graphqlSchemaDiagram.test.ts`                                         |
| Composer drag payloads     | `apps/web/src/components/powerhouse/powerhouseDragMention.test.ts`                                               |
| Reference grammar          | `packages/shared/src/composerInlineTokens.test.ts`, round-trip over every fact combination                       |
| Reference chip and cursors | `apps/web/src/composer-logic.test.ts`, `apps/web/src/components/ComposerPromptEditor.test.ts`                    |
| Auto-paging guard          | `apps/web/src/components/powerhouse/powerhouseQuery.test.ts`                                                     |
| Document filter logic      | `apps/web/src/components/powerhouse/explorer/*.test.*`                                                           |
| Panel entry points         | `apps/web/src/rightPanelStore.test.ts`, `RightPanelTabs.test.tsx`                                                |

For a manual pass, open a monorepo whose Powerhouse app lives under `apps/`, inspect at least one
model detail, then run `ph reactor` or `ph switchboard` in that app and walk a drive, document,
operation, and state in Explorer. In Database, inspect both targets, refresh a snapshot, walk every
relation tab, run a bounded query, and add schema/result context to the composer without sending.
Check both themes and both the inline and maximized panel widths.
