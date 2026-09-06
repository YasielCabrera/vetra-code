import { fileContentRevision } from "@vetra-code/shared/fileRevision";

export function projectFileCacheKey(cwd: string, relativePath: string, contents: string): string {
  return `${cwd}:${relativePath}:${fileContentRevision(contents)}`;
}

interface EditorFileIdentity {
  readonly cacheKey?: string;
  readonly contents: string;
}

export function projectFileEditorCacheKey(
  environmentId: string,
  cwd: string,
  relativePath: string,
  contents: string,
  editorFile: EditorFileIdentity | undefined,
): string {
  if (editorFile?.contents === contents && editorFile.cacheKey) {
    return editorFile.cacheKey;
  }
  return `editor:${environmentId}:${projectFileCacheKey(cwd, relativePath, contents)}`;
}
