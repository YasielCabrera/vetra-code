import { useNavigate } from "@tanstack/react-router";
import { PlusIcon, SettingsIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useTicketActions } from "../../hooks/useTicketActions";
import { useProjects, useServerConfigs } from "../../state/entities";
import { useConnectedEnvironmentIds, useEnvironments } from "../../state/environments";
import { useTicketGitHubSources } from "../../state/tickets";
import { GitHubIcon } from "../Icons";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { eligibleTicketGitHubProjects, projectGitHubRemotes } from "./ticketGitHub.logic";
import { useTicketGitHubRemotes } from "./useTicketGitHubRemotes";

type ConnectionStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "connecting"; readonly repository: string }
  | { readonly kind: "connected"; readonly repository: string }
  | { readonly kind: "error"; readonly message: string };

export function TicketGitHubConnect(props: { readonly emptyState?: boolean }) {
  const navigate = useNavigate();
  const actions = useTicketActions();
  const allProjects = useProjects();
  const sources = useTicketGitHubSources();
  const connectedEnvironmentIds = useConnectedEnvironmentIds();
  const configs = useServerConfigs();
  const { environments } = useEnvironments();
  const [status, setStatus] = useState<ConnectionStatus>({ kind: "idle" });
  const [open, setOpen] = useState(false);
  const projects = useMemo(() => {
    const connected = new Set(connectedEnvironmentIds);
    return allProjects.filter(
      (project) =>
        connected.has(project.environmentId) &&
        configs.get(project.environmentId)?.environment.capabilities.tickets === true,
    );
  }, [allProjects, configs, connectedEnvironmentIds]);
  const remotes = useTicketGitHubRemotes(projects, open);
  const candidates = useMemo(
    () => eligibleTicketGitHubProjects({ projects: remotes.projects, sources }),
    [remotes.projects, sources],
  );
  const environmentLabels = useMemo(
    () =>
      new Map(environments.map((environment) => [environment.environmentId, environment.label])),
    [environments],
  );
  const lastError = sources.find(
    (source) => connectedEnvironmentIds.includes(source.environmentId) && source.lastError !== null,
  );
  const connecting = status.kind === "connecting";
  const connect = async (candidate: (typeof candidates)[number]) => {
    if (connecting) return;
    setStatus({ kind: "connecting", repository: candidate.repository });
    try {
      const source = await actions.addGitHubSource(candidate.project.environmentId, {
        projectId: candidate.project.id,
        host: candidate.host,
        repository: candidate.repository,
      });
      setStatus(
        source === null
          ? { kind: "error", message: `Could not connect ${candidate.repository}. Try again.` }
          : { kind: "connected", repository: candidate.repository },
      );
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not connect the repository.",
      });
    }
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger render={<Button size="sm" variant={props.emptyState ? "outline" : "ghost"} />}>
        <GitHubIcon aria-hidden />
        {connecting
          ? "Connecting…"
          : props.emptyState
            ? "Connect a GitHub repository"
            : "Connect GitHub"}
      </MenuTrigger>
      <MenuPopup align={props.emptyState ? "center" : "end"} className="w-80">
        <MenuGroup>
          <MenuGroupLabel>Connect a project's GitHub repository</MenuGroupLabel>
          {status.kind === "connecting" || status.kind === "connected" ? (
            <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
              {status.kind === "connecting"
                ? `Connecting and syncing ${status.repository}…`
                : `Connected ${status.repository}.`}
            </p>
          ) : status.kind === "error" ? (
            <p role="alert" className="px-2 py-2 text-xs text-destructive-foreground">
              {status.message}
            </p>
          ) : null}
          {candidates.map((candidate) => (
            <MenuItem
              key={`${candidate.project.environmentId}:${candidate.project.id}:${candidate.host}:${candidate.repository}:${candidate.remoteName}`}
              disabled={connecting}
              closeOnClick={false}
              onClick={() => void connect(candidate)}
            >
              <GitHubIcon aria-hidden />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{candidate.repository}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {candidate.project.title}
                  {` · ${candidate.remoteName}`}
                  {connectedEnvironmentIds.length > 1
                    ? ` · ${environmentLabels.get(candidate.project.environmentId) ?? candidate.project.environmentId}`
                    : ""}
                  {candidate.host !== "github.com" ? ` · ${candidate.host}` : ""}
                </span>
              </span>
            </MenuItem>
          ))}
          {remotes.loading ? (
            <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
              Loading project remotes…
            </p>
          ) : null}
          {remotes.errors.map((error) => (
            <p key={error} role="alert" className="px-2 py-2 text-xs text-destructive-foreground">
              {error}
            </p>
          ))}
          {candidates.length === 0 &&
          !connecting &&
          !remotes.loading &&
          remotes.errors.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              {remotes.projects.some((project) => projectGitHubRemotes(project.remotes).length > 0)
                ? "All projects with a GitHub remote are already connected. Manage them in Settings > Tickets."
                : "No projects with a GitHub remote in connected environments. Add a project to connect its repository."}
            </p>
          ) : null}
          {lastError ? (
            <p role="alert" className="break-words px-2 py-2 text-xs text-destructive-foreground">
              {lastError.repository}: {lastError.lastError}
            </p>
          ) : null}
        </MenuGroup>
        <MenuSeparator />
        {candidates.length === 0 ? (
          <MenuItem
            onClick={() => openCommandPalette({ open: "add-project", completion: "select" })}
          >
            <PlusIcon aria-hidden />
            Add project
          </MenuItem>
        ) : null}
        <MenuItem onClick={() => void navigate({ to: "/settings/tickets" })}>
          <SettingsIcon aria-hidden />
          Manage in Settings &gt; Tickets
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
