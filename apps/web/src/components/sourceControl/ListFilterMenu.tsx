/**
 * The pieces every source-control list page filters with.
 *
 * Pull requests and issues narrow by different things, but they narrow the same way: one filter
 * icon holding radio groups, a dot on the trigger whenever anything is off its default, and a
 * project group whose rows name the server they belong to. Those parts live here so the two
 * menus read as one control rather than as two that happen to look alike.
 */
import type { EnvironmentId, ProjectId, SourceControlProviderKind } from "@vetra-code/contracts";
import { FolderGit2Icon, LayersIcon, ListFilterIcon } from "lucide-react";
import type { ElementType, ReactNode } from "react";

import { cn } from "~/lib/utils";
import { getSourceControlPresentationForKind } from "~/sourceControlPresentation";

import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

export interface ListFilterOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  /**
   * Carries the option's own tone, so an icon reads the same here as it does on a row. Left
   * uncoloured, which lets the item's selected state stay the thing the eye follows.
   */
  readonly Icon: ElementType<{ className?: string }>;
  /** Why it cannot be chosen, carried onto the item as its tooltip. */
  readonly unavailable?: string | undefined;
}

/**
 * What to call a host in a filter row. The provider's own name reads best — "GitHub" over
 * "github.com" — but it stops naming anything once a workspace has two hosts of one kind, so
 * those wear the host itself instead. Only the ambiguous ones: a lone GitLab beside two GitHub
 * installs is still "GitLab".
 */
export function sourceControlHostLabel(
  entries: ReadonlyArray<{ readonly host: string; readonly kind: SourceControlProviderKind }>,
  entry: { readonly host: string; readonly kind: SourceControlProviderKind },
): string {
  const sharing = entries.filter((candidate) => candidate.kind === entry.kind);
  return sharing.length > 1
    ? entry.host
    : getSourceControlPresentationForKind(entry.kind).providerName;
}

/** The value "every one of them" wears, which no real host or server id can collide with. */
export const ALL_VALUE = "";
/** The unset value of a named group, which no filter of theirs is named after. */
export const UNFILTERED_VALUE = "all";

/**
 * A project's own radio value, carrying the server along with the id: the id alone is only
 * unique within its own server, so two rows sharing one would otherwise both read as checked.
 */
export const listFilterProjectKey = (project: {
  readonly id: ProjectId;
  readonly environmentId: EnvironmentId;
}) => JSON.stringify([project.environmentId, project.id]);

export function ListFilterRadioGroup<Value extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: Value;
  options: ReadonlyArray<ListFilterOption<Value>>;
  onChange: (value: Value) => void;
}) {
  return (
    <MenuRadioGroup
      value={value}
      onValueChange={(next) => {
        if (next !== value) onChange(next as Value);
      }}
    >
      <MenuGroupLabel>{label}</MenuGroupLabel>
      {options.map((option) => {
        // A host the server has already said it cannot read is not a choice here: offering
        // it would answer the press by replacing a working list with that failure.
        const item = (
          <MenuRadioItem
            key={option.value}
            value={option.value}
            className={option.unavailable ? "data-disabled:pointer-events-auto" : undefined}
            disabled={option.unavailable !== undefined}
          >
            <span className="flex min-w-0 items-center gap-2">
              <option.Icon aria-hidden className="size-3.5" />
              {option.label}
            </span>
          </MenuRadioItem>
        );
        if (!option.unavailable) return item;
        return (
          <Tooltip key={option.value}>
            <TooltipTrigger render={item} />
            <TooltipPopup side="top" className="max-w-80">
              {option.unavailable}
            </TooltipPopup>
          </Tooltip>
        );
      })}
    </MenuRadioGroup>
  );
}

const ALL_PROJECTS_VALUE = "all";

/**
 * The project group both menus end on. Projects whose repository could not be read this time
 * round are named here, where the reader is already choosing between projects, rather than as a
 * count above the list that says something is missing without saying which.
 */
export function ListFilterProjectGroup({
  projects,
  projectId,
  projectEnvironmentId,
  unavailable,
  onProject,
}: {
  projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly title: string;
    readonly workspaceRoot: string;
  }>;
  projectId: ProjectId | undefined;
  /**
   * The server the selected project belongs to. A project id is only unique within its own
   * server, so without this two rows sharing an id would both read as checked here.
   */
  projectEnvironmentId: EnvironmentId | undefined;
  unavailable: ReadonlyMap<string, string>;
  /** The environment comes with the id, since picking a row picks a specific server's copy of it. */
  onProject: (projectId: ProjectId | undefined, environmentId: EnvironmentId | undefined) => void;
}) {
  return (
    <MenuRadioGroup
      value={
        projectId === undefined || projectEnvironmentId === undefined
          ? ALL_PROJECTS_VALUE
          : listFilterProjectKey({ id: projectId, environmentId: projectEnvironmentId })
      }
      onValueChange={(next) => {
        if (next === ALL_PROJECTS_VALUE) {
          if (projectId !== undefined) onProject(undefined, undefined);
          return;
        }
        // The value carries both halves, since the id alone cannot tell two servers' rows
        // apart once they share one.
        const project = projects.find((candidate) => listFilterProjectKey(candidate) === next);
        if (
          project !== undefined &&
          (project.id !== projectId || project.environmentId !== projectEnvironmentId)
        ) {
          onProject(project.id, project.environmentId);
        }
      }}
    >
      <MenuGroupLabel>Project</MenuGroupLabel>
      <MenuRadioItem value={ALL_PROJECTS_VALUE}>
        <span className="flex min-w-0 items-center gap-2">
          <LayersIcon aria-hidden className="size-3.5" />
          All projects
        </span>
      </MenuRadioItem>
      {/* The ones that can be chosen first: a list that opens with three disabled rows reads
          as a broken menu rather than as a workspace with three unreadable repositories. */}
      {projects
        .toSorted(
          (left, right) =>
            Number(unavailable.has(listFilterProjectKey(left))) -
            Number(unavailable.has(listFilterProjectKey(right))),
        )
        .map((project) => {
          const reason = unavailable.get(listFilterProjectKey(project));
          const item = (
            <MenuRadioItem
              key={listFilterProjectKey(project)}
              value={listFilterProjectKey(project)}
              className={reason !== undefined ? "data-disabled:pointer-events-auto" : undefined}
              disabled={reason !== undefined}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <ProjectFavicon
                  environmentId={project.environmentId}
                  cwd={project.workspaceRoot}
                  fallbackIcon={FolderGit2Icon}
                  className="size-3.5 shrink-0"
                />
                <span className="min-w-0 flex-1 truncate">{project.title}</span>
                {reason === undefined ? null : (
                  <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400/90">
                    Unavailable
                  </span>
                )}
              </span>
            </MenuRadioItem>
          );
          if (reason === undefined) return item;
          return (
            <Tooltip key={listFilterProjectKey(project)}>
              <TooltipTrigger render={item} />
              <TooltipPopup side="top" className="max-w-80">
                {reason}
              </TooltipPopup>
            </Tooltip>
          );
        })}
    </MenuRadioGroup>
  );
}

/**
 * The one filter icon a list page's narrowings live behind, so the control row stays two
 * controls wide: the search and this. The trigger carries a dot whenever any filter is off its
 * default, so a narrowed list is never a mystery.
 */
export function ListFilterMenu({
  label,
  filtered,
  children,
}: {
  label: string;
  filtered: boolean;
  children: ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            className={cn("relative", filtered && "[--control-icon-color:currentColor]")}
            size="icon"
            variant="outline"
            aria-label={label}
          />
        }
      >
        <ListFilterIcon className="size-4" />
        {filtered ? (
          <span
            aria-hidden
            className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary"
          />
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="min-w-56">
        {children}
      </MenuPopup>
    </Menu>
  );
}
