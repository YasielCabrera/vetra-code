import type { EnvironmentId } from "@t3tools/contracts";
import { type RefObject, useEffect } from "react";

import { stopSpeech, useReadAloud } from "../../readAloud";
import { markdownSpeechText, renderedSpeechText } from "../../readAloudText";
import { ReadAloudButton } from "../ReadAloudButton";

export function DocumentReadAloudButton(props: {
  environmentId: EnvironmentId;
  speechKey: string;
  bodyRef: RefObject<HTMLDivElement | null>;
  readRenderedBody: () => string | null;
  readBody: () => string;
}) {
  const { environmentId, speechKey, bodyRef, readRenderedBody, readBody } = props;
  const readAloud = useReadAloud(environmentId);
  useEffect(() => {
    if (!readAloud.available) stopSpeech(speechKey);
  }, [speechKey, readAloud.available]);
  return (
    <ReadAloudButton
      readAloud={readAloud}
      speechKey={speechKey}
      readText={() => {
        const body = readBody();
        const rendered = bodyRef.current;
        return rendered !== null && body === readRenderedBody()
          ? renderedSpeechText(rendered)
          : markdownSpeechText(body);
      }}
    />
  );
}
