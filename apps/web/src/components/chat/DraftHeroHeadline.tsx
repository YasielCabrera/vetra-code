interface DraftHeroHeadlineProps {
  readonly activeProjectTitle: string | null;
  readonly pendingProject?: boolean;
}

export function DraftHeroHeadline({
  activeProjectTitle,
  pendingProject = false,
}: DraftHeroHeadlineProps) {
  if (pendingProject || activeProjectTitle === null) {
    return (
      <div className="mx-auto grid w-full max-w-3xl gap-2 px-5 text-center">
        <h1 className="text-balance font-heading font-semibold text-3xl text-foreground tracking-[-0.035em] sm:text-4xl">
          What <span className="text-primary">product</span> do you want to build?
        </h1>
        <p className="mx-auto max-w-2xl text-pretty text-sm leading-6 text-muted-foreground sm:text-[15px]">
          Describe your idea, then select an existing project or create a new one before starting
          the thread.
        </p>
      </div>
    );
  }

  return (
    <h1 className="mx-auto w-full max-w-5xl text-center font-normal text-2xl text-foreground tracking-tight sm:text-3xl">
      What should we build in <span className="font-medium">{activeProjectTitle}</span>?
    </h1>
  );
}
