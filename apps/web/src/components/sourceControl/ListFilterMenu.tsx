/**
 * The pieces every source-control list page filters with.
 *
 * Pull requests and issues narrow by different things, but they narrow the same way: one Filters
 * button carrying a count of whatever is off its default, a submenu per narrowing whose row
 * shows the current choice, and a project group whose rows name the server they belong to.
 * Those parts live here so the two menus read as one control rather than as two that happen to
 * look alike.
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
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
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
  /** A project row wears its own repository's icon, falling back to a repository glyph. */
  readonly favicon?: {
    readonly environmentId: EnvironmentId;
    readonly cwd: string;
  };
  /** Why it cannot be chosen, carried onto the item as its tooltip. */
  readonly unavailable?: string | undefined;
}

function ListFilterOptionIcon<Value extends string>({
  option,
}: {
  option: ListFilterOption<Value>;
}) {
  return option.favicon ? (
    <ProjectFavicon
      environmentId={option.favicon.environmentId}
      cwd={option.favicon.cwd}
      fallbackIcon={FolderGit2Icon}
      className="size-3.5 shrink-0"
    />
  ) : (
    <option.Icon aria-hidden className="size-3.5 shrink-0" />
  );
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
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <ListFilterOptionIcon option={option} />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {option.unavailable === undefined ? null : (
                <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] font-medium text-amber-600 dark:text-amber-400/90">
                  Unavailable
                </span>
              )}
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
 * A named group folded into one row, the way the pull-request menu shows them: the row carries
 * the group's current choice, and its options only unfold once the reader asks for them. Keeps
 * a menu with six narrowings the height of six rows rather than of every option in all of them.
 */
export function ListFilterRadioSubmenu<Value extends string>({
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
  const current = options.find((option) => option.value === value) ?? options[0];
  if (!current) return null;
  return (
    <MenuSub>
      <MenuSubTrigger>
        <ListFilterOptionIcon option={current} />
        <span className="flex-1">{label}</span>
        <span className="min-w-0 max-w-32 truncate text-xs text-muted-foreground">
          {current.label}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="min-w-56">
        <ListFilterRadioGroup label={label} value={value} options={options} onChange={onChange} />
      </MenuSubPopup>
    </MenuSub>
  );
}

/**
 * The project group both menus end on. Projects whose repository could not be read this time
 * round are named here, where the reader is already choosing between projects, rather than as a
 * count above the list that says something is missing without saying which.
 */
export function ListFilterProjectSubmenu({
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
  const options: ReadonlyArray<ListFilterOption<string>> = [
    { value: ALL_PROJECTS_VALUE, label: "All projects", Icon: LayersIcon },
    // The ones that can be chosen first: a list that opens with three disabled rows reads as a
    // broken menu rather than as a workspace with three unreadable repositories.
    ...projects
      .toSorted(
        (left, right) =>
          Number(unavailable.has(listFilterProjectKey(left))) -
          Number(unavailable.has(listFilterProjectKey(right))),
      )
      .map((project) => {
        const reason = unavailable.get(listFilterProjectKey(project));
        return {
          value: listFilterProjectKey(project),
          label: project.title,
          Icon: FolderGit2Icon,
          favicon: { environmentId: project.environmentId, cwd: project.workspaceRoot },
          ...(reason === undefined ? {} : { unavailable: reason }),
        };
      }),
  ];
  return (
    <ListFilterRadioSubmenu
      label="Project"
      value={
        projectId === undefined || projectEnvironmentId === undefined
          ? ALL_PROJECTS_VALUE
          : listFilterProjectKey({ id: projectId, environmentId: projectEnvironmentId })
      }
      options={options}
      onChange={(next) => {
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
    />
  );
}

/**
 * The one filter control a list page's narrowings live behind, so the control row stays three
 * controls wide: the search, this, and the refresh. The trigger carries a count of the filters
 * that are off their default, so a narrowed list is never a mystery.
 */
export function ListFilterMenu({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            className={cn(count > 0 && "[--control-icon-color:currentColor]")}
            variant="outline"
            aria-label={label}
          />
        }
      >
        <ListFilterIcon className="size-4" />
        <span>Filters</span>
        {count > 0 ? (
          <span className="rounded-full bg-primary/10 px-1.5 text-xs text-primary tabular-nums">
            {count}
          </span>
        ) : null}
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="w-56">
        {children}
      </MenuPopup>
    </Menu>
  );
}
