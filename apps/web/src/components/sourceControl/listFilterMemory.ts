/**
 * What the issues list was last narrowed to, so coming back to it lands on the view the reader
 * chose rather than on the default one. Pull requests keep their own scope in
 * `pullRequestListPreferences`.
 *
 * Only the filter menu's own groups are kept. The search text and the open row belong to a
 * visit rather than to the page: text left in the box would come back as a list narrowed by
 * something nobody typed this time. Written when a filter is picked and read by whatever
 * navigates to the page, which leaves the URL the only thing that says what a list shows — a
 * link naming its own filters is still obeyed exactly as written, because nothing merges these
 * in behind it.
 */
import {
  EnvironmentId as EnvironmentIdSchema,
  IssueAssigneeFilter,
  IssueListState,
  ProjectId as ProjectIdSchema,
  TrimmedNonEmptyString,
  type EnvironmentId,
  type ProjectId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

export const ISSUE_LIST_FILTERS_STORAGE_KEY = "vetra:issues-filters:v1";

/** Bounded the same way the pages bound a host read out of a URL. */
const FilterHost = TrimmedNonEmptyString.check(Schema.isMaxLength(200));

const RememberedIssueFilters = Schema.Struct({
  state: IssueListState,
  assignee: Schema.optionalKey(IssueAssigneeFilter),
  host: Schema.optionalKey(FilterHost),
  environmentId: Schema.optionalKey(EnvironmentIdSchema),
  projectId: Schema.optionalKey(ProjectIdSchema),
});
export type RememberedIssueFilters = typeof RememberedIssueFilters.Type;

/** What each page shows a reader who has never narrowed it. */
const ISSUE_FILTER_DEFAULTS: RememberedIssueFilters = { state: "open" };

/**
 * A record that cannot be read is one nobody can act on: the page opens on its defaults rather
 * than refusing to open, and the next filter the reader picks writes a good record over it.
 */
function readFilters<T, E>(key: string, schema: Schema.Codec<T, E>, fallback: T): T {
  try {
    return getLocalStorageItem(key, schema) ?? fallback;
  } catch (error) {
    console.error("[LISTFILTERS] Could not read remembered filters.", error);
    return fallback;
  }
}

function writeFilters<T, E>(key: string, schema: Schema.Codec<T, E>, value: T) {
  try {
    setLocalStorageItem(key, value, schema);
  } catch (error) {
    console.error("[LISTFILTERS] Could not remember filters.", error);
  }
}

/** Keeps what the issues filter menu narrows by, dropping everything else the page carries. */
export function rememberIssueFilters(search: {
  readonly state: IssueListState;
  readonly assignee?: string | undefined;
  readonly host?: string | undefined;
  readonly environmentId?: EnvironmentId | undefined;
  readonly projectId?: ProjectId | undefined;
}) {
  writeFilters(ISSUE_LIST_FILTERS_STORAGE_KEY, RememberedIssueFilters, {
    state: search.state,
    ...(search.assignee === undefined ? {} : { assignee: search.assignee }),
    ...(search.host === undefined ? {} : { host: search.host }),
    ...(search.environmentId === undefined ? {} : { environmentId: search.environmentId }),
    ...(search.projectId === undefined ? {} : { projectId: search.projectId }),
  });
}

/** The search a plain visit to the issues page opens with. */
export function rememberedIssueFilters(): RememberedIssueFilters {
  return readFilters(ISSUE_LIST_FILTERS_STORAGE_KEY, RememberedIssueFilters, ISSUE_FILTER_DEFAULTS);
}
