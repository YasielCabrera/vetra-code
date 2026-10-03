import { useNavigate } from "@tanstack/react-router";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/models";
import { type EnvironmentId, type ProjectId, type TicketDetail } from "@t3tools/contracts";
import { ArrowLeftRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { useTicketActions } from "../../hooks/useTicketActions";
import { useProjects } from "../../state/entities";
import { useTicketGitHubSources } from "../../state/tickets";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Combobox,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxSearchInput,
  ComboboxTrigger,
} from "../ui/combobox";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { availableTicketProjects, projectChangeWouldLoseIssueAccess } from "./ticketProjects.logic";

const MAX_VISIBLE_PROJECTS = 50;

function ProjectPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly linkedProjectIds: ReadonlyArray<ProjectId>;
  readonly replaceTitle: string | null;
  readonly disabled: boolean;
  readonly onSelect: (projectId: ProjectId) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const candidates = useMemo(
    () =>
      open
        ? availableTicketProjects({
            environmentId: props.environmentId,
            projects: props.projects,
            linkedProjectIds: props.linkedProjectIds,
            query,
          })
        : [],
    [open, props.environmentId, props.projects, props.linkedProjectIds, query],
  );
  const visible = candidates.slice(0, MAX_VISIBLE_PROJECTS);
  const ids = visible.map((project) => project.id);
  const label =
    props.replaceTitle === null ? "Add project" : `Change project ${props.replaceTitle}`;
  return (
    <Combobox
      items={ids}
      filteredItems={ids}
      filter={null}
      autoHighlight
      value={null}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
      onValueChange={(id) => {
        if (id !== null && !props.disabled) props.onSelect(id);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <ComboboxTrigger
              render={
                <Button
                  size={props.replaceTitle === null ? "xs" : "icon-xs"}
                  variant="ghost"
                  disabled={props.disabled}
                  aria-label={label}
                />
              }
            >
              {props.replaceTitle === null ? (
                <>
                  <PlusIcon aria-hidden />
                  Add project
                </>
              ) : (
                <ArrowLeftRightIcon aria-hidden />
              )}
            </ComboboxTrigger>
          }
        />
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      <ComboboxPopup align="start" className="w-72">
        {props.replaceTitle !== null ? (
          <p className="px-3 pt-2 text-xs text-muted-foreground">Replace {props.replaceTitle}</p>
        ) : null}
        <ComboboxSearchInput
          aria-label="Search projects"
          placeholder="Search projects…"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <ComboboxList>
          {visible.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              {query.trim()
                ? "No projects match your search."
                : "No other projects in this environment."}
            </p>
          ) : (
            visible.map((project, index) => (
              <ComboboxItem
                key={project.id}
                value={project.id}
                index={index}
                disabled={props.disabled}
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate">{project.title}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {project.workspaceRoot}
                  </span>
                </span>
              </ComboboxItem>
            ))
          )}
          {candidates.length > MAX_VISIBLE_PROJECTS ? (
            <p className="p-2 text-xs text-muted-foreground">
              Search to narrow {candidates.length} projects.
            </p>
          ) : null}
        </ComboboxList>
      </ComboboxPopup>
    </Combobox>
  );
}

export function TicketProjectsEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly detail: TicketDetail;
}) {
  const navigate = useNavigate();
  const projects = useProjects();
  const sources = useTicketGitHubSources();
  const actions = useTicketActions();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const linkedProjectIds = useMemo(
    () =>
      props.detail.links.flatMap((link) =>
        link.target.kind === "project" ? [link.target.projectId] : [],
      ),
    [props.detail.links],
  );
  const projectTitleById = useMemo(
    () =>
      new Map(
        projects
          .filter((project) => project.environmentId === props.environmentId)
          .map((project) => [project.id, project.title]),
      ),
    [projects, props.environmentId],
  );

  const changeProject = async (
    removeProjectId: ProjectId | null,
    replacementProjectId: ProjectId | null,
  ) => {
    if (busy.current) return;
    if (
      removeProjectId !== null &&
      projectChangeWouldLoseIssueAccess({
        environmentId: props.environmentId,
        repository: props.detail.summary.kind === "github" ? props.detail.summary.github : null,
        context: { sources, projects, linkedProjectIds },
        removeProjectId,
        replacementProjectId,
      })
    ) {
      toastManager.add(
        stackedThreadToast({
          type: "warning",
          title: "Keep a project for this GitHub repository",
          description:
            "This project is needed to read the issue. Add or choose another project for the same repository first.",
        }),
      );
      return;
    }
    busy.current = true;
    setPending(true);
    const ref = { environmentId: props.environmentId, ticketId: props.detail.summary.id };
    try {
      if (
        replacementProjectId !== null &&
        (await actions.link(ref, { kind: "project", projectId: replacementProjectId })) === null
      )
        return;
      if (removeProjectId !== null) await actions.unlink(ref, "project", removeProjectId);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const pickerProps = {
    environmentId: props.environmentId,
    projects,
    linkedProjectIds,
    disabled: pending,
  };
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 pt-1" aria-busy={pending}>
      <div className="flex w-full min-w-0 flex-wrap items-center gap-1">
        {linkedProjectIds.map((projectId) => {
          const title = projectTitleById.get(projectId);
          return (
            <div key={projectId} className="flex min-w-0 max-w-full items-center gap-0.5">
              <Badge variant="secondary" className="min-w-0 shrink">
                {title === undefined ? (
                  <span className="truncate text-muted-foreground italic">Missing project</span>
                ) : (
                  <button
                    type="button"
                    aria-label={`Tickets in ${title}`}
                    className="min-w-0 truncate hover:underline"
                    onClick={() =>
                      void navigate({
                        to: "/tickets",
                        search: { project: `${props.environmentId}:${projectId}` },
                      })
                    }
                  >
                    {title}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Unlink ${title ?? "missing project"}`}
                  disabled={pending}
                  className="-me-0.5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => void changeProject(projectId, null)}
                >
                  <XIcon aria-hidden className="size-3" />
                </button>
              </Badge>
              <ProjectPicker
                {...pickerProps}
                replaceTitle={title ?? "missing project"}
                onSelect={(id) => void changeProject(projectId, id)}
              />
            </div>
          );
        })}
      </div>
      <ProjectPicker
        {...pickerProps}
        replaceTitle={null}
        onSelect={(id) => void changeProject(null, id)}
      />
    </div>
  );
}
