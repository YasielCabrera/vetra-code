import type { PowerhouseReactorError } from "@vetra-code/contracts";
import { RadioTower } from "lucide-react";

import { describeReactorFailure } from "../PowerhousePanel.logic";
import { ReactorUrlForm } from "./ReactorUrlForm";

interface ReactorConnectionCardProps {
  error: PowerhouseReactorError | null;
  otherError: string | null;
  overrideUrl: string | null;
  onSetOverride: (url: string | null) => void;
  onRetry: () => void;
}

/**
 * What the Explorer shows when there is no reactor to show.
 *
 * Says which addresses were tried and offers the two ways forward — start one,
 * or point at one — rather than spinning.
 */
export function ReactorConnectionCard({
  error,
  otherError,
  overrideUrl,
  onSetOverride,
  onRetry,
}: ReactorConnectionCardProps) {
  const copy =
    error === null
      ? {
          title: "The reactor could not be reached",
          detail: otherError ?? "The request failed before it reached a reactor.",
        }
      : describeReactorFailure(error);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-lg items-center px-4 py-8">
        <div className="w-full rounded-2xl border border-border/70 bg-card/70 p-4 shadow-xs/5 @[32rem]:p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-muted/50 text-muted-foreground">
              <RadioTower aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{copy.title}</h2>
              <p className="mt-1 text-xs leading-relaxed break-words text-muted-foreground">
                {copy.detail}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <ReactorUrlForm
              overrideUrl={overrideUrl}
              onSetOverride={onSetOverride}
              onRetry={onRetry}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
