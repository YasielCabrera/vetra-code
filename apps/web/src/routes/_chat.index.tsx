import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { LinkIcon, PlusIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import ChatView from "../components/ChatView";
import { Button } from "../components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";
import { useDraftPromotionNavigation } from "../hooks/useDraftPromotionNavigation";
import { ensureRootProjectDraft, ROOT_PROJECT_DRAFT_ID } from "../lib/rootProjectDraft";
import { useAllEnvironmentShellsBootstrapped } from "../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../state/environments";
import { primaryServerSettingsAtom } from "../state/server";
import { APP_DISPLAY_NAME } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { cn } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments } = useEnvironments();

  if (authGateState.status === "hosted-static" && environments.length === 0) {
    return <HostedStaticOnboardingState />;
  }

  return <IndexDraftLanding />;
}

function IndexDraftLanding() {
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryServerSettings = useAtomValue(primaryServerSettingsAtom);
  const { draftSession } = useDraftPromotionNavigation(ROOT_PROJECT_DRAFT_ID);
  const [startState, setStartState] = useState({ failed: false, retryRequest: 0 });

  useEffect(() => {
    if (!bootstrapped || primaryEnvironmentId === null || draftSession) {
      return;
    }
    try {
      ensureRootProjectDraft({
        environmentId: primaryEnvironmentId,
        defaultParentDirectory: primaryServerSettings.addProjectBaseDirectory,
      });
    } catch {
      setStartState((state) => ({ ...state, failed: true }));
    }
  }, [
    bootstrapped,
    draftSession,
    primaryEnvironmentId,
    primaryServerSettings.addProjectBaseDirectory,
    startState.retryRequest,
  ]);

  if (!bootstrapped) {
    return null;
  }
  if (startState.failed || primaryEnvironmentId === null) {
    return (
      <DraftStartError
        title="Couldn’t start a new project"
        description="Try opening the project draft again. Nothing has been created on disk."
        onRetry={() => {
          setStartState((state) => ({ failed: false, retryRequest: state.retryRequest + 1 }));
        }}
      />
    );
  }
  if (!draftSession) {
    return null;
  }

  return (
    <SidebarInset className="h-svh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground md:h-dvh">
      <ChatView
        draftId={ROOT_PROJECT_DRAFT_ID}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
        forceExpandedMobileComposer
      />
    </SidebarInset>
  );
}

function DraftStartError({
  onRetry,
  title = "Couldn’t start a new thread",
  description = "The project is still available. Try opening the draft again.",
}: {
  readonly onRetry: () => void;
  readonly title?: string;
  readonly description?: string;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle className="text-foreground text-xl">{title}</EmptyTitle>
          <EmptyDescription className="mt-2 text-sm text-muted-foreground/78">
            {description}
          </EmptyDescription>
          <div className="mt-5 flex justify-center">
            <Button size="sm" onClick={onRetry}>
              <RotateCcwIcon className="size-4" />
              Try again
            </Button>
          </div>
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});

function HostedStaticOnboardingState() {
  const cloudEnabled = hasCloudPublicConfig();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <header
          className={cn(
            "workspace-topbar border-b border-border px-3 transition-[padding-left] duration-200 ease-linear motion-reduce:transition-none sm:px-5",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </header>

        <Empty className="flex-1">
          <div className="w-full max-w-xl rounded-3xl border border-border/55 bg-card/20 px-8 py-12 shadow-sm/5">
            <EmptyHeader className="max-w-none">
              <div className="mx-auto mb-5 flex size-11 items-center justify-center rounded-xl border border-border/70 bg-background/70 text-muted-foreground">
                <LinkIcon className="size-5" />
              </div>
              <EmptyTitle className="text-foreground text-xl">
                Connect an environment to get started
              </EmptyTitle>
              <EmptyDescription className="mt-2 text-sm leading-relaxed text-muted-foreground/78">
                {cloudEnabled
                  ? "Sign in to Vetra Connect to connect a linked environment through its managed tunnel, or add a reachable backend manually."
                  : "Add a reachable backend manually to start working from this browser."}
              </EmptyDescription>
              <div className="mt-6 flex justify-center">
                <Button render={<Link to="/settings/connections" />} size="sm">
                  <PlusIcon className="size-4" />
                  {cloudEnabled ? "Open Connections" : "Add environment"}
                </Button>
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
