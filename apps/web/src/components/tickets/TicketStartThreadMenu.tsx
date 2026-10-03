import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, TicketDetail } from "@t3tools/contracts";
import { MessageSquarePlusIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";

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
import { ticketContextRecord } from "./ticketContextRecord";

export const TicketStartThreadMenu = memo(function TicketStartThreadMenu(props: {
  readonly environmentId: EnvironmentId;
  readonly detail: TicketDetail;
  /** The description as the editor holds it, saved or not. */
  readonly readBody: () => string;
}) {
  const newThread = useNewThreadHandler();
  const allProjects = useProjects();
  const [pending, setPending] = useState(false);
  const { candidates, linked } = useMemo(() => {
    const inEnvironment = allProjects.filter(
      (project) => project.environmentId === props.environmentId,
    );
    const linkedIds = new Set(
      props.detail.links.flatMap((link) =>
        link.target.kind === "project" ? [link.target.projectId] : [],
      ),
    );
    const linkedProjects = inEnvironment.filter((project) => linkedIds.has(project.id));
    return linkedProjects.length > 0
      ? { candidates: linkedProjects, linked: true }
      : { candidates: inEnvironment, linked: false };
  }, [allProjects, props.detail.links, props.environmentId]);

  const start = async (project: EnvironmentProject, envMode: DraftThreadEnvMode) => {
    if (pending) return;
    setPending(true);
    try {
      const opened = await newThread(scopeProjectRef(props.environmentId, project.id), {
        envMode,
      });
      if (opened === null) {
        toastManager.add({ type: "error", title: "Could not open a thread" });
        return;
      }
      const record = ticketContextRecord({
        environmentId: props.environmentId,
        ticket: props.detail.summary,
        body: props.readBody(),
      });
      const store = useComposerDraftStore.getState();
      store.setPrompt(
        opened.draftId,
        `${formatInlineContextReference(threadContextReference(record))} `,
      );
      store.setThreadContexts(opened.draftId, [record]);
    } catch {
      toastManager.add({ type: "error", title: "Could not open a thread" });
    } finally {
      setPending(false);
    }
  };

  const single = linked && candidates.length === 1 ? candidates[0]! : null;
  const projectItems = (envMode: DraftThreadEnvMode) =>
    candidates.map((project) => (
      <MenuItem key={project.id} onClick={() => void start(project, envMode)}>
        {project.title}
      </MenuItem>
    ));

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button size="xs" variant="outline" disabled={pending || candidates.length === 0} />
        }
      >
        <MessageSquarePlusIcon aria-hidden />
        {pending ? "Opening…" : "Start thread"}
      </MenuTrigger>
      <MenuPopup align="end" className="w-56">
        {single !== null ? (
          <>
            <MenuItem onClick={() => void start(single, "local")}>Start in {single.title}</MenuItem>
            <MenuItem onClick={() => void start(single, "worktree")}>
              Start in new worktree
            </MenuItem>
          </>
        ) : (
          <>
            <MenuGroup>
              <MenuGroupLabel>
                {linked ? "Start thread in" : "No linked project. Start thread in"}
              </MenuGroupLabel>
              {projectItems("local")}
            </MenuGroup>
            <MenuSeparator />
            <MenuSub>
              <MenuSubTrigger>Start in new worktree</MenuSubTrigger>
              <MenuSubPopup>{projectItems("worktree")}</MenuSubPopup>
            </MenuSub>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
});
