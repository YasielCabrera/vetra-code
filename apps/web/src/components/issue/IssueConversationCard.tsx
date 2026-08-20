import type { IssueActor } from "@vetra-code/contracts";
import { ExternalLinkIcon } from "lucide-react";

import { formatRelativeTimeLabel } from "~/timestampFormat";

import ChatMarkdown from "../ChatMarkdown";
import { SourceControlActorAvatar } from "../SourceControlActorAvatar";
import { Button } from "../ui/button";

export function IssueConversationCard({
  actor,
  createdAt,
  body,
  action,
  url = null,
  onOpen,
}: {
  readonly actor: IssueActor | null;
  readonly createdAt: string;
  readonly body: string;
  readonly action: "opened" | "commented";
  readonly url?: string | null;
  readonly onOpen?: (url: string) => void;
}) {
  return (
    <article className="group rounded-lg border border-border/60 p-3 [contain-intrinsic-block-size:120px] [content-visibility:auto]">
      <header className="flex min-w-0 items-start gap-2 text-xs text-muted-foreground">
        <SourceControlActorAvatar actor={actor} />
        <span className="min-w-0 truncate font-medium text-foreground">
          {actor?.login ?? "Unknown author"}
        </span>
        <span className="shrink-0">
          {action} {formatRelativeTimeLabel(createdAt)}
        </span>
        {url !== null && onOpen !== undefined ? (
          <Button
            aria-label="Open comment on GitHub"
            className="-mt-1 ml-auto shrink-0 text-muted-foreground opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100"
            size="icon-xs"
            variant="ghost"
            onClick={() => onOpen(url)}
          >
            <ExternalLinkIcon aria-hidden className="size-3" />
          </Button>
        ) : null}
      </header>
      <div className="mt-2">
        {body.trim() ? (
          <ChatMarkdown className="max-w-none text-sm" cwd={undefined} text={body} />
        ) : (
          <p className="text-xs italic text-muted-foreground">No comment provided.</p>
        )}
      </div>
    </article>
  );
}
