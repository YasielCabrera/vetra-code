import {
  type AuthMcpApprovalDecision,
  type AuthMcpApprovalDetails,
  AuthMcpApprovalError,
  type AuthMcpClientAccess,
  type AuthMcpAuthorizationRequest,
} from "@t3tools/contracts";
import { isLoopbackHost } from "@t3tools/shared/preview";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type ReactNode, useEffect, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { AuthSurfaceShell } from "./AuthSurfaceShell";
import { McpClientGrantFields, type McpToolsChoice } from "./McpClientGrantFields";

function redirectsToThisComputer(redirectHost: string): boolean {
  return isLoopbackHost(new URL(`http://${redirectHost}`).hostname);
}

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "ready"; readonly details: AuthMcpApprovalDetails };

const UNREACHABLE = "Could not reach this environment. Try again.";
const isApprovalError = Schema.is(AuthMcpApprovalError);

type Answer<A> =
  | { readonly kind: "ok"; readonly value: A }
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "error"; readonly message: string };

function runApproval<A>(
  call: (
    client: Context.Service.Shape<typeof PrimaryEnvironmentHttpClient>,
  ) => Effect.Effect<A | { readonly redirectTo: string }, unknown>,
): Promise<Answer<A>> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap(call),
      Effect.map((value): Answer<A> =>
        typeof value === "object" && value !== null && "redirectTo" in value
          ? { kind: "redirect", url: value.redirectTo }
          : { kind: "ok", value: value as A },
      ),
      Effect.catch((error) =>
        Effect.succeed<Answer<A>>({
          kind: "error",
          message: isApprovalError(error) ? error.message : UNREACHABLE,
        }),
      ),
    ),
  ).catch((): Answer<A> => ({ kind: "error", message: UNREACHABLE }));
}

function readAuthorizationRequest(): AuthMcpAuthorizationRequest {
  return Object.fromEntries(new URL(window.location.href).searchParams);
}

/** Sessions can grant only scopes they hold. */
function oneClickApproves(details: AuthMcpApprovalDetails, access: AuthMcpClientAccess) {
  return details.csrfToken !== undefined && (details.oneClickAccess ?? []).includes(access);
}

export function ConnectAgentSurface() {
  const [authorization] = useState(readAuthorizationRequest);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [access, setAccess] = useState<AuthMcpClientAccess>("read-only");
  const [tools, setTools] = useState<McpToolsChoice>("all");
  const [pairingCode, setPairingCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);

  useEffect(() => {
    let cancelled = false;
    void runApproval((client) => client.mcpOAuth.approval({ payload: authorization })).then(
      (answer) => {
        if (cancelled) return;
        if (answer.kind === "redirect") {
          window.location.replace(answer.url);
          return;
        }
        setLoaded(
          answer.kind === "error"
            ? { status: "invalid", message: answer.message }
            : { status: "ready", details: answer.value },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [authorization]);

  const decide = async (choice: "approve" | "deny") => {
    if (loaded.status !== "ready") return;
    setPending(choice);
    setErrorMessage("");
    const { csrfToken } = loaded.details;
    const grant = { access, ...(tools === "tickets" ? { tools } : {}) };
    const decision: AuthMcpApprovalDecision =
      choice === "deny"
        ? { _tag: "deny" }
        : csrfToken !== undefined && oneClickApproves(loaded.details, access)
          ? { _tag: "browser-session", ...grant, csrfToken }
          : { _tag: "pairing-code", ...grant, code: pairingCode.trim() };
    const answer = await runApproval((client) =>
      client.mcpOAuth.decision({ payload: { authorization, decision } }),
    );
    if (answer.kind === "redirect") {
      window.location.replace(answer.url);
      return;
    }
    setPending(null);
    setErrorMessage(answer.kind === "error" ? answer.message : "The sign-in could not continue.");
  };

  if (loaded.status === "loading") {
    return (
      <AuthSurfaceShell>
        <ConnectAgentHeading
          title="Checking the sign-in request"
          description="One moment while this environment verifies the agent's request."
        />
        <Spinner className="mt-6" size="lg" tone="muted" />
      </AuthSurfaceShell>
    );
  }

  if (loaded.status === "invalid") {
    return (
      <AuthSurfaceShell>
        <ConnectAgentHeading title="This sign-in cannot continue" description={loaded.message} />
        <p className="mt-4 text-sm text-muted-foreground">
          Close this page and start the sign-in again from your agent.
        </p>
      </AuthSurfaceShell>
    );
  }

  const { details } = loaded;
  const oneClick = oneClickApproves(details, access);
  const canApprove = pending === null && (oneClick || pairingCode.trim().length > 0);

  return (
    <AuthSurfaceShell>
      <ConnectAgentHeading
        title={`Connect ${details.clientName}`}
        description={
          <>
            This agent wants to use the {tools === "tickets" ? "tickets" : "threads"} in every
            project on{" "}
            <span className="font-medium text-foreground">{details.environmentHost}</span>.
          </>
        }
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {redirectsToThisComputer(details.redirectHost) ? (
          <>
            The name is chosen by the agent. Approval returns to {details.redirectHost} on the
            computer that opened this page. Only approve a sign-in you just started.
          </>
        ) : (
          <>
            The name is chosen by the agent. Approval gives access to whoever runs{" "}
            <span className="font-medium text-foreground">{details.redirectHost}</span>. Only
            approve a sign-in you just started there.
          </>
        )}
      </p>

      <form
        className="mt-6 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canApprove) void decide("approve");
        }}
      >
        <McpClientGrantFields
          access={access}
          onAccessChange={setAccess}
          tools={tools}
          onToolsChange={setTools}
        />

        {oneClick ? null : (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="connect-agent-pairing-code">
              Pairing code
            </label>
            <Input
              id="connect-agent-pairing-code"
              autoCapitalize="none"
              autoComplete="one-time-code"
              autoCorrect="off"
              disabled={pending !== null}
              nativeInput
              onChange={(event) => setPairingCode(event.currentTarget.value)}
              placeholder="Paste a one-time pairing code"
              spellCheck={false}
              value={pairingCode}
            />
            <p className="text-xs text-muted-foreground">
              Create one in Settings → Connections → Connect an agent, or run{" "}
              <code>vetra auth pairing create</code> on this machine.
            </p>
          </div>
        )}

        {errorMessage ? (
          <Alert variant="error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={!canApprove} type="submit">
            {pending === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button
            disabled={pending !== null}
            onClick={() => void decide("deny")}
            type="button"
            variant="outline"
          >
            {pending === "deny" ? "Denying…" : "Deny"}
          </Button>
        </div>
      </form>
    </AuthSurfaceShell>
  );
}

function ConnectAgentHeading({
  title,
  description,
}: {
  readonly title: string;
  readonly description: ReactNode;
}) {
  return (
    <>
      <p className="text-3xs font-semibold tracking-widest text-primary uppercase">Agent sign-in</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
    </>
  );
}
