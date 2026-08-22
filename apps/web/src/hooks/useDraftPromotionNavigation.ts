import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  resolveDraftPromotionNavigationTarget,
  threadHasStarted,
} from "~/components/ChatView.logic";
import {
  type DraftId,
  markPromotedDraftThreadByRef,
  useBackgroundDraftSubmissionPending,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { waitForDraftHeroTransition } from "~/components/chat/draftHeroTransition";
import { useThread, useThreadRefs } from "~/state/entities";
import { buildThreadRouteParams } from "~/threadRoutes";

/**
 * Promotes a browser-local draft route to its canonical server-thread route.
 * Both `/` and `/draft/:draftId` use this seam so promotion ordering stays
 * identical regardless of where a draft started.
 */
export function useDraftPromotionNavigation(draftId: DraftId) {
  const navigate = useNavigate();
  const draftSession = useComposerDraftStore((store) => store.getDraftSession(draftId));
  const threadRefs = useThreadRefs();
  const inferredThreadRef = draftSession
    ? (threadRefs.find(
        (ref) =>
          ref.environmentId === draftSession.environmentId &&
          ref.threadId === draftSession.threadId,
      ) ?? null)
    : null;
  const serverThreadRef = draftSession?.promotedTo ?? inferredThreadRef;
  const serverThread = useThread(serverThreadRef);
  const backgroundSubmissionPending = useBackgroundDraftSubmissionPending(serverThreadRef);
  const canonicalThreadRef = resolveDraftPromotionNavigationTarget({
    serverThreadRef,
    serverThreadStarted: threadHasStarted(serverThread),
    backgroundSubmissionPending,
  });

  useEffect(() => {
    if (!inferredThreadRef || draftSession?.promotedTo) {
      return;
    }
    markPromotedDraftThreadByRef(inferredThreadRef);
  }, [draftSession?.promotedTo, inferredThreadRef]);

  useEffect(() => {
    if (!canonicalThreadRef) {
      return;
    }

    let cancelled = false;
    void waitForDraftHeroTransition().then(() => {
      if (cancelled) {
        return;
      }
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(canonicalThreadRef),
        replace: true,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [canonicalThreadRef, navigate]);

  return { canonicalThreadRef, draftSession };
}
