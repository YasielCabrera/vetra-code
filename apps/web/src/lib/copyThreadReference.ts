import type { ThreadReferenceCopyTarget } from "@t3tools/client-runtime/thread-reference";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  encodeComposerContextFragment,
} from "@t3tools/shared/composerContextClipboard";
import { parseThreadLinkHref } from "@t3tools/shared/threadLinks";

import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
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
    const didCopy = await writeTextToClipboard(
      value,
      target.clipboardTarget,
      fragment ? { [COMPOSER_CONTEXT_CLIPBOARD_MIME]: fragment } : undefined,
    );
    if (!didCopy) return;
    toastManager.add({
      type: "success",
      title: target.successTitle,
      description: target.description,
    });
  } catch (error) {
    console.error(error);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: target.failureTitle,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
}
