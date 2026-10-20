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

Events do not include prompts, responses, file contents, authentication tokens, conversation IDs,
raw provider events, or child-agent output. Child-agent token use is excluded from the totals.

Vetra Code sends relay connection traces only when relay tracing is configured for Vetra Connect.

To disable product events and relay tracing, set `VETRA_TELEMETRY_ENABLED=false` in the server's
environment before starting it. Relay tracing also stops when `VETRA_OTEL_SDK_DISABLED` or
`OTEL_SDK_DISABLED` turns OpenTelemetry export off. The web app in a browser, including one the
`vetra` CLI opens, does not read these variables.

The desktop app reads `VETRA_TELEMETRY_ENABLED` from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > General > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`VETRA_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. For endpoints saved here or set with `VETRA_OTLP_*_URL`, set `VETRA_OTLP_HEADERS` for
receivers that need authentication and `VETRA_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
