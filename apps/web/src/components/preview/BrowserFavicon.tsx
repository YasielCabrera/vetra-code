import { Globe2 } from "lucide-react";
import { useState } from "react";

import { faviconUrlForOrigin } from "~/lib/favicon";
import { cn } from "~/lib/utils";

import { BrowserMockup } from "./BrowserMockup";

type BrowserFaviconVariant = "card" | "tab";

type ImageState = {
  readonly url: string | null;
  readonly status: "loaded" | "failed";
};

const INITIAL_IMAGE_STATE = { url: null, status: "failed" } as const satisfies ImageState;

export function BrowserFavicon({
  url,
  variant,
}: {
  readonly url: string | null | undefined;
  readonly variant: BrowserFaviconVariant;
}) {
  const faviconUrl = faviconUrlForOrigin(url);
  const [imageState, setImageState] = useState<ImageState>(INITIAL_IMAGE_STATE);
  const status = imageState.url === faviconUrl ? imageState.status : "loading";
  const loaded = faviconUrl !== null && status === "loaded";

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        variant === "card" ? "size-7" : "size-3",
      )}
    >
      {loaded ? null : variant === "card" ? (
        <BrowserMockup className="size-full" />
      ) : (
        <Globe2 className="size-full" />
      )}
      {faviconUrl !== null && status !== "failed" ? (
        <img
          src={faviconUrl}
          alt=""
          aria-hidden
          draggable={false}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          className={cn(
            "absolute inset-0 size-full rounded-sm object-contain",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={() => setImageState({ url: faviconUrl, status: "loaded" })}
          onError={() => setImageState({ url: faviconUrl, status: "failed" })}
        />
      ) : null}
    </span>
  );
}
