import { Link, useNavigate } from "@tanstack/react-router";
import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  createContext,
  useCallback,
  useContext,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";

import { useRightPanelStore } from "../../rightPanelStore";
import type { TicketResourceTarget } from "../../ticketResource";

const ThreadTicketWorkspaceContext = createContext<ScopedThreadRef | null>(null);

export function ThreadTicketWorkspace(props: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}) {
  return (
    <ThreadTicketWorkspaceContext value={props.threadRef}>
      {props.children}
    </ThreadTicketWorkspaceContext>
  );
}

export function useThreadTicketWorkspace() {
  return useContext(ThreadTicketWorkspaceContext);
}

export function useOpenTicketResource() {
  const owner = useThreadTicketWorkspace();
  const navigate = useNavigate();
  return useCallback(
    (target: TicketResourceTarget, intent?: { edit?: boolean }) => {
      if (owner !== null) {
        useRightPanelStore.getState().openTicketResource(owner, target, intent);
      } else if (target.kind === "ticket") {
        void navigate({
          to: "/tickets/$ticketKey",
          params: { ticketKey: ticketKey(target.ticketRef) },
        });
      } else {
        void navigate({
          to: "/tickets/$ticketKey/plans/$planNumber",
          params: { ticketKey: ticketKey(target.ticketRef), planNumber: String(target.planNumber) },
          search: intent?.edit ? { edit: true } : {},
        });
      }
    },
    [navigate, owner],
  );
}

export function TicketResourceLink({
  target,
  onClick,
  ...props
}: Omit<ComponentPropsWithRef<"a">, "href" | "target"> & {
  readonly target: TicketResourceTarget;
}) {
  const owner = useThreadTicketWorkspace();
  const handleClick: ComponentPropsWithRef<"a">["onClick"] = (event) => {
    onClick?.(event);
    if (
      owner === null ||
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    useRightPanelStore.getState().openTicketResource(owner, target);
  };
  return target.kind === "ticket" ? (
    <Link
      {...props}
      to="/tickets/$ticketKey"
      params={{ ticketKey: ticketKey(target.ticketRef) }}
      onClick={handleClick}
    />
  ) : (
    <Link
      {...props}
      to="/tickets/$ticketKey/plans/$planNumber"
      params={{ ticketKey: ticketKey(target.ticketRef), planNumber: String(target.planNumber) }}
      onClick={handleClick}
    />
  );
}
