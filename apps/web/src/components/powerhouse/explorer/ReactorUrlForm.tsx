import type { PowerhouseGraphqlHeaders } from "@t3tools/contracts";
import { Eye, EyeOff, RotateCw } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";

import { normalizeReactorUrl } from "../PowerhousePanel.logic";
import {
  changeReactorAuthentication,
  reactorAuthenticationDraft,
  reactorAuthenticationHeaders,
  type ReactorAuthenticationDraft,
} from "./ReactorUrlForm.logic";

const AUTHENTICATION_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bearer", label: "Bearer token" },
  { value: "headers", label: "Custom headers" },
] satisfies ReadonlyArray<{ value: ReactorAuthenticationDraft["kind"]; label: string }>;

interface ReactorUrlFormProps {
  overrideUrl: string | null;
  headers?: PowerhouseGraphqlHeaders | undefined;
  detectedUrl?: string | undefined;
  authenticationRequired?: boolean | undefined;
  onSetOverride: (url: string | null, headers?: PowerhouseGraphqlHeaders) => void;
  onRetry: () => void;
  onApplied?: (() => void) | undefined;
  submitLabel?: string | undefined;
}

/** Shared connection controls for both the offline card and the live status popover. */
export function ReactorUrlForm({
  overrideUrl,
  headers,
  detectedUrl,
  authenticationRequired = false,
  onSetOverride,
  onRetry,
  onApplied,
  submitLabel = "Connect",
}: ReactorUrlFormProps) {
  const [draft, setDraft] = useState(overrideUrl ?? "");
  const [authentication, setAuthentication] = useState<ReactorAuthenticationDraft>(() =>
    headers === undefined && authenticationRequired
      ? { kind: "bearer", token: "" }
      : reactorAuthenticationDraft(headers),
  );
  const [showToken, setShowToken] = useState(false);
  const inputId = useId();
  const hintId = useId();
  const headersId = useId();
  const headersHintId = useId();
  const authenticationId = useId();

  const trimmed = draft.trim();
  const normalized = trimmed.length === 0 ? null : normalizeReactorUrl(trimmed);
  const isValid = trimmed.length === 0 || normalized !== null;
  const parsedHeaders = reactorAuthenticationHeaders(authentication);
  const targetUrl =
    normalized ?? (parsedHeaders && detectedUrl ? normalizeReactorUrl(detectedUrl) : null);
  const headersValid =
    parsedHeaders !== null && (parsedHeaders === undefined || targetUrl !== null);
  const missingToken = authentication.kind === "bearer" && authentication.token.trim().length === 0;
  const showAuthenticationError = !headersValid && !missingToken;

  const apply = () => {
    if (!isValid || !headersValid) return;
    if (
      targetUrl === overrideUrl &&
      JSON.stringify(parsedHeaders ?? {}) === JSON.stringify(headers ?? {})
    ) {
      onRetry();
    } else {
      onSetOverride(targetUrl, parsedHeaders);
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
            onChange={(event) => {
              setDraft(event.target.value);
              if (normalizeReactorUrl(event.target.value) !== overrideUrl) {
                setAuthentication(
                  changeReactorAuthentication({ kind: "none" }, authentication.kind),
                );
                setShowToken(false);
              }
            }}
            size="compact"
            font="mono"
            className="min-w-0"
          />
          <Button type="submit" size="sm" variant="outline" disabled={!isValid || !headersValid}>
            {submitLabel}
          </Button>
        </div>
        <p
          id={hintId}
          className={isValid ? "text-3xs text-muted-foreground" : "text-3xs text-destructive"}
          aria-live="polite"
        >
          {isValid
            ? overrideUrl === null
              ? "Leave empty to read the address from powerhouse.config.json."
              : "Clear the field to return to automatic detection."
            : "Enter an http or https URL, for example http://127.0.0.1:4001."}
        </p>
        <label className="mt-2 text-xs font-medium" htmlFor={authenticationId}>
          Authentication
        </label>
        <Select<ReactorAuthenticationDraft["kind"]>
          value={authentication.kind}
          items={AUTHENTICATION_OPTIONS}
          onValueChange={(kind) => {
            if (kind === null) return;
            setAuthentication(changeReactorAuthentication(authentication, kind));
            setShowToken(false);
          }}
        >
          <SelectTrigger id={authenticationId} size="compact">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {AUTHENTICATION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        {authentication.kind === "bearer" ? (
          <>
            <label className="mt-2 text-xs font-medium" htmlFor={headersId}>
              Bearer token
            </label>
            <div className="flex items-center gap-2">
              <Input
                id={headersId}
                name="reactorToken"
                type={showToken ? "text" : "password"}
                value={authentication.token}
                size="compact"
                font="mono"
                spellCheck={false}
                autoComplete="off"
                autoCapitalize="none"
                placeholder="Paste your token"
                aria-invalid={showAuthenticationError}
                aria-describedby={headersHintId}
                onChange={(event) =>
                  setAuthentication({ kind: "bearer", token: event.target.value })
                }
              />
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={showToken ? "Hide token" : "Show token"}
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
              </Button>
            </div>
          </>
        ) : authentication.kind === "headers" ? (
          <>
            <label className="mt-2 text-xs font-medium" htmlFor={headersId}>
              Request headers (JSON)
            </label>
            <Textarea
              id={headersId}
              name="reactorHeaders"
              size="sm"
              value={authentication.json}
              spellCheck={false}
              autoComplete="off"
              placeholder={'{"X-API-Key": "your-key"}'}
              aria-invalid={showAuthenticationError}
              aria-describedby={headersHintId}
              onChange={(event) => setAuthentication({ kind: "headers", json: event.target.value })}
            />
          </>
        ) : null}
        <p
          id={headersHintId}
          className={
            showAuthenticationError ? "text-3xs text-destructive" : "text-3xs text-muted-foreground"
          }
          aria-live="polite"
        >
          {parsedHeaders === null && !missingToken
            ? authentication.kind === "bearer"
              ? "Enter a valid bearer token."
              : "Enter a JSON object with valid header names and string values."
            : !headersValid && !missingToken
              ? "Enter the reactor URL before adding authentication."
              : authentication.kind === "bearer"
                ? "Paste the token only. Vetra adds the Bearer prefix. Kept for this session only."
                : authentication.kind === "headers"
                  ? "Use custom headers for API keys or other authentication. Kept for this session only."
                  : "Use for endpoints that do not require authentication."}
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
        {headers === undefined ? null : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              onSetOverride(overrideUrl);
              onApplied?.();
            }}
          >
            Clear authentication
          </Button>
        )}
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
