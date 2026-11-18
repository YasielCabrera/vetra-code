import { T3CHAT_PLAN_TUNNEL_LIMITS, type RelayT3ChatLink } from "@t3tools/contracts/relay";
import { MessageSquareIcon } from "lucide-react";
import { T, useGT, Var } from "gt-react";
import type { ReactNode } from "react";

import { useManagedTunnelUsage } from "../../cloud/managedRelayState";
import { T3CHAT_SUBSCRIPTION_URL, TunnelUsageMeter } from "../cloud/TunnelUsage";
import { Button } from "../ui/button";
import {
  ClerkUserProfilePage,
  ClerkUserProfileRefreshButton,
  ClerkUserProfileRow,
} from "./ClerkUserProfilePage";
import { useT3ChatLink } from "./useT3ChatLink";

function planLabel(link: RelayT3ChatLink): ReactNode {
  switch (link.plan) {
    case "premier":
      return (
        <T>
          Premier · up to <Var>{T3CHAT_PLAN_TUNNEL_LIMITS.premier}</Var> tunnels
        </T>
      );
    case "pro":
      return (
        <T>
          Pro · up to <Var>{T3CHAT_PLAN_TUNNEL_LIMITS.pro}</Var> tunnels.{" "}
          <a
            className="underline"
            href={T3CHAT_SUBSCRIPTION_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Upgrade on Vetra Chat
          </a>{" "}
          to Premier for <Var>{T3CHAT_PLAN_TUNNEL_LIMITS.premier}</Var>.
        </T>
      );
    case "free":
      return (
        <T>
          <a
            className="underline"
            href={T3CHAT_SUBSCRIPTION_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            Upgrade on Vetra Chat
          </a>{" "}
          for more tunnels
        </T>
      );
  }
}

/** Links a Vetra Chat account so paid subscribers get more tunnels. */
export function T3ChatUserProfilePage() {
  const { linkState, pending, linkUrl, link: handleLink, unlink: handleUnlink } = useT3ChatLink();
  const usage = useManagedTunnelUsage();
  const gt = useGT();

  const data = linkState.data;
  const link = data?.link ?? null;

  return (
    <ClerkUserProfilePage
      title="Vetra Chat"
      description={gt(
        "Link a paid Vetra Chat account for more Vetra Connect tunnels: up to {pro} with Pro, {premier} with Premier.",
        { pro: T3CHAT_PLAN_TUNNEL_LIMITS.pro, premier: T3CHAT_PLAN_TUNNEL_LIMITS.premier },
      )}
      action={
        <ClerkUserProfileRefreshButton
          disabled={pending !== null}
          isPending={linkState.isPending}
          onClick={usage.refresh}
        />
      }
    >
      {linkState.error ? (
        <div className="border-t py-3 text-xs" role="alert">
          <p className="font-medium text-destructive-foreground">
            <T>Could not load Vetra Chat link</T>
          </p>
          <p className="mt-0.5 text-muted-foreground">{linkState.error}</p>
        </div>
      ) : data === null ? null : !data.available ? (
        <p className="border-t py-4 text-xs text-muted-foreground">
          <T>This Vetra Connect server does not support Vetra Chat linking.</T>
        </p>
      ) : (
        <ul className="border-t">
          <ClerkUserProfileRow icon={<MessageSquareIcon className="size-4" />}>
            <div className="flex items-start gap-4">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm leading-4.5 font-medium text-foreground">
                  {link ? link.email : gt("Not linked")}
                </h3>
                <p className="mt-1 text-xs leading-4.5 text-muted-foreground">
                  {link ? (
                    planLabel(link)
                  ) : linkUrl ? (
                    <T>
                      Confirm on{" "}
                      <a
                        className="underline"
                        href={linkUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        t3.chat
                      </a>
                      , then select Refresh.
                    </T>
                  ) : (
                    gt("You confirm the link on t3.chat.")
                  )}
                </p>
              </div>
              {link ? (
                <Button
                  size="sm"
                  variant="destructive-outline"
                  disabled={pending !== null}
                  onClick={() => void handleUnlink()}
                >
                  {pending === "unlink" ? gt("Unlinking…") : gt("Unlink")}
                </Button>
              ) : (
                <Button size="sm" disabled={pending !== null} onClick={() => void handleLink()}>
                  {pending === "link" ? gt("Opening…") : gt("Link Vetra Chat")}
                </Button>
              )}
            </div>
          </ClerkUserProfileRow>
          {usage.used !== null && usage.limit !== null ? (
            <li className="border-t py-4">
              <TunnelUsageMeter used={usage.used} limit={usage.limit} />
            </li>
          ) : null}
        </ul>
      )}
    </ClerkUserProfilePage>
  );
}
