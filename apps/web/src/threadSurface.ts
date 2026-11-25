import { ThreadId } from "@t3tools/contracts";

/** One tab per thread, so opening the same thread again focuses the tab it already has. */
export type ThreadSurface = { id: `thread:${string}`; kind: "thread"; threadId: ThreadId };

export const threadSurface = (threadId: ThreadId): ThreadSurface => ({
  id: `thread:${threadId}`,
  kind: "thread",
  threadId,
});

/**
 * A saved thread surface with its id rebuilt, or null when it names no thread. Builds before
 * subagents opened here saved it as `side-chat`.
 */
export function decodeThreadSurface(surface: object): ThreadSurface | null {
  const { kind, threadId } = surface as Record<string, unknown>;
  if ((kind !== "thread" && kind !== "side-chat") || typeof threadId !== "string") return null;
  return threadId === "" ? null : threadSurface(ThreadId.make(threadId));
}
