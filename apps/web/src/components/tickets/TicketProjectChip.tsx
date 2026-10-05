import type { ReactNode } from "react";

import { ProjectFavicon, type ProjectFaviconProject } from "../ProjectFavicon";

export function TicketProjectChip(props: {
  readonly project: ProjectFaviconProject | undefined;
  readonly onOpen?: () => void;
  readonly children?: ReactNode;
}) {
  const { project } = props;
  return (
    <span className="inline-flex h-5 min-w-0 max-w-full shrink items-center gap-1 rounded border border-primary/20 bg-primary/8 px-1.5 text-xs text-foreground">
      {project === undefined ? (
        <span className="truncate text-muted-foreground italic">Missing project</span>
      ) : (
        <>
          <ProjectFavicon project={project} className="size-3" />
          {props.onOpen === undefined ? (
            <span className="max-w-40 truncate">{project.title}</span>
          ) : (
            <button
              type="button"
              aria-label={`Tickets in ${project.title}`}
              className="min-w-0 max-w-40 truncate hover:underline"
              onClick={props.onOpen}
            >
              {project.title}
            </button>
          )}
        </>
      )}
      {props.children}
    </span>
  );
}
