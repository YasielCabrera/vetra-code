import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  DEFAULT_SERVER_SETTINGS,
  type EnvironmentId,
  resolveTextToSpeechVoice,
  TEXT_TO_SPEECH_MODELS,
  TEXT_TO_SPEECH_SPEEDS,
  TextToSpeechModelId,
  type TextToSpeechVoice,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import { DownloadIcon, SquareIcon, Trash2Icon, Volume2Icon } from "lucide-react";
import { useState } from "react";

import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { stopSpeech, useReadAloud, useSpeechPhase } from "../../readAloud";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";

const DEFAULTS = DEFAULT_SERVER_SETTINGS.textToSpeech;
const PREVIEW_KEY = "settings:read-aloud-preview";
const PREVIEW_TEXT =
  "Your agent finished the task. All focused tests pass, and the changes are ready to review.";
const isTextToSpeechModelId = Schema.is(TextToSpeechModelId);
const MODEL_IDS = Object.keys(TEXT_TO_SPEECH_MODELS).filter(isTextToSpeechModelId);
const speedLabel = (speed: number) => (speed === 1 ? "1× (normal)" : `${speed}×`);
const megabytes = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;
const voiceLabel = (voice: TextToSpeechVoice) =>
  `${voice.name} · ${voice.accent} ${voice.gender.toLowerCase()}`;

export function TextToSpeechSettingsPanel() {
  const { scope, environment } = useSettingsScope();
  const environmentId =
    scope.environmentIds.length === 1 ? (environment?.environmentId ?? null) : null;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Read aloud">
        {environmentId === null ? (
          <SettingsRow
            {...searchableSetting("read-aloud")}
            description="Choose one environment. Its server downloads the voice model and does the speaking."
          />
        ) : (
          <ReadAloudSettings environmentId={environmentId} />
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function ReadAloudSettings({ environmentId }: { environmentId: EnvironmentId }) {
  const settings = useEnvironmentSettings(environmentId, (all) => all.textToSpeech);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const model = TEXT_TO_SPEECH_MODELS[settings.model];
  const voice = resolveTextToSpeechVoice(settings.model, settings.voice);
  const models = useEnvironmentQuery(
    serverEnvironment.textToSpeechModels({ environmentId, input: {} }),
  );
  const state = models.data?.find((entry) => entry.model === settings.model) ?? null;
  const installed = state?.phase === "installed";
  const unsupported = state?.phase === "unsupported";
  const commandOptions = { reportFailure: false, reportDefect: false };
  const install = useAtomCommand(serverEnvironment.installTextToSpeechModel, commandOptions);
  const cancel = useAtomCommand(serverEnvironment.cancelTextToSpeechInstall, commandOptions);
  const remove = useAtomCommand(serverEnvironment.removeTextToSpeechModel, commandOptions);
  const [error, setError] = useState<string | null>(null);
  const readAloud = useReadAloud(environmentId);
  const previewing = useSpeechPhase(PREVIEW_KEY);

  const run = async <A, E>(request: () => Promise<AtomCommandResult<A, E>>) => {
    setError(null);
    const result = await request();
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(failure instanceof Error ? failure.message : "The request failed. Try again.");
    }
  };
  const target = { environmentId, input: { model: settings.model } };

  const status =
    state === null
      ? "Checking this environment."
      : unsupported
        ? "Not available on this environment: the speech runtime has no build for its platform."
        : state.phase === "downloading"
          ? `Downloading ${megabytes(state.downloadedBytes)} of ${megabytes(state.totalBytes)}.`
          : state.phase === "installed"
            ? `Installed on this environment (${megabytes(state.totalBytes)}).`
            : (state.message ??
              `${megabytes(state.totalBytes)} download, stored with this environment's settings.`);

  return (
    <>
      <SettingsRow
        serverScoped
        {...searchableSetting("read-aloud")}
        description={
          installed
            ? "Show a speaker button beside Copy on each assistant reply."
            : unsupported
              ? "This environment's platform cannot run the voice model."
              : "Download the model below to turn read aloud on."
        }
        control={
          <Switch
            checked={settings.enabled && installed}
            disabled={!installed}
            onCheckedChange={(enabled) => {
              if (!enabled) stopSpeech();
              updateSettings({ textToSpeech: { enabled } });
            }}
            aria-label="Read aloud"
          />
        }
      />
      <SettingsRow
        serverScoped
        {...searchableSetting("read-aloud-model")}
        description={model.description}
        control={
          <Select
            value={settings.model}
            onValueChange={(value) => {
              if (isTextToSpeechModelId(value)) updateSettings({ textToSpeech: { model: value } });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Voice model">
              <SelectValue>
                {(value: TextToSpeechModelId) => TEXT_TO_SPEECH_MODELS[value].label}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {MODEL_IDS.map((id) => (
                <SelectItem hideIndicator key={id} value={id}>
                  {TEXT_TO_SPEECH_MODELS[id].label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      >
        <div className="space-y-2 pb-1">
          <p
            className={
              error || state?.phase === "failed"
                ? "text-destructive text-xs"
                : "text-muted-foreground text-xs"
            }
          >
            {error ?? status}
          </p>
          {state?.phase === "downloading" ? (
            <progress
              className="block h-1 w-full accent-foreground"
              max={state.totalBytes}
              value={state.downloadedBytes}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            {unsupported ? null : state?.phase === "downloading" ? (
              <Button size="xs" variant="outline" onClick={() => void run(() => cancel(target))}>
                Cancel download
              </Button>
            ) : installed ? (
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  stopSpeech();
                  void run(() => remove(target));
                }}
              >
                <Trash2Icon />
                Remove model
              </Button>
            ) : (
              <Button
                size="xs"
                variant="outline"
                disabled={state === null}
                onClick={() => void run(() => install(target))}
              >
                <DownloadIcon />
                {state?.phase === "failed" ? "Retry download" : "Download model"}
              </Button>
            )}
          </div>
        </div>
      </SettingsRow>
      <SettingsRow
        serverScoped
        {...searchableSetting("read-aloud-voice")}
        resetAction={
          settings.voice !== DEFAULTS.voice ? (
            <SettingResetButton
              label="voice"
              onClick={() => updateSettings({ textToSpeech: { voice: DEFAULTS.voice } })}
            />
          ) : null
        }
        description={
          installed
            ? "Preview a voice before choosing it."
            : "Voices are available once the model is downloaded."
        }
        control={
          <div className="flex items-center gap-2">
            <Button
              size="icon-sm"
              variant="outline"
              disabled={!installed}
              aria-label={previewing ? "Stop preview" : "Preview voice"}
              onClick={() => readAloud.toggle(PREVIEW_KEY, PREVIEW_TEXT, voice.id)}
            >
              {previewing === "loading" ? (
                <Spinner />
              ) : previewing === "playing" ? (
                <SquareIcon />
              ) : (
                <Volume2Icon />
              )}
            </Button>
            <Select
              value={voice.id}
              onValueChange={(value) => {
                if (value) updateSettings({ textToSpeech: { voice: value } });
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Voice">
                <SelectValue>{() => voiceLabel(voice)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {model.voices.map((candidate) => (
                  <SelectItem hideIndicator key={candidate.id} value={candidate.id}>
                    {voiceLabel(candidate)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        }
      />
      <SettingsRow
        serverScoped
        {...searchableSetting("read-aloud-speed")}
        resetAction={
          settings.speed !== DEFAULTS.speed ? (
            <SettingResetButton
              label="reading speed"
              onClick={() => updateSettings({ textToSpeech: { speed: DEFAULTS.speed } })}
            />
          ) : null
        }
        description="How fast replies are read. 1× is the voice's natural pace."
        control={
          <Select
            value={settings.speed}
            onValueChange={(value) => {
              if (typeof value === "number") updateSettings({ textToSpeech: { speed: value } });
            }}
          >
            <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Reading speed">
              <SelectValue>{(value: number) => speedLabel(value)}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {TEXT_TO_SPEECH_SPEEDS.map((speed) => (
                <SelectItem hideIndicator key={speed} value={speed}>
                  {speedLabel(speed)}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}
