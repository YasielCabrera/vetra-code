import type { EnvironmentId, IssueListState, ProjectId } from "@t3tools/contracts";
import { LoaderIcon, SearchIcon } from "lucide-react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { MenuSeparator } from "../ui/menu";
import {
  ALL_VALUE,
  ListFilterMenu,
  ListFilterProjectSubmenu,
  ListFilterRadioSubmenu,
  listFilterProjectKey,
  type ListFilterOption,
} from "../sourceControl/ListFilterMenu";

export type IssueFilterOption<Value extends string> = ListFilterOption<Value>;

/** The same value a pull-request row's project wears, so the two menus key their rows alike. */
export const issueProjectKey = listFilterProjectKey;

export function IssueSearchInput({
  value,
  busy,
  onChange,
}: {
  value: string;
  /** A search is on its way to the hosts, said where the typing is rather than over the list. */
  busy?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <InputGroup className="min-w-0 flex-1 **:[input]:h-9 sm:**:[input]:h-8">
      <InputGroupAddon>
        {busy ? <LoaderIcon aria-hidden className="animate-spin" /> : <SearchIcon aria-hidden />}
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder="Search issues, or label:bug"
        aria-label="Search issues"
      />
    </InputGroup>
  );
}

/**
 * Every issue-list filter behind one Filters button, the way the pull-request list does it:
 * state and assignee, then the host and server groups where a workspace has more than one of
 * either, then the projects. Each one is a row naming its current choice.
 */
export function IssueFiltersMenu({
  state,
  stateOptions,
  onState,
  assignee,
  assigneeOptions,
  onAssignee,
  host,
  hostOptions,
  onHost,
  server,
  serverOptions,
  onServer,
  projects,
  projectId,
  projectEnvironmentId,
  unavailable,
  onProject,
}: {
  state: IssueListState;
  stateOptions: ReadonlyArray<ListFilterOption<IssueListState>>;
  onState: (state: IssueListState) => void;
  assignee: string | undefined;
  /**
   * Includes the "anyone" entry, whose value is the empty string, then the two sentinels, then
   * whoever the loaded issues name. Never fewer than those three, so the group is always shown.
   */
  assigneeOptions: ReadonlyArray<ListFilterOption<string>>;
  onAssignee: (assignee: string | undefined) => void;
  host: string | undefined;
  /**
   * Includes the "all hosts" entry, whose value is the empty string. With fewer than two real
   * hosts there is nothing to switch between, so the whole group stays out of the menu.
   */
  hostOptions: ReadonlyArray<ListFilterOption<string>>;
  onHost: (host: string | undefined) => void;
  server: EnvironmentId | undefined;
  /** Same shape as the hosts; one server means nothing to switch between. */
  serverOptions: ReadonlyArray<ListFilterOption<string>>;
  onServer: (server: EnvironmentId | undefined) => void;
  projects: ReadonlyArray<{
    readonly id: ProjectId;
    readonly environmentId: EnvironmentId;
    readonly title: string;
    readonly workspaceRoot: string;
  }>;
  projectId: ProjectId | undefined;
  projectEnvironmentId: EnvironmentId | undefined;
  /** Projects whose repository could not be read this time round, named where they are chosen. */
  unavailable: ReadonlyMap<string, string>;
  onProject: (projectId: ProjectId | undefined, environmentId: EnvironmentId | undefined) => void;
}) {
  const filterCount = [
    state !== "open",
    assignee !== undefined,
    host !== undefined,
    server !== undefined,
    projectId !== undefined,
  ].filter(Boolean).length;
  return (
    <ListFilterMenu label="Filter issues" count={filterCount}>
      <ListFilterRadioSubmenu
        label="State"
        value={state}
        options={stateOptions}
        onChange={onState}
      />
      <MenuSeparator />
      <ListFilterRadioSubmenu
        label="Assignee"
        value={assignee ?? ALL_VALUE}
        options={assigneeOptions}
        onChange={(next) => onAssignee(next === ALL_VALUE ? undefined : next)}
      />
      {hostOptions.length > 2 ? (
        <>
          <MenuSeparator />
          <ListFilterRadioSubmenu
            label="Host"
            value={host ?? ALL_VALUE}
            options={hostOptions}
            onChange={(next) => onHost(next === ALL_VALUE ? undefined : next)}
          />
        </>
      ) : null}
      {serverOptions.length > 2 ? (
        <>
          <MenuSeparator />
          <ListFilterRadioSubmenu
            label="Server"
            value={server ?? ALL_VALUE}
            options={serverOptions}
            onChange={(next) => onServer(next === ALL_VALUE ? undefined : (next as EnvironmentId))}
          />
        </>
      ) : null}
      <MenuSeparator />
      <ListFilterProjectSubmenu
        projects={projects}
        projectId={projectId}
        projectEnvironmentId={projectEnvironmentId}
        unavailable={unavailable}
        onProject={onProject}
      />
    </ListFilterMenu>
  );
}
