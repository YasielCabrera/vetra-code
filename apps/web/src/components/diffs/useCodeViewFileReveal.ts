import type { CodeViewScrollTarget } from "@pierre/diffs";
import { useEffect, useRef, useState } from "react";

interface FileRevealHandle {
  getInstance(): object | undefined;
  scrollTo(target: CodeViewScrollTarget): void;
}

export function useCodeViewFileReveal<TScope>(
  viewer: FileRevealHandle | null,
  scope: TScope,
  readyFiles: ReadonlyArray<{ filePath: string; fileKey: string }>,
) {
  const [request, setRequest] = useState<{ filePath: string; scope: TScope } | null>(null);
  const handledRequest = useRef<typeof request>(null);

  useEffect(() => {
    if (request === null || handledRequest.current === request) return;
    if (request.scope !== scope) {
      handledRequest.current = request;
      return;
    }
    const file = readyFiles.find((candidate) => candidate.filePath === request.filePath);
    if (!file || !viewer?.getInstance()) return;

    viewer.scrollTo({ type: "item", id: file.fileKey, align: "start" });
    handledRequest.current = request;
  }, [request, scope, viewer, readyFiles]);

  return (filePath: string) => setRequest({ filePath, scope });
}
