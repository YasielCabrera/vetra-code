import type {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
  SourceControlProviderKind,
} from "@vetra-code/contracts";
import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  CircleXIcon,
  EyeOffIcon,
  GitPullRequestDraftIcon,
  LayersIcon,
  LoaderIcon,
  SearchIcon,
} from "lucide-react";

import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { MenuSeparator } from "../ui/menu";
import {
  ALL_VALUE,
  ListFilterMenu,
  ListFilterProjectGroup,
  ListFilterRadioGroup,
  UNFILTERED_VALUE,
  listFilterProjectKey,
  sourceControlHostLabel,
  type ListFilterOption,
} from "../sourceControl/ListFilterMenu";

export type PullRequestFilterOption<Value extends string> = ListFilterOption<Value>;

export interface PullRequestExpectedHost {
  readonly host: string;
  readonly kind: SourceControlProviderKind;
}

export const pullRequestHostLabel = sourceControlHostLabel;

export function PullRequestSearchInput({
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
        placeholder="Search pull requests, or label:bug"
        aria-label="Search pull requests"
      />
    </InputGroup>
  );
}

/**
 * Every list filter lives behind the one filter icon so the control row stays two controls
 * wide: the search and this. The trigger carries a dot whenever any filter is off its
 * default, so a narrowed list is never a mystery. Same menu chrome as the detail panel's
 * actions, which also owns its own spacing.
 */
export const pullRequestProjectKey = listFilterProjectKey;

const DRAFT_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "only", label: "Drafts only", Icon: GitPullRequestDraftIcon },
  { value: "hide", label: "Hide drafts", Icon: EyeOffIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

const REVIEW_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "approved", label: "Approved", Icon: CircleCheckIcon },
  { value: "changes-requested", label: "Changes requested", Icon: CircleXIcon },
  { value: "review-required", label: "Review required", Icon: CircleDashedIcon },
  { value: "none", label: "No reviews", Icon: CircleSlashIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

const CHECKS_OPTIONS = [
  { value: UNFILTERED_VALUE, label: "All", Icon: LayersIcon },
  { value: "passing", label: "Passing", Icon: CircleCheckIcon },
  { value: "failing", label: "Failing", Icon: CircleXIcon },
] as const satisfies ReadonlyArray<PullRequestFilterOption<string>>;

export function PullRequestFiltersMenu({
  state,
  stateOptions,
  onState,
  involvement,
  involvementOptions,
  onInvolvement,
  filters,
  onFilters,
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
  state: PullRequestListState;
  stateOptions: ReadonlyArray<PullRequestFilterOption<PullRequestListState>>;
  onState: (state: PullRequestListState) => void;
  involvement: PullRequestInvolvement;
  involvementOptions: ReadonlyArray<PullRequestFilterOption<PullRequestInvolvement>>;
  onInvolvement: (involvement: PullRequestInvolvement) => void;
  /** The narrowings beyond state and involvement; an absent field is that group unfiltered. */
  filters: PullRequestListFilters;
  onFilters: (filters: PullRequestListFilters) => void;
  host: string | undefined;
  /**
   * Includes the "all hosts" entry, whose value is the empty string. With fewer than two real
   * hosts there is nothing to switch between, so the whole group stays out of the menu.
   */
  hostOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onHost: (host: string | undefined) => void;
  server: EnvironmentId | undefined;
  /**
   * Includes the "all servers" entry, whose value is the empty string. With one server there is
   * nothing to switch between, so the whole group stays out of the menu.
   */
  serverOptions: ReadonlyArray<PullRequestFilterOption<string>>;
  onServer: (server: EnvironmentId | undefined) => void;
  /** The projects of every connected environment, each carrying the one its favicon is read from. */
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
  /**
   * Projects whose repository could not be read this time round. They are named here, where
   * the reader is already choosing between projects, rather than as a count above the list
   * that says something is missing without saying which.
   */
  unavailable: ReadonlyMap<string, string>;
  /** The environment comes with the project id, since picking a row picks a specific server's copy of it. */
  onProject: (projectId: ProjectId | undefined, environmentId: EnvironmentId | undefined) => void;
}) {
  const filtered =
    state !== "open" ||
    involvement !== "all" ||
    host !== undefined ||
    server !== undefined ||
    projectId !== undefined ||
    Object.keys(filters).length > 0;
  /**
   * Rebuilt rather than spread so an unfiltered group leaves the record instead of lingering in
   * it as an explicit `undefined`, which the listing input does not accept.
   */
  const withFilter = (key: keyof PullRequestListFilters, value: string): PullRequestListFilters =>
    Object.fromEntries(
      Object.entries({ ...filters, [key]: value === UNFILTERED_VALUE ? undefined : value }).filter(
        ([, held]) => held !== undefined,
      ),
    ) as PullRequestListFilters;
  return (
    <ListFilterMenu label="Filter pull requests" filtered={filtered}>
      <ListFilterRadioGroup label="State" value={state} options={stateOptions} onChange={onState} />
      <MenuSeparator />
      <ListFilterRadioGroup
        label="Involvement"
        value={involvement}
        options={involvementOptions}
        onChange={onInvolvement}
      />
      <MenuSeparator />
      <ListFilterRadioGroup
        label="Draft"
        value={filters.draft ?? UNFILTERED_VALUE}
        options={DRAFT_OPTIONS}
        onChange={(next) => onFilters(withFilter("draft", next))}
      />
      <MenuSeparator />
      <ListFilterRadioGroup
        label="Review"
        value={filters.review ?? UNFILTERED_VALUE}
        options={REVIEW_OPTIONS}
        onChange={(next) => onFilters(withFilter("review", next))}
      />
      <MenuSeparator />
      <ListFilterRadioGroup
        label="Checks"
        value={filters.checks ?? UNFILTERED_VALUE}
        options={CHECKS_OPTIONS}
        onChange={(next) => onFilters(withFilter("checks", next))}
      />
      {hostOptions.length > 2 ? (
        <>
          <MenuSeparator />
          <ListFilterRadioGroup
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
          <ListFilterRadioGroup
            label="Server"
            value={server ?? ALL_VALUE}
            options={serverOptions}
            onChange={(next) => onServer(next === ALL_VALUE ? undefined : (next as EnvironmentId))}
          />
        </>
      ) : null}
      <MenuSeparator />
      <ListFilterProjectGroup
        projects={projects}
        projectId={projectId}
        projectEnvironmentId={projectEnvironmentId}
        unavailable={unavailable}
        onProject={onProject}
      />
    </ListFilterMenu>
  );
}
