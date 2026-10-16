import type { ThreadContextRecord } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { MessagesSquareIcon } from "lucide-react";

import { useThreadShell } from "~/state/entities";
import { LinkedContextChip } from "./ContextChip";

export function ThreadContextChip(props: {
  record: Pick<ThreadContextRecord, "environmentId" | "threadId" | "title">;
  copyMarkdown?: string;
}) {
  const { environmentId, threadId } = props.record;
  const shell = useThreadShell({ environmentId, threadId });
  const title = shell?.title?.trim() || props.record.title;
  return (
    <LinkedContextChip
      kind="thread"
      link={<Link to="/$environmentId/$threadId" params={{ environmentId, threadId }} />}
      icon={<MessagesSquareIcon />}
      label={title}
      ariaLabel={`Thread, ${title}`}
      tooltip={shell ? "Open thread" : "Thread no longer available"}
      copyMarkdown={props.copyMarkdown}
    />
  );
}
