import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, TicketSummary } from "@t3tools/contracts";
import { type ReactNode, useMemo, useState } from "react";

import { type DraftThreadEnvMode, useComposerDraftStore } from "~/composerDraftStore";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { threadContextReference } from "~/lib/composerContextRecords";
import { formatInlineContextReference } from "~/lib/composerContextReferences";
import { useProjects } from "~/state/entities";
import { Button } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import type { TicketThreadPrefill } from "./ticketContextRecord";

/**
 * Where a ticket's thread can start, for the Start thread menu and the command palette alike. One
 * linked project offers itself and a new worktree in it. Otherwise every candidate is listed:
 * the linked projects, or with none linked, every project in the ticket's environment.
 */
export type TicketThreadStartChoices =
  | { readonly kind: "none" }
  | { readonly kind: "single"; readonly project: EnvironmentProject }
  | {
      readonly kind: "list";
      readonly label: string;
      readonly projects: ReadonlyArray<EnvironmentProject>;
    };

/**
 * Opens a draft thread for a ticket's work, filled with chips and text and focused for the
 * user's own prompt; nothing is sent. Without a ticket there is nowhere to start.
 */
export function useTicketThreadStarter(
  environmentId: EnvironmentId | null,
  ticket: Pick<TicketSummary, "linkRefs"> | null,
) {
  const newThread = useNewThreadHandler();
  const allProjects = useProjects();
  const [pending, setPending] = useState(false);
  const linkRefs = ticket?.linkRefs;
  const choices = useMemo((): TicketThreadStartChoices => {
    if (linkRefs === undefined) return { kind: "none" };
    const inEnvironment = allProjects.filter((project) => project.environmentId === environmentId);
    const linkedIds = new Set(
      linkRefs.flatMap((ref) => (ref.kind === "project" ? [ref.targetKey] : [])),
    );
    const linked = inEnvironment.filter((project) => linkedIds.has(project.id));
    if (linked.length === 1) return { kind: "single", project: linked[0]! };
    if (linked.length > 1) return { kind: "list", label: "Start thread in", projects: linked };
    return inEnvironment.length === 0
      ? { kind: "none" }
      : { kind: "list", label: "No linked project. Start thread in", projects: inEnvironment };
  }, [allProjects, environmentId, linkRefs]);

  /** `prefill` runs once the draft exists, so it can read unsaved edits. */
  const start = async (
    project: EnvironmentProject,
    envMode: DraftThreadEnvMode,
    prefill: () => TicketThreadPrefill,
  ) => {
    if (pending) return;
    setPending(true);
    try {
      const opened = await newThread(scopeProjectRef(project.environmentId, project.id), {
        envMode,
      });
      if (opened === null) {
        toastManager.add({ type: "error", title: "Could not open a thread" });
        return;
      }
      const { records, instruction } = prefill();
      const chips = records
        .map((record) => formatInlineContextReference(threadContextReference(record)))
        .join(" ");
      const store = useComposerDraftStore.getState();
      store.setPrompt(opened.draftId, `${chips} ${instruction ?? ""}`);
      store.setThreadContexts(opened.draftId, records);
    } catch {
      toastManager.add({ type: "error", title: "Could not open a thread" });
    } finally {
      setPending(false);
    }
  };

  return { choices, pending, start };
}

/** A button whose menu picks the project and checkout for `useTicketThreadStarter`. */
export function TicketStartThreadMenu(props: {
  readonly environmentId: EnvironmentId;
  readonly ticket: Pick<TicketSummary, "linkRefs">;
  readonly prefill: () => TicketThreadPrefill;
  readonly label: string;
  readonly icon: ReactNode;
  readonly variant: "outline" | "ghost";
  /** Shows only the icon, as row actions do; the label still names the button. */
  readonly iconOnly?: boolean;
}) {
  const { choices, pending, start } = useTicketThreadStarter(props.environmentId, props.ticket);
  const projectItems = (projects: ReadonlyArray<EnvironmentProject>, envMode: DraftThreadEnvMode) =>
    projects.map((project) => (
      <MenuItem key={project.id} onClick={() => void start(project, envMode, props.prefill)}>
        {project.title}
      </MenuItem>
    ));

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size={props.iconOnly ? "icon-xs" : "xs"}
            variant={props.variant}
            aria-label={props.iconOnly ? props.label : undefined}
            disabled={pending || choices.kind === "none"}
          />
        }
      >
        {props.icon}
        {props.iconOnly ? null : pending ? "Opening…" : props.label}
      </MenuTrigger>
      <MenuPopup align="end" className="w-56">
        {choices.kind === "single" ? (
          <>
            <MenuItem onClick={() => void start(choices.project, "local", props.prefill)}>
              Start in {choices.project.title}
            </MenuItem>
            <MenuItem onClick={() => void start(choices.project, "worktree", props.prefill)}>
              Start in new worktree
            </MenuItem>
          </>
        ) : choices.kind === "list" ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>{choices.label}</MenuGroupLabel>
              {projectItems(choices.projects, "local")}
            </MenuGroup>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>Start in new worktree</MenuSubTrigger>
              <MenuSubPopup>{projectItems(choices.projects, "worktree")}</MenuSubPopup>
            </MenuSub>
          </>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
