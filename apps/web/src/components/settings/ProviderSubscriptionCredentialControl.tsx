import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import { AsyncResult } from "effect/unstable/reactivity";
import { KeyRoundIcon, LoaderIcon, Trash2Icon } from "lucide-react";
import { useRef, useState } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { stackedThreadToast, toastManager } from "../ui/toast";

export function ProviderSubscriptionCredentialControl({
  environmentId,
  instanceId,
  driver,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly readOnly: boolean;
}) {
  const result = useAtomValue(
    serverEnvironment.providerSubscriptionCredentialStatus({
      environmentId,
      input: { instanceId },
    }),
  );
  const status = Option.getOrNull(AsyncResult.value(result));
  const setCredential = useAtomCommand(serverEnvironment.setProviderSubscriptionCredential, {
    reportFailure: false,
  });
  const clearCredential = useAtomCommand(serverEnvironment.clearProviderSubscriptionCredential, {
    reportFailure: false,
  });
  const [secret, setSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const busyRef = useRef(false);
  const providerName = driver === "cursor" ? "Cursor" : "OpenCode Go";

  const run = async (operation: "save" | "clear") => {
    if (busyRef.current || (operation === "save" && secret.trim().length === 0)) return;
    busyRef.current = true;
    setSaving(true);
    const commandResult =
      operation === "save"
        ? await setCredential({
            environmentId,
            input: { instanceId, secret: Redacted.make(secret.trim()) },
          })
        : await clearCredential({ environmentId, input: { instanceId } });
    busyRef.current = false;
    setSaving(false);
    if (commandResult._tag === "Success") {
      setSecret("");
      toastManager.add({
        type: "success",
        title: operation === "save" ? `${providerName} credential saved` : "Override cleared",
        description:
          operation === "save"
            ? "Subscription limits will use this instance-specific credential."
            : driver === "cursor"
              ? "Cursor app session discovery is active again."
              : "OpenCode Go limits now require another Cookie header.",
      });
      return;
    }
    if (!isAtomCommandInterrupted(commandResult)) {
      const error = squashAtomCommandFailure(commandResult);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Credential could not be updated",
          description:
            error instanceof Error ? error.message : "The environment rejected the change.",
        }),
      );
    }
  };

  if (result._tag === "Failure") {
    return (
      <div className="rounded-lg border border-border/70 px-3 py-2 text-xs text-muted-foreground">
        Subscription-limit credentials are not supported by this environment.
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/70 p-3">
      <div className="flex items-start gap-2">
        <KeyRoundIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-foreground">Subscription-limit credential</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {status?.detail ??
              (result.waiting
                ? "Checking the environment credential store."
                : `Save a ${providerName} Cookie header for this instance.`)}
          </p>
        </div>
        {status?.configured ? (
          <span className="shrink-0 text-[10px] font-medium tracking-wide text-success uppercase">
            Saved
          </span>
        ) : null}
      </div>
      <label className="block">
        <span className="sr-only">{providerName} Cookie header</span>
        <input
          type="password"
          autoComplete="off"
          maxLength={32_768}
          value={secret}
          disabled={readOnly || saving}
          onChange={(event) => setSecret(event.target.value)}
          placeholder={status?.configured ? "Replace saved Cookie header" : "Cookie header"}
          className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        />
      </label>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {status?.configured ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={readOnly || saving}
            onClick={() => void run("clear")}
          >
            <Trash2Icon className="size-3" />
            Clear override
          </Button>
        ) : null}
        <Button
          type="button"
          size="xs"
          disabled={readOnly || saving || secret.trim().length === 0}
          onClick={() => void run("save")}
        >
          {saving ? <LoaderIcon className="size-3 animate-spin" /> : null}
          {status?.configured ? "Replace" : "Save"}
        </Button>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        Stored only in this environment's secret store. The value is never returned to the app.
      </p>
    </div>
  );
}
