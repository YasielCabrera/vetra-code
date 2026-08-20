import { cn } from "~/lib/utils";

interface SourceControlActor {
  readonly login: string;
  readonly avatarUrl: string | null;
}

/** A host-provided face when available, with the same lightweight initial fallback everywhere. */
export function SourceControlActorAvatar({
  actor,
  className,
}: {
  readonly actor: SourceControlActor | null;
  readonly className?: string | undefined;
}) {
  const login = actor?.login ?? "ghost";
  const avatarUrl = actor?.avatarUrl ?? null;
  return avatarUrl === null ? (
    <span
      aria-hidden
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[8px] font-medium text-muted-foreground",
        className,
      )}
    >
      {login.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <img
      aria-hidden
      alt=""
      src={avatarUrl}
      loading="lazy"
      className={cn("size-4 shrink-0 rounded-full bg-muted object-cover", className)}
    />
  );
}
