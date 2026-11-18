import { thrownErrorMessage } from "@t3tools/client-runtime/errors";
import type { ThreadReferenceCopyTarget } from "@t3tools/client-runtime/thread-reference";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";
import { msg } from "gt-react";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { m } from "../i18n/messages";
import { shareableThreadLink } from "./threadShareLink";

export async function copyThreadReference(target: ThreadReferenceCopyTarget): Promise<void> {
  const fragment = target.fragment ? encodeComposerContextFragment(target.fragment) : null;
  // Parses only links on the default hosted app, which Vetra does not run yet.
  const link = target.kind === "thread" ? parseThreadLinkHref(target.value) : null;
  const value =
    link?.environmentId == null
      ? target.value
      : shareableThreadLink({ environmentId: link.environmentId, threadId: link.threadId });
  try {
    await writeTextToClipboard(
      value,
      target.kind === "pull-request"
        ? {
            target: target.clipboardTarget,
            unavailableMessage: msg(
              "Clipboard API is unavailable while copying pull request link.",
            ),
            failureMessage: msg("Failed to copy pull request link to the clipboard."),
          }
        : {
            target: target.clipboardTarget,
            unavailableMessage: msg("Clipboard API is unavailable while copying thread."),
            failureMessage: msg("Failed to copy thread to the clipboard."),
          },
      fragment ? { [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment } : undefined,
    );
  } catch (error) {
    console.error(error);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: target.failureTitle,
        description: thrownErrorMessage(error, m) ?? m(msg("An error occurred.")),
      }),
    );
  }
}
