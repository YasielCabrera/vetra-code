export interface NavigationDraft<Value> {
  readonly key: string;
  readonly value: Value;
  readonly settled: Promise<Value>;
}

/** Hands a departing form to its next mount while the final save is still running. */
export function createNavigationDrafts<Value>() {
  const drafts = new Map<string, NavigationDraft<Value>>();
  const completions = new WeakMap<NavigationDraft<Value>, (value: Value) => void>();

  return {
    get: (key: string) => drafts.get(key),
    take: (draft: NavigationDraft<Value>) => {
      if (drafts.get(draft.key) !== draft) return false;
      drafts.delete(draft.key);
      return true;
    },
    stage: (key: string, value: Value): NavigationDraft<Value> => {
      let complete = (_value: Value) => {};
      const settled = new Promise<Value>((resolve) => {
        complete = resolve;
      });
      const draft = { key, value, settled };
      completions.set(draft, (next) => {
        draft.value = next;
        complete(next);
      });
      drafts.set(key, draft);
      return draft;
    },
    settle: (draft: NavigationDraft<Value>, value: Value, retain: boolean) => {
      completions.get(draft)?.(value);
      completions.delete(draft);
      if (drafts.get(draft.key) !== draft) return false;
      if (!retain) drafts.delete(draft.key);
      return true;
    },
  };
}
