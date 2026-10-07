import { useAtomValue } from "@effect/atom-react";
import { createPreviewWalletEnvironmentAtoms } from "@t3tools/client-runtime/state/preview-wallet";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, PreviewWalletStatus } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { serverEnvironment } from "./server";

export const previewWalletEnvironment = createPreviewWalletEnvironmentAtoms(connectionAtomRuntime);

// Subscribes only while the environment's settings enable the wallet, so
// previews without one never open the stream.
const previewWalletStatusAtom = Atom.family((environmentId: EnvironmentId) =>
  Atom.make((get): PreviewWalletStatus | null =>
    get(serverEnvironment.settingsValueAtom(environmentId))?.web3Wallet.enabled === true
      ? Option.getOrNull(
          AsyncResult.value(get(previewWalletEnvironment.status({ environmentId, input: {} }))),
        )
      : null,
  ).pipe(Atom.withLabel(`web-preview-wallet:status:${environmentId}`)),
);

/**
 * The environment's wallet as its server last reported it. Null while the
 * wallet is off in that environment's settings, loading, or unsupported. The
 * value outlives a dropped connection; check the connection before offering
 * actions on it.
 */
export function usePreviewWalletStatus(environmentId: EnvironmentId): PreviewWalletStatus | null {
  return useAtomValue(previewWalletStatusAtom(environmentId));
}

/** What to tell the user about a wallet command, or null when it succeeded or was interrupted. */
export function previewWalletFailureMessage(
  result: AtomCommandResult<unknown, unknown>,
): string | null {
  if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
  const failure = squashAtomCommandFailure(result);
  return failure instanceof Error ? failure.message : "The preview wallet did not respond.";
}
