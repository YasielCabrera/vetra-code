import { Link, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { isElectron } from "../../env";
import { toastManager } from "../ui/toast";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

export function copyText(text: string, title: string) {
  void navigator.clipboard.writeText(text).then(
    () => toastManager.add({ type: "success", title, timeout: 1500 }),
    () => toastManager.add({ type: "error", title: "Could not copy to the clipboard" }),
  );
}

export function TicketBreadcrumbHeader(props: {
  readonly current: ReactNode;
  /** What clicking the current crumb copies; the crumb itself by default. */
  readonly copy?: string;
  readonly ticket?: { readonly label: string; readonly ticketKey: string } | null;
  readonly trailing?: ReactNode;
  readonly reachesWindowEdge?: boolean;
}) {
  const navigate = useNavigate();
  const copy = props.copy ?? (typeof props.current === "string" ? props.current : null);
  return (
    <WorkspacePageHeader
      electron={isElectron}
      reserveNativeControls={isElectron && props.reachesWindowEdge !== false}
    >
      <WorkspaceBreadcrumb ariaLabel="Ticket breadcrumb" className="flex-1">
        <WorkspaceBreadcrumbItem>
          <button
            type="button"
            className="hover:text-foreground"
            onClick={() => void navigate({ to: "/tickets", search: {} })}
          >
            Tickets
          </button>
        </WorkspaceBreadcrumbItem>
        {props.ticket == null ? null : (
          <>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem>
              <Link
                to="/tickets/$ticketKey"
                params={{ ticketKey: props.ticket.ticketKey }}
                className="font-mono hover:text-foreground"
              >
                {props.ticket.label}
              </Link>
            </WorkspaceBreadcrumbItem>
          </>
        )}
        {props.current == null ? null : (
          <>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current className="flex-1">
              {typeof props.current === "string" ? (
                <h1 className="min-w-0 truncate font-mono">
                  <button
                    type="button"
                    aria-label={`Copy ${copy}`}
                    className="block max-w-full truncate hover:text-foreground"
                    onClick={() => copy !== null && copyText(copy, `Copied ${copy}`)}
                  >
                    {props.current}
                  </button>
                </h1>
              ) : (
                props.current
              )}
            </WorkspaceBreadcrumbItem>
          </>
        )}
      </WorkspaceBreadcrumb>
      {props.trailing}
    </WorkspacePageHeader>
  );
}

export function TicketPagePlaceholder(props: {
  readonly header: ReactNode;
  readonly title: string | null;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
      {props.header}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 pt-4">
        {props.title !== null ? (
          <h2 className="text-xl font-semibold text-foreground">{props.title}</h2>
        ) : null}
        <p className="text-sm text-muted-foreground">{props.children}</p>
      </div>
    </div>
  );
}
