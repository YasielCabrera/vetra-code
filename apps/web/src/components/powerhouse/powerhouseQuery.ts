import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import type { PowerhouseDatabaseError, PowerhouseReactorError } from "@vetra-code/contracts";
import * as Cause from "effect/Cause";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useState } from "react";

export interface ReactorQueryView<A> {
  readonly data: A | null;
  /**
   * The decoded failure, not a message: the connection card's wording depends
   * on which failure it was and which addresses were tried.
   */
  readonly error: PowerhouseReactorError | null;
  /** Set when the failure was something other than a reactor failure. */
  readonly otherError: string | null;
  /** A failed refresh may still carry stale data from the previous success. */
  readonly isFailure: boolean;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

const EMPTY_ATOM = Atom.make(AsyncResult.initial<never, never>(false)).pipe(
  Atom.withLabel("powerhouse-query:empty"),
) as unknown as Atom.Atom<AsyncResult.AsyncResult<never, never>>;

const isReactorError = (value: unknown): value is PowerhouseReactorError =>
  Predicate.isObject(value) && value._tag === "PowerhouseReactorError";

const isDatabaseError = (value: unknown): value is PowerhouseDatabaseError =>
  Predicate.isObject(value) && value._tag === "PowerhouseDatabaseError";

export interface DatabaseQueryView<A> {
  readonly data: A | null;
  readonly error: PowerhouseDatabaseError | null;
  readonly errorMessage: string | null;
  readonly isFailure: boolean;
  readonly isPending: boolean;
  readonly refresh: () => void;
}

/** Query view that preserves the inspector's structured failure variant. */
export function useDatabaseQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): DatabaseQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ATOM;
  const result = useAtomValue(selectedAtom);
  const refreshAtom = useAtomRefresh(selectedAtom);
  const refresh = useCallback(() => refreshAtom(), [refreshAtom]);
  const squashed = result._tag === "Failure" ? Cause.squash(result.cause) : null;
  const databaseError = isDatabaseError(squashed) ? squashed : null;
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: databaseError,
    errorMessage:
      squashed === null
        ? null
        : squashed instanceof Error && squashed.message.trim().length > 0
          ? squashed.message
          : "The database request failed.",
    isFailure: result._tag === "Failure",
    isPending: atom !== null && result.waiting,
    refresh,
  };
}

/**
 * Like `useEnvironmentQuery`, but keeps the typed reactor error instead of
 * flattening it to a string.
 */
export function useReactorQuery<A, E>(
  atom: Atom.Atom<AsyncResult.AsyncResult<A, E>> | null,
): ReactorQueryView<A> {
  const selectedAtom = atom ?? EMPTY_ATOM;
  const result = useAtomValue(selectedAtom);
  const refreshAtom = useAtomRefresh(selectedAtom);
  const refresh = useCallback(() => refreshAtom(), [refreshAtom]);
  const squashed = result._tag === "Failure" ? Cause.squash(result.cause) : null;
  const reactorError = isReactorError(squashed) ? squashed : null;
  return {
    data: Option.getOrNull(AsyncResult.value(result)),
    error: reactorError,
    otherError:
      squashed === null || reactorError !== null
        ? null
        : squashed instanceof Error && squashed.message.trim().length > 0
          ? squashed.message
          : "The reactor request failed.",
    isFailure: result._tag === "Failure",
    isPending: atom !== null && result.waiting,
    refresh,
  };
}

interface LoadedPage<Item> {
  readonly items: ReadonlyArray<Item>;
  readonly nextCursor: string | null;
}

/**
 * Cursor paging for a list whose pages are separate queries.
 *
 * Callers render one fetcher per cursor and report each page back here. The
 * merged list drops repeats, because a live reactor can shift its window
 * between two fetches and hand back the same document twice.
 */
/** Stable key that cannot collide with a reactor-issued cursor such as `first`. */
export const cursorPageKey = (cursor: string | null) =>
  cursor === null ? "initial" : `cursor:${cursor}`;

export function useCursorPages<Item>(identify: (item: Item) => string) {
  const [cursors, setCursors] = useState<ReadonlyArray<string | null>>([null]);
  const [pages, setPages] = useState<ReadonlyMap<string, LoadedPage<Item>>>(new Map());

  const reportPage = useCallback((cursor: string | null, page: LoadedPage<Item>) => {
    setPages((previous) => {
      const key = cursorPageKey(cursor);
      const existing = previous.get(key);
      if (existing?.items === page.items && existing?.nextCursor === page.nextCursor) {
        return previous;
      }
      const next = new Map(previous);
      next.set(key, page);
      return next;
    });
  }, []);

  const loadMore = useCallback((nextCursor: string) => {
    setCursors((previous) =>
      previous.includes(nextCursor) ? previous : [...previous, nextCursor],
    );
  }, []);

  const reset = useCallback(() => {
    setCursors([null]);
    setPages(new Map());
  }, []);

  const items = useMemo(() => {
    const merged: Array<Item> = [];
    const seen = new Set<string>();
    for (const cursor of cursors) {
      for (const item of pages.get(cursorPageKey(cursor))?.items ?? []) {
        const key = identify(item);
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    }
    return merged;
  }, [cursors, identify, pages]);

  const lastCursor = cursors[cursors.length - 1] ?? null;
  const lastPage = pages.get(cursorPageKey(lastCursor));
  const nextCursor =
    lastPage === undefined || lastPage.items.length === 0 ? null : lastPage.nextCursor;

  return { cursors, items, lastCursor, nextCursor, reportPage, loadMore, reset };
}

export interface PageStatus {
  readonly pending: boolean;
  readonly error: string | null;
}

/**
 * Pending and error state of the active (last requested) page. Earlier pages
 * may revalidate later, but they must not overwrite the load-more footer.
 */
const INITIAL_PAGE_STATUS: PageStatus = { pending: true, error: null };

export function usePageStatus(activeCursor: string | null) {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, PageStatus>>(new Map());
  const report = useCallback((cursor: string | null, next: PageStatus) => {
    setStatuses((previous) => {
      const key = cursorPageKey(cursor);
      const existing = previous.get(key);
      if (existing?.pending === next.pending && existing.error === next.error) return previous;
      const updated = new Map(previous);
      updated.set(key, next);
      return updated;
    });
  }, []);
  const reset = useCallback(() => setStatuses(new Map()), []);
  return [statuses.get(cursorPageKey(activeCursor)) ?? INITIAL_PAGE_STATUS, report, reset] as const;
}

/**
 * How early the next page is requested. Enough that a steady scroll never hits
 * a hard stop, small enough that opening a list does not pull pages nobody
 * looks at.
 */
const LIST_END_PREFETCH_MARGIN = "256px";

/**
 * Whether the end of a list coming into view should pull another page.
 *
 * A failed page stops the run instead of hammering a reactor that just refused;
 * the inline notice and the list's reload control are the way forward from
 * there. A pending page stops it too, so one visible sentinel cannot queue the
 * same cursor twice.
 */
export function canAutoLoadNextPage(nextCursor: string | null, status: PageStatus): boolean {
  return nextCursor !== null && !status.pending && status.error === null;
}

/**
 * Pulls the next page when the end of a list scrolls into view, and keeps doing
 * it until the reactor runs out of cursors. A drive with thousands of documents
 * therefore costs only the pages someone actually scrolls past.
 *
 * Returns a ref callback for a sentinel element placed after the last row. An
 * observer is used rather than a scroll listener so nothing runs per frame.
 */
export function useListEndAutoLoad(input: {
  readonly nextCursor: string | null;
  readonly status: PageStatus;
  readonly loadMore: (cursor: string) => void;
}): (node: HTMLElement | null) => void {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const { loadMore, nextCursor, status } = input;
  const enabled = canAutoLoadNextPage(nextCursor, status);

  useEffect(() => {
    if (sentinel === null || nextCursor === null || !enabled) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore(nextCursor);
        }
      },
      { rootMargin: LIST_END_PREFETCH_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, loadMore, nextCursor, sentinel]);

  return setSentinel;
}
