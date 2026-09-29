import type { MessageId } from "@t3tools/contracts";
import { SquareIcon, Volume2Icon } from "lucide-react";

import { type ReadAloud, useSpeechPhase } from "../../readAloud";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const UNSPEAKABLE = ".chat-markdown-codeblock, pre, hr, button";

/** Markdown reduced to its words: no fenced code, link targets, or emphasis and heading marks. */
function markdownSpeechText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>+|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*`~]+/g, "")
    .trim();
}

/**
 * The reply as a listener should hear it: its rendered text, one line per block or
 * list item, without code. Falls back to the markdown source when the reply is not
 * on screen.
 */
function replySpeechText(messageId: MessageId, markdown: string) {
  const rendered = document.querySelector(
    `[data-timeline-row-kind="message"][data-message-id="${CSS.escape(messageId)}"] .chat-markdown`,
  );
  if (!rendered) return markdownSpeechText(markdown);
  const clone = rendered.cloneNode(true) as HTMLElement;
  for (const node of clone.querySelectorAll(UNSPEAKABLE)) node.remove();
  for (const line of clone.querySelectorAll("li, p, h1, h2, h3, h4, h5, h6, tr, br")) {
    line.after("\n");
  }
  return clone.textContent?.trim() ?? "";
}

/** Reads a whole assistant reply aloud from the reply's action bar, beside Copy. */
export function MessageReadAloudButton({
  readAloud,
  messageId,
  text,
}: {
  readAloud: ReadAloud;
  messageId: MessageId;
  text: string;
}) {
  const key = `message:${messageId}`;
  const phase = useSpeechPhase(key);
  if (!readAloud.available) return null;
  const label = phase === null ? "Read aloud" : "Stop reading";

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            aria-label={label}
            onClick={() => readAloud.toggle(key, replySpeechText(messageId, text))}
          />
        }
      >
        {phase === "loading" ? (
          <Spinner />
        ) : phase === "playing" ? (
          <SquareIcon className="size-3" />
        ) : (
          <Volume2Icon className="size-3" />
        )}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}
