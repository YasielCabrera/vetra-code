import type { MessageId } from "@t3tools/contracts";

import { messageSpeechKey, type ReadAloud } from "../../readAloud";
import { markdownSpeechText, renderedSpeechText } from "../../readAloudText";
import { ReadAloudButton } from "../ReadAloudButton";

function replySpeechText(messageId: MessageId, markdown: string) {
  const rendered = document.querySelector(
    `[data-timeline-row-kind="message"][data-message-id="${CSS.escape(messageId)}"] .chat-markdown`,
  );
  return rendered ? renderedSpeechText(rendered) : markdownSpeechText(markdown);
}

export function MessageReadAloudButton({
  readAloud,
  routeThreadKey,
  messageId,
  text,
}: {
  readAloud: ReadAloud;
  routeThreadKey: string;
  messageId: MessageId;
  text: string;
}) {
  return (
    <ReadAloudButton
      readAloud={readAloud}
      speechKey={messageSpeechKey(routeThreadKey, messageId)}
      readText={() => replySpeechText(messageId, text)}
    />
  );
}
