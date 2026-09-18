import { useAtomValue } from "@effect/atom-react";
import { createIssueEnvironmentAtoms } from "@t3tools/client-runtime/state/issues";
import type {
  EnvironmentId,
  IssueListCursors,
  IssueListEntry,
  IssueListInput,
  IssueListProjectError,
  IssueProviderSummary,
  IssueRepositorySummary,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useMemo } from "react";

import { connectionAtomRuntime } from "../connection/runtime";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { formatEnvironmentQueryError } from "./query";

export const issueEnvironment = createIssueEnvironmentAtoms(connectionAtomRuntime);

export interface EnvironmentIssueEntry extends IssueListEntry {
  readonly environmentId: EnvironmentId;
}

export interface EnvironmentIssueProvider extends IssueProviderSummary {
  readonly environmentId: EnvironmentId;
}

export interface EnvironmentIssueRepository extends IssueRepositorySummary {
  readonly environmentId: EnvironmentId;
}

export interface EnvironmentIssueProjectError extends IssueListProjectError {
  readonly environmentId: EnvironmentId;
}

export interface MergedIssueList {
  readonly entries: ReadonlyArray<EnvironmentIssueEntry>;
  readonly providers: ReadonlyArray<EnvironmentIssueProvider>;
  readonly repositories: ReadonlyArray<EnvironmentIssueRepository>;
  readonly errors: ReadonlyArray<EnvironmentIssueProjectError>;
  readonly truncated: boolean;
  /** Each environment's repository cursors stay scoped to the server that issued them. */
  readonly nextCursors: Readonly<Record<string, IssueListCursors>>;
}

export interface IssueEnvironmentQueryTarget {
  readonly environmentId: EnvironmentId;
  readonly input: IssueListInput;
}

const listFamily = Atom.family((key: string) =>
  Atom.make((get) => {
    const targets = JSON.parse(key) as ReadonlyArray<IssueEnvironmentQueryTarget>;
    const entries: EnvironmentIssueEntry[] = [];
    const providers: EnvironmentIssueProvider[] = [];
    const repositories: EnvironmentIssueRepository[] = [];
    const errors: EnvironmentIssueProjectError[] = [];
    const nextCursors: Record<string, IssueListCursors> = {};
    let truncated = false;
    let error: string | null = null;
    let isPending = false;
    let answered = 0;
    for (const target of targets) {
      const result = get(issueEnvironment.list(target));
      isPending ||= result.waiting;
      if (result._tag === "Failure" && error === null) {
        error = formatEnvironmentQueryError(result.cause);
      }
      const value = Option.getOrNull(AsyncResult.value(result));
      if (value === null) continue;
      answered += 1;
      entries.push(
        ...value.entries.map((entry) => ({ ...entry, environmentId: target.environmentId })),
      );
      providers.push(
        ...value.providers.map((provider) => ({
          ...provider,
          environmentId: target.environmentId,
        })),
      );
      repositories.push(
        ...value.repositories.map((repository) => ({
          ...repository,
          environmentId: target.environmentId,
        })),
      );
      errors.push(
        ...value.errors.map((projectError) => ({
          ...projectError,
          environmentId: target.environmentId,
        })),
      );
      truncated ||= value.truncated;
      if (Object.keys(value.nextCursors).length > 0) {
        nextCursors[target.environmentId] = value.nextCursors;
      }
    }
    entries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const data: MergedIssueList | null =
      answered === 0 ? null : { entries, providers, repositories, errors, truncated, nextCursors };
    return { data, error, isPending };
  }).pipe(Atom.withLabel(`web-issues:list:${key}`)),
);

const emptyList = Atom.make({
  data: null as MergedIssueList | null,
  error: null as string | null,
  isPending: false,
}).pipe(Atom.withLabel("web-issues:list:empty"));

export function issueEntryKey(entry: EnvironmentIssueEntry): string {
  return `${entry.environmentId}:${entry.host}:${entry.repository}:${entry.number}`;
}

export function useIssueList(targets: ReadonlyArray<IssueEnvironmentQueryTarget>) {
  const key = useMemo(() => JSON.stringify(targets), [targets]);
  const view = useAtomValue(targets.length === 0 ? emptyList : listFamily(key));
  const refresh = useCallback(() => {
    for (const target of JSON.parse(key) as ReadonlyArray<IssueEnvironmentQueryTarget>) {
      appAtomRegistry.refresh(issueEnvironment.list(target));
    }
  }, [key]);
  return { ...view, refresh };
}
