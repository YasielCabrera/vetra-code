import { PauseIcon, PlayIcon, SquareIcon, Volume2Icon } from "lucide-react";
import type { ReactNode } from "react";

import {
  pauseSpeech,
  type ReadAloud,
  resumeSpeech,
  stopSpeech,
  useSpeechPhase,
} from "../readAloud";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

function ReadAloudAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="xs"
            variant="ghost-muted"
            aria-label={label}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>
        <p>{label}</p>
      </TooltipPopup>
    </Tooltip>
  );
}

export function ReadAloudButton({
  readAloud,
  speechKey,
  readText,
}: {
  readAloud: ReadAloud;
  speechKey: string;
  readText: () => string;
}) {
  const phase = useSpeechPhase(speechKey);
  if (!readAloud.available) return null;
  if (phase === null || phase === "loading") {
    return (
      <ReadAloudAction
        label={phase === null ? "Read aloud" : "Stop reading"}
        onClick={() =>
          phase === null ? readAloud.toggle(speechKey, readText()) : stopSpeech(speechKey)
        }
      >
        {phase === null ? <Volume2Icon className="size-3" /> : <Spinner />}
      </ReadAloudAction>
    );
  }
  return (
    <>
      {phase === "playing" ? (
        <ReadAloudAction label="Pause reading" onClick={pauseSpeech}>
          <PauseIcon className="size-3" />
        </ReadAloudAction>
      ) : (
        <ReadAloudAction label="Resume reading" onClick={resumeSpeech}>
          <PlayIcon className="size-3" />
        </ReadAloudAction>
      )}
      <ReadAloudAction label="Stop reading" onClick={() => stopSpeech(speechKey)}>
        <SquareIcon className="size-3" />
      </ReadAloudAction>
    </>
  );
}
