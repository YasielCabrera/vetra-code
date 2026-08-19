import { RotateCw } from "lucide-react";
import { useEffect, useId, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";

import { normalizeReactorUrl } from "../PowerhousePanel.logic";

interface ReactorUrlFormProps {
  overrideUrl: string | null;
  onSetOverride: (url: string | null) => void;
  onRetry: () => void;
  onApplied?: (() => void) | undefined;
  submitLabel?: string | undefined;
}

/** Shared connection controls for both the offline card and the live status popover. */
export function ReactorUrlForm({
  overrideUrl,
  onSetOverride,
  onRetry,
  onApplied,
  submitLabel = "Connect",
}: ReactorUrlFormProps) {
  const [draft, setDraft] = useState(overrideUrl ?? "");
  const inputId = useId();
  const hintId = useId();

  useEffect(() => {
    setDraft(overrideUrl ?? "");
  }, [overrideUrl]);

  const trimmed = draft.trim();
  const normalized = trimmed.length === 0 ? null : normalizeReactorUrl(trimmed);
  const isValid = trimmed.length === 0 || normalized !== null;

  const apply = () => {
    if (!isValid) return;
    if (normalized === overrideUrl) {
      onRetry();
    } else {
      onSetOverride(normalized);
    }
    onApplied?.();
  };

  return (
    <div className="flex flex-col gap-4">
      <form
        className="flex flex-col gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          apply();
        }}
      >
        <label className="text-xs font-medium" htmlFor={inputId}>
          Reactor URL
        </label>
        <div className="flex items-center gap-2">
          <Input
            id={inputId}
            name="reactorUrl"
            type="url"
            inputMode="url"
            value={draft}
            spellCheck={false}
            autoComplete="url"
            placeholder="http://127.0.0.1:4001"
            aria-invalid={!isValid}
            aria-describedby={hintId}
            onChange={(event) => setDraft(event.target.value)}
            className="h-8 min-w-0 font-mono text-xs"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!isValid}>
            {submitLabel}
          </Button>
        </div>
        <p
          id={hintId}
          className={
            isValid ? "text-[.65rem] text-muted-foreground" : "text-[.65rem] text-destructive"
          }
          aria-live="polite"
        >
          {isValid
            ? overrideUrl === null
              ? "Leave empty to read the address from powerhouse.config.json."
              : "Clear the field to return to automatic detection."
            : "Enter an http or https URL, for example http://127.0.0.1:4001."}
        </p>
      </form>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            onRetry();
            onApplied?.();
          }}
        >
          <RotateCw aria-hidden />
          Retry
        </Button>
        {overrideUrl === null ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onSetOverride(null);
              onApplied?.();
            }}
          >
            Use autodetection
          </Button>
        )}
      </div>
    </div>
  );
}
