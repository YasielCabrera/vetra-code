import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  type ModelSelection,
  repositoryGroupingKeyOf,
  type ServerProvider,
} from "@t3tools/contracts";
import {
  buildNewThreadLink,
  parsePromptLinkRepository,
  PROMPT_LINK_MAX_PROMPT_LENGTH,
  promptLinkDeepLink,
  type PromptLinkRepository,
} from "@t3tools/shared/promptLinks";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { configuredHostedAppUrl } from "~/hostedPairing";

import { stackedThreadToast, toastManager } from "../ui/toast";

/** A prompt link on the configured host, current web origin, or desktop scheme. */
export function promptLinkFor(
  prompt: string,
  context?: {
    readonly repository: PromptLinkRepository | null;
    readonly provider: string | null;
    readonly model: string | null;
  },
): string | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0 || trimmed.length > PROMPT_LINK_MAX_PROMPT_LENGTH) return null;
  const hostedOrigin = import.meta.env.VITE_HOSTED_APP_URL?.trim();
  const desktop = typeof window !== "undefined" && window.desktopBridge !== undefined;
  const link = buildNewThreadLink({
    prompt: trimmed,
    ...context,
    origin:
      hostedOrigin ||
      (desktop || typeof window === "undefined"
        ? configuredHostedAppUrl()
        : window.location.origin),
  });
  if (hostedOrigin || !desktop) return link;
  const url = new URL(link);
  return promptLinkDeepLink(`${url.pathname}${url.search}`);
}

/** The project's GitHub repository, the only kind a prompt link can name. */
export function promptLinkRepositoryOf(
  project: Pick<EnvironmentProject, "repositoryIdentity"> | undefined,
): PromptLinkRepository | null {
  const identity = project?.repositoryIdentity;
  if (identity == null) return null;
  const key = repositoryGroupingKeyOf(identity);
  return key.startsWith("github.com/")
    ? parsePromptLinkRepository(key.slice("github.com/".length))
    : null;
}

/**
 * The draft in a composer as a link: its text and, with `withContext`, the project's repository
 * and the model the composer has picked. Null when the composer holds no prompt to share.
 */
export function composerPromptLink(input: {
  readonly target: ComposerThreadTarget;
  readonly project: EnvironmentProject | undefined;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly threadModelSelection: ModelSelection | null;
  readonly withContext: boolean;
}): string | null {
  const draft = useComposerDraftStore.getState().getComposerDraft(input.target);
  if (!draft) return null;
  if (!input.withContext) return promptLinkFor(draft.prompt);
  const selection =
    (draft.activeProvider ? draft.modelSelectionByProvider[draft.activeProvider] : undefined) ??
    input.threadModelSelection;
  const provider = selection
    ? (input.providers.find((candidate) => candidate.instanceId === selection.instanceId)?.driver ??
      null)
    : null;
  return promptLinkFor(draft.prompt, {
    repository: promptLinkRepositoryOf(input.project),
    provider,
    model: provider === null ? null : (selection?.model ?? null),
  });
}

/** Copies a prompt link and says so. */
export async function copyPromptLink(link: string): Promise<void> {
  try {
    if (!(await writeTextToClipboard(link))) return;
    toastManager.add({ type: "success", title: "Prompt link copied" });
  } catch (error) {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not copy the prompt link",
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  }
}
