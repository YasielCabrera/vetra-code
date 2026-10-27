import {
  type AuthEnvironmentScope,
  type AuthMcpClientAccess,
  type AuthPairingCredentialResult,
  grantableMcpClientAccess,
  mcpClientScopes,
} from "@t3tools/contracts";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import { Check, Copy } from "lucide";
import { useState } from "react";

import { MorphIcon } from "~/components/MorphIcon";
import {
  createServerMcpClientToken,
  createServerPairingCredential,
  isLoopbackHostname,
} from "~/environments/primary";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowSecond } from "~/hooks/useNowSecond";
import { formatExpiresInLabel } from "~/timestampFormat";
import { McpClientGrantFields, type McpToolsChoice } from "../auth/McpClientGrantFields";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { formatAccessTimestamp } from "./ConnectionsSettings.logic";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

const SERVER_NAME = "vetra-code";

export function McpServerRow({
  mcpUrl,
  canCreateAccess,
  delegatableScopes,
  onPairingLinkCreated,
}: {
  readonly mcpUrl: string;
  readonly canCreateAccess: boolean;
  readonly delegatableScopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly onPairingLinkCreated: (created: AuthPairingCredentialResult) => void;
}) {
  return (
    <SettingsRow
      title={searchableSetting("mcp-server").title}
      description={<span className="break-all">{mcpUrl}</span>}
      control={
        <div className="flex items-center gap-2">
          <CopyButton value={mcpUrl} target="MCP URL" />
          {canCreateAccess ? (
            <Dialog>
              <DialogTrigger
                render={
                  <Button size="sm" variant="outline">
                    Connect an agent
                  </Button>
                }
              />
              <DialogPopup>
                <ConnectAgentDialogBody
                  mcpUrl={mcpUrl}
                  delegatableScopes={delegatableScopes}
                  onPairingLinkCreated={onPairingLinkCreated}
                />
              </DialogPopup>
            </Dialog>
          ) : null}
        </div>
      }
    />
  );
}

/** Mounted only while the dialog is open, so a minted token leaves memory when it closes. */
function ConnectAgentDialogBody({
  mcpUrl,
  delegatableScopes,
  onPairingLinkCreated,
}: {
  readonly mcpUrl: string;
  readonly delegatableScopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly onPairingLinkCreated: (created: AuthPairingCredentialResult) => void;
}) {
  const [method, setMethod] = useState<"sign-in" | "token">("sign-in");
  const grantableAccess = grantableMcpClientAccess(delegatableScopes);
  const widestAccess = grantableAccess.at(-1);
  return (
    <>
      <DialogHeader>
        <DialogTitle>Connect an agent</DialogTitle>
        <DialogDescription>
          Let Claude Code, Codex, Cursor, ChatGPT or a bot work with this environment through its
          MCP server.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <CopyableValue label="MCP URL" value={mcpUrl} />
        <ToggleGroup
          aria-label="How the agent signs in"
          className="w-full *:flex-1"
          value={[method]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "sign-in" || value === "token") setMethod(value);
          }}
        >
          <Toggle value="sign-in">Browser sign-in</Toggle>
          <Toggle value="token">Access token</Toggle>
        </ToggleGroup>
        {widestAccess === undefined ? (
          <p className="text-xs text-muted-foreground">
            This connection cannot give agents access to this environment.
          </p>
        ) : (
          <>
            <div hidden={method !== "sign-in"}>
              <BrowserSignIn
                mcpUrl={mcpUrl}
                widestAccess={widestAccess}
                onPairingLinkCreated={onPairingLinkCreated}
              />
            </div>
            <div hidden={method !== "token"}>
              <AccessToken mcpUrl={mcpUrl} grantableAccess={grantableAccess} />
            </div>
          </>
        )}
      </DialogPanel>
    </>
  );
}

function BrowserSignIn({
  mcpUrl,
  widestAccess,
  onPairingLinkCreated,
}: {
  readonly mcpUrl: string;
  readonly widestAccess: AuthMcpClientAccess;
  readonly onPairingLinkCreated: (created: AuthPairingCredentialResult) => void;
}) {
  const [pairingCode, setPairingCode] = useState<AuthPairingCredentialResult | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const url = new URL(mcpUrl);
  const signInUnavailable = url.protocol === "http:" && !isLoopbackHostname(url.hostname);

  const createPairingCode = async () => {
    setIsCreating(true);
    const settled = await settlePromise(() =>
      createServerPairingCredential({
        label: "Agent sign-in",
        scopes: mcpClientScopes(widestAccess),
      }),
    );
    setIsCreating(false);
    if (settled._tag === "Failure") {
      const error = Cause.squash(settled.cause);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not create pairing code",
          description: error instanceof Error ? error.message : "Try again.",
        }),
      );
      return;
    }
    onPairingLinkCreated(settled.value);
    setPairingCode(settled.value);
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Recommended for agents that support MCP sign-in. The agent opens a sign-in page here, where
        you pick its tools and what it may do.
        {signInUnavailable
          ? " Sign-in needs an https or localhost address, so use an access token with this one."
          : null}
      </p>
      <CopyableValue
        label="Claude Code"
        value={`claude mcp add --transport http ${SERVER_NAME} ${mcpUrl}\nclaude mcp login ${SERVER_NAME}`}
      />
      <CopyableValue
        label="Codex"
        value={`codex mcp add ${SERVER_NAME} --url ${mcpUrl}\ncodex mcp login ${SERVER_NAME}`}
      />
      <p className="text-xs text-muted-foreground">
        Other agents: add the MCP URL as a remote MCP server that signs in with OAuth.
      </p>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          If the sign-in page opens in a browser that is not signed in here, it asks for a pairing
          code.
        </p>
        {pairingCode ? (
          <>
            <CopyableValue label="Pairing code" value={pairingCode.credential} />
            <p className="text-xs text-muted-foreground">
              Paste it on the sign-in page the agent opens.{" "}
              <ExpiresIn expiresAt={DateTime.formatIso(pairingCode.expiresAt)} />
            </p>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            disabled={isCreating}
            onClick={() => void createPairingCode()}
          >
            {isCreating ? "Creating…" : "Create pairing code"}
          </Button>
        )}
      </div>
    </div>
  );
}

function ExpiresIn({ expiresAt }: { readonly expiresAt: string }) {
  const nowMs = useNowSecond();
  return <>{formatExpiresInLabel(expiresAt, nowMs)}.</>;
}

function AccessToken({
  mcpUrl,
  grantableAccess,
}: {
  readonly mcpUrl: string;
  readonly grantableAccess: ReadonlyArray<AuthMcpClientAccess>;
}) {
  const [label, setLabel] = useState("");
  const [access, setAccess] = useState<AuthMcpClientAccess>("read-only");
  const [tools, setTools] = useState<McpToolsChoice>("all");
  const [isCreating, setIsCreating] = useState(false);
  const [issued, setIssued] = useState<{ token: string; expiresAt: string } | null>(null);
  const trimmedLabel = label.trim();

  const createToken = async () => {
    setIsCreating(true);
    const settled = await settlePromise(() =>
      createServerMcpClientToken({
        label: trimmedLabel,
        access,
        ...(tools === "tickets" ? { tools } : {}),
      }),
    );
    setIsCreating(false);
    if (settled._tag === "Failure") {
      const error = Cause.squash(settled.cause);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not create access token",
          description: error instanceof Error ? error.message : "Try again.",
        }),
      );
      return;
    }
    setIssued({
      token: settled.value.token,
      expiresAt: DateTime.formatIso(settled.value.expiresAt),
    });
  };

  if (issued) {
    const header = `Authorization: Bearer ${issued.token}`;
    const config = JSON.stringify(
      {
        mcpServers: {
          [SERVER_NAME]: {
            type: "http",
            url: mcpUrl,
            headers: { Authorization: `Bearer ${issued.token}` },
          },
        },
      },
      null,
      2,
    );
    return (
      <div className="space-y-4">
        <p className="text-xs text-warning">Copy the token now. It is not shown again.</p>
        <CopyableValue label="Access token" value={issued.token} />
        <CopyableValue label="Header" value={header} />
        <CopyableValue
          label="Claude Code"
          value={`claude mcp add --transport http ${SERVER_NAME} ${mcpUrl} --header "${header}"`}
        />
        <CopyableValue label="MCP config" value={config} />
        <p className="text-xs text-muted-foreground">
          Expires {formatAccessTimestamp(issued.expiresAt)}, 30 days from now. Revoke it any time
          under Authorized clients.
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedLabel && !isCreating) void createToken();
      }}
    >
      <p className="text-xs text-muted-foreground">
        For scripts, bots and agents that cannot sign in with a browser. The agent sends the token
        in an <code>Authorization</code> header.
      </p>
      <label className="block space-y-1.5">
        <span className="block text-sm font-medium">Name</span>
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="e.g. Release bot"
          disabled={isCreating}
        />
      </label>
      <McpClientGrantFields
        access={access}
        onAccessChange={setAccess}
        accessOptions={grantableAccess}
        tools={tools}
        onToolsChange={setTools}
      />
      <Button type="submit" size="sm" disabled={!trimmedLabel || isCreating}>
        {isCreating ? "Creating…" : "Create access token"}
      </Button>
    </form>
  );
}

function useCopyWithFeedback(target: string) {
  return useCopyToClipboard({
    timeout: 1500,
    target,
    onError: (error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: `Could not copy ${target}`,
          description: error.message,
        }),
      );
    },
  });
}

function CopyButton({ value, target }: { readonly value: string; readonly target: string }) {
  const { copyToClipboard, isCopied } = useCopyWithFeedback(target);
  return (
    <Button
      size="icon-xs"
      variant="ghost"
      aria-label={`Copy ${target}`}
      onClick={() => copyToClipboard(value, undefined)}
    >
      <MorphIcon className="size-3.5" icon={isCopied ? Check : Copy} />
    </Button>
  );
}

function CopyableValue({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="space-y-1">
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/50 py-1.5 ps-3 pe-1.5">
        <code className="min-w-0 flex-1 py-0.5 font-mono text-xs break-all whitespace-pre-wrap select-all">
          {value}
        </code>
        <CopyButton value={value} target={label} />
      </div>
    </div>
  );
}
