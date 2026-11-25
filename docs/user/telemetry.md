# Product usage data

Product usage collection is off by default. To enable it, set `VETRA_TELEMETRY_ENABLED=true`
and `VETRA_POSTHOG_KEY` for your own PostHog project before starting the server. Use
`VETRA_POSTHOG_HOST` to configure a different PostHog host.

When enabled, the Vetra Code server sends events associated with a hashed account or installation
identifier. To count how many installations one person uses, the server also sends hashed account
identifiers: your Vetra Connect account, your OpenAI and Claude accounts when you are signed in,
and a random identifier for each device that connects. Events include the provider, model,
reasoning effort, permission mode, turn result, duration, release channel, and main-agent token
totals when available.

Product events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, child-agent output, or identifiers from your provider accounts. The one exception is [agent feedback](#agent-feedback),
which is off unless you turn it on.

## Agent feedback

Agent feedback lets agents tell the T3 team about Vetra Code: a Vetra Code tool or `vetra` command that did not
do what they expected, a confusing instruction, or a missing capability. Choose a mode in
**Agent feedback** in **Settings > Labs**:

- **Off**, the default: agents do not see the feedback tools, and `vetra feedback` stops with a
  message pointing to Labs.
- **When I ask**: agents send a report only when you ask them to, about anything in Vetra Code.
- **Automatic**: agents also report Vetra Code problems they hit on their own, such as a Vetra Code tool that
  failed and made them find another way. These go out without asking you, so they carry only the
  kind of problem and the tool or command it concerns, with no agent-written text, outline, or
  conversation. `vetra feedback --kind bug --subject "t3 thread send" --expected "…" --actual "…"`
  sends one the same way, so it works only in this mode.

When you ask your agent for a report, in either mode, Vetra Code shows it in the thread as a card
with exactly what would leave your machine, and sends it only if you press **Send**. The agent
carries on without waiting and never learns your answer. The card stays open until you answer it,
even after the turn ends or the server restarts; **Don't send** sends nothing, and the agent is
told not to send it another way. Only someone who can run agents on that machine can answer the
card; people on a guest link cannot.

Each report has the kind of problem, the Vetra Code tool or command it concerns (or `general`), and, when
you send it from a card, up to 300 characters each of expected behavior, actual behavior, and
workaround, written by the agent, which is told not to quote your messages or code. The agent also says how many recent turns the
problem spans. A report you approved carries an outline of those turns, and of at least the last 5,
from when the agent asked: who spoke, how long each message was, and which tools ran, whether they
worked, and how long they took. The outline has no text. Tools from your other MCP servers appear
only as `mcp`. Turn on **Include the conversation** in the card to attach the text of your
messages and the agent's replies in the turns the problem spans, up to 1,000 characters per
message and 16 KB in all, oldest text dropped first; the card shows that text before you send it.
To change a report, such as the turns it covers, ask the agent in the chat: it shows a new card,
and you can decline the old one. Tool inputs and outputs, files, and attachments are never sent. An agent can
show you at most 3 report cards and send 3 reports on its own per turn, and `vetra feedback` can
send at most 10 an hour.

Before anything is saved, Vetra Code removes file paths (when text mentions one, the rest of that line
goes with it), your user name, machine name, project title, branch, and git remote, and anything
that looks like a key, token, email address, or URL with a password. It cannot recognise your code
or a name written in a sentence, so only include the conversation when it holds nothing you would
not send. Reports from agents also name the provider and the model. No thread IDs or project IDs
are sent, and each report goes out under its own random ID, so reports cannot be tied to your
installation or to each other.

Reports are saved on your machine first, and a declined one is not saved at all; its card keeps
only what you would have sent without the conversation. When product usage
data is turned off, saved reports stay there and are not sent. `vetra feedback list` shows recent
reports, the thread each came from, and a line for each outline; `vetra feedback list --json` shows
exactly what each one holds.

## Relay connection diagnostics

Vetra Code sends relay connection traces only when tracing is configured for Vetra Connect. These are
separate from product events. Depending on the client version, traces can include connection
timings, environment identifiers and the connected machine's name. Failed spans can include error
messages and stack traces; error text can quote a value the app was handling.

To disable product events and relay tracing from the server, set
`VETRA_TELEMETRY_ENABLED=false` in its environment before starting it. Relay tracing also stops
when `VETRA_OTEL_SDK_DISABLED` or `OTEL_SDK_DISABLED` turns OpenTelemetry export off.

On a CI runner, the server sends no product events or relay traces by default. It treats a run as
CI when a common CI variable is set, such as `CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, or `JENKINS_URL`.
`CI=false` and `CI=0` do not count. To send them from CI anyway, set
`VETRA_TELEMETRY_ENABLED=true`.

An administrator can turn product events and relay tracing off in the server and desktop app with
a [managed policy](./managed-policy.md#other-capabilities). This does not control traces sent by
the hosted web app or mobile clients.

The desktop app reads `VETRA_TELEMETRY_ENABLED` from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.

The web app in a browser, including one the `vetra` CLI opens, does not read these environment
variables. When its build has relay tracing configured, it sends its own connection traces even
if the server has opted out. The browser app has no relay tracing toggle.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`VETRA_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `VETRA_OTLP_*_URL`, set `VETRA_OTLP_HEADERS` for
receivers that need authentication and `VETRA_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
