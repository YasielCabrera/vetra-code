import { FolderOpenIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  type DraftId,
  type PendingProjectDraftState,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { readLocalApi } from "~/localApi";
import {
  DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY,
  resolvePendingProjectLocation,
} from "~/lib/pendingProject";
import type { EnvironmentId, ProjectId } from "@vetra-code/contracts";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";

interface ProjectLocationEnvironmentOption {
  environmentId: EnvironmentId;
  label: string;
}

interface ProjectLocationControlProps {
  draftId: DraftId;
  environmentId: EnvironmentId;
  environmentLabel: string;
  projectId: ProjectId;
  environmentOptions: ReadonlyArray<ProjectLocationEnvironmentOption>;
  canBrowse: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed: (pendingProject: PendingProjectDraftState) => Promise<boolean>;
  onEnvironmentChange: (environmentId: EnvironmentId) => void;
}

export function ProjectLocationControl(props: ProjectLocationControlProps) {
  const pendingProject = useComposerDraftStore(
    (store) => store.getDraftSession(props.draftId)?.pendingProject ?? null,
  );
  const prompt = useComposerDraftStore(
    (store) => store.getComposerDraft(props.draftId)?.prompt ?? "",
  );
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const updateEnvironmentSettings = useUpdateEnvironmentSettings(props.environmentId);
  const [parentDirectory, setParentDirectory] = useState(
    pendingProject?.parentDirectory || DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY,
  );
  const [folderName, setFolderName] = useState(pendingProject?.folderName ?? "");
  const [rememberLocation, setRememberLocation] = useState(true);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  useEffect(() => {
    if (!props.open || !pendingProject) {
      return;
    }
    setParentDirectory(pendingProject.parentDirectory || DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY);
    setFolderName(pendingProject.folderName);
  }, [pendingProject, props.open]);

  const location = useMemo(
    () =>
      resolvePendingProjectLocation({
        parentDirectory,
        customFolderName: folderName,
        prompt,
        projectId: props.projectId,
      }),
    [folderName, parentDirectory, prompt, props.projectId],
  );
  if (!pendingProject) {
    return null;
  }

  const confirmLocation = async () => {
    const nextPendingProject: PendingProjectDraftState = {
      ...pendingProject,
      parentDirectory: parentDirectory.trim() || DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY,
      folderName: folderName.trim(),
      locationConfirmed: true,
    };
    setDraftThreadContext(props.draftId, { pendingProject: nextPendingProject });
    if (rememberLocation) {
      updateEnvironmentSettings({ addProjectBaseDirectory: nextPendingProject.parentDirectory });
    }
    setIsCreatingProject(true);
    try {
      const created = await props.onConfirmed(nextPendingProject);
      if (created) {
        props.onOpenChange(false);
      }
    } finally {
      setIsCreatingProject(false);
    }
  };

  const chooseParentDirectory = async () => {
    const localApi = readLocalApi();
    if (!localApi || isPickingFolder) {
      return;
    }
    setIsPickingFolder(true);
    try {
      const selected = await localApi.dialogs.pickFolder({
        initialPath: parentDirectory.trim() || DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY,
      });
      if (selected) {
        setParentDirectory(selected);
      }
    } finally {
      setIsPickingFolder(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open && isCreatingProject) {
          return;
        }
        props.onOpenChange(open);
      }}
    >
      <DialogPopup className="h-[min(42rem,calc(100dvh-2rem))] max-w-xl overflow-hidden">
        <form
          className="flex h-full min-h-0 flex-col overflow-hidden"
          onSubmit={(event) => {
            event.preventDefault();
            void confirmLocation();
          }}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>Choose where to create this project</DialogTitle>
            <DialogDescription>
              Vetra will create a new folder. Existing projects and folders are left untouched.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            <DialogPanel className="space-y-5">
              <div className="space-y-2">
                <Label>Environment</Label>
                <Select
                  value={props.environmentId}
                  onValueChange={(value) => {
                    if (value && value !== props.environmentId) {
                      props.onEnvironmentChange(value as EnvironmentId);
                    }
                  }}
                >
                  <SelectTrigger className="font-normal">
                    <SelectValue>{props.environmentLabel}</SelectValue>
                  </SelectTrigger>
                  <SelectPopup alignItemWithTrigger={false} className="min-w-(--anchor-width)">
                    {props.environmentOptions.map((option) => (
                      <SelectItem key={option.environmentId} value={option.environmentId}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-project-parent-directory">Location</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="new-project-parent-directory"
                    nativeInput
                    value={parentDirectory}
                    onChange={(event) => setParentDirectory(event.currentTarget.value)}
                    placeholder={DEFAULT_NEW_PROJECTS_PARENT_DIRECTORY}
                  />
                  {props.canBrowse && typeof window !== "undefined" && window.desktopBridge ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isPickingFolder}
                      onClick={() => void chooseParentDirectory()}
                    >
                      <FolderOpenIcon className="size-4" />
                      Browse
                    </Button>
                  ) : null}
                </div>
                <p className="text-xs leading-5 text-muted-foreground">
                  This path belongs to {props.environmentLabel}. Remote paths are resolved on the
                  remote machine.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="new-project-folder-name">Folder name</Label>
                <Input
                  id="new-project-folder-name"
                  nativeInput
                  value={folderName}
                  onChange={(event) => setFolderName(event.currentTarget.value)}
                  placeholder={location.folderName}
                />
              </div>

              <div className="rounded-xl bg-primary/7 px-4 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-primary">
                  Final location
                </p>
                <p className="mt-1 break-all font-mono text-xs leading-5 text-foreground">
                  {location.workspaceRoot}
                </p>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={rememberLocation}
                  onCheckedChange={(checked) => setRememberLocation(checked === true)}
                />
                Use this location for future projects in {props.environmentLabel}
              </label>
            </DialogPanel>
          </div>
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="ghost"
              disabled={isCreatingProject}
              onClick={() => props.onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={isCreatingProject || parentDirectory.trim().length === 0}
            >
              {isCreatingProject ? "Creating project…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
