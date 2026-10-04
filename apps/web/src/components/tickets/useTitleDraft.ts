import { useEffect, useRef, useState } from "react";

/**
 * A ticket's or plan's title edited in place over `saved`, the title the stream last sent. A
 * commit saves a changed draft and drops it once the write lands. Until then the draft holds the
 * page against unload while it differs from the newest title, which a write's reply can set
 * ahead of the stream.
 */
export function useTitleDraft(
  saved: string,
  doc: {
    readonly readLatest: () => { readonly title: string };
    /** Queues a title write; resolves false when it did not land. */
    readonly saveTitle: (title: string) => Promise<boolean>;
  },
) {
  const { readLatest, saveTitle } = doc;
  const [draft, setDraft] = useState<string | null>(null);
  const writeRef = useRef<{ draft: string; saved: Promise<boolean> } | null>(null);

  useEffect(() => {
    const title = draft?.trim() ?? "";
    if (title.length === 0) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (title === readLatest().title) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draft, readLatest]);

  /** Saves the draft if it changed the title; resolves false while it has not saved. */
  const commit = (): Promise<boolean> => {
    if (draft === null) return writeRef.current?.saved ?? Promise.resolve(true);
    if (writeRef.current?.draft === draft) return writeRef.current.saved;
    const title = draft.trim();
    if (title.length === 0 || (title === readLatest().title && writeRef.current === null)) {
      setDraft(null);
      return Promise.resolve(true);
    }
    const submitted = draft;
    const write = saveTitle(title).then((landed) => {
      if (writeRef.current?.saved === write) writeRef.current = null;
      if (landed) setDraft((current) => (current === submitted ? null : current));
      return landed;
    });
    writeRef.current = { draft: submitted, saved: write };
    return write;
  };

  return {
    saved,
    value: draft ?? saved,
    change: setDraft,
    commit,
    /** Drops the draft; run it in `flushSync` before a blur, so the blur commits nothing. */
    cancel: () => setDraft(null),
  };
}
