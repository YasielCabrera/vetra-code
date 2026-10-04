import { useNavigate } from "@tanstack/react-router";
import { ticketKey } from "@t3tools/client-runtime/state/tickets";
import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type TicketLinkTarget,
  type TicketStatusId,
} from "@t3tools/contracts";
import { FolderIcon, MessageSquareIcon, ServerIcon, TagIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { isElectron } from "../../env";
import { useTicketActions } from "../../hooks/useTicketActions";
import { attachmentReferenceIds } from "../../lib/attachmentReferences";
import { releaseAttachmentUpload } from "../../lib/attachmentUploadQueue";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { useTickets } from "../../state/tickets";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { type PendingTicketUpload, uploadTicketFiles } from "./ticketAttachments";
import { ticketDraftEnvironment, type NewTicketSearch } from "./ticketDraft.logic";
import { TicketLabelsEditor } from "./TicketPropertiesPanel";
import { TicketStatusIcon } from "./ticketPresentation";

const TicketBodyEditor = lazy(() => import("./TicketBodyEditor"));

const NO_PROJECT = "__none__";

export function NewTicketPage(props: { readonly prefill: NewTicketSearch }) {
  const navigate = useNavigate();
  const actions = useTicketActions();
  const board = useTickets();
  const { environments } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projects = useProjects();
  const threads = useThreadShells();
  const [chosenEnvironmentId, setChosenEnvironmentId] = useState<EnvironmentId | null>(
    props.prefill.env === undefined ? null : EnvironmentId.make(props.prefill.env),
  );
  const environmentId = ticketDraftEnvironment(
    chosenEnvironmentId,
    primaryEnvironmentId,
    board.environmentIds,
  );
  const environmentAvailable =
    environmentId !== null && board.environmentIds.includes(environmentId);

  const [title, setTitle] = useState(props.prefill.title ?? "");
  const [body, setBody] = useState(props.prefill.body ?? "");
  const [labels, setLabels] = useState<ReadonlyArray<string>>([]);
  const [chosenStatusId, setChosenStatusId] = useState<TicketStatusId | null>(null);
  const [projectId, setProjectId] = useState<string>(
    props.prefill.env === undefined ? NO_PROJECT : (props.prefill.project ?? NO_PROJECT),
  );
  const [threadId, setThreadId] = useState<string | null>(
    props.prefill.env === undefined ? null : (props.prefill.thread ?? null),
  );
  const [creating, setCreating] = useState(false);
  const [attaching, setAttaching] = useState(0);
  // Uploads belong to the environment they went to, so the form stays there once one starts.
  const [uploadStarted, setUploadStarted] = useState(false);
  const pendingUploadsRef = useRef(new Map<string, PendingTicketUpload>());
  const mountedRef = useRef(true);

  const statusSet = environmentId === null ? null : (board.statusSets.get(environmentId) ?? null);
  const statusId =
    chosenStatusId ??
    statusSet?.statuses.find((status) => status.category === "open" && status.isDefault)?.id ??
    null;
  const environmentProjects = useMemo(
    () => projects.filter((project) => project.environmentId === environmentId),
    [environmentId, projects],
  );
  const linkedThread = threads.find(
    (thread) => thread.environmentId === environmentId && thread.id === threadId,
  );

  useEffect(() => {
    mountedRef.current = true;
    const pendingUploads = pendingUploadsRef.current;
    return () => {
      mountedRef.current = false;
      for (const upload of pendingUploads.values()) releaseAttachmentUpload(upload.localId);
      pendingUploads.clear();
    };
  }, []);

  const onFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      if (environmentId === null || !environmentAvailable) return [];
      setChosenEnvironmentId(environmentId);
      setUploadStarted(true);
      setAttaching((count) => count + 1);
      try {
        return await uploadTicketFiles(environmentId, files, (upload) => {
          if (mountedRef.current) pendingUploadsRef.current.set(upload.attachment.id, upload);
          return mountedRef.current;
        });
      } finally {
        if (mountedRef.current) setAttaching((count) => count - 1);
      }
    },
    [environmentAvailable, environmentId],
  );

  const create = async () => {
    const trimmedTitle = title.trim();
    if (
      environmentId === null ||
      !environmentAvailable ||
      trimmedTitle.length === 0 ||
      creating ||
      attaching > 0
    )
      return;
    const uploads = attachmentReferenceIds(body).flatMap((id) => {
      const upload = pendingUploadsRef.current.get(id);
      return upload === undefined ? [] : [upload];
    });
    const links: TicketLinkTarget[] = [
      ...(projectId === NO_PROJECT
        ? []
        : [{ kind: "project" as const, projectId: ProjectId.make(projectId) }]),
      ...(threadId === null
        ? []
        : [{ kind: "thread" as const, threadId: ThreadId.make(threadId) }]),
    ];
    setCreating(true);
    const created = await actions.create(environmentId, {
      title: trimmedTitle,
      body,
      labels,
      ...(statusId === null ? {} : { statusId }),
      ...(links.length > 0 ? { links } : {}),
      ...(uploads.length > 0 ? { attachments: uploads.map((upload) => upload.attachment) } : {}),
    });
    setCreating(false);
    if (created === null) return;
    void navigate({
      to: "/tickets/$ticketKey",
      params: { ticketKey: ticketKey({ environmentId, ticketId: created.ticket.id }) },
      replace: true,
    });
  };

  const selectedStatus = statusSet?.statuses.find((status) => status.id === statusId);
  const environmentOptions = environments.filter((environment) =>
    board.environmentIds.includes(environment.environmentId),
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="New ticket breadcrumb">
            <WorkspaceBreadcrumbItem>
              <button
                type="button"
                className="hover:text-foreground"
                onClick={() => void navigate({ to: "/tickets", search: {} })}
              >
                Tickets
              </button>
            </WorkspaceBreadcrumbItem>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate">New ticket</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
        </WorkspacePageHeader>
        <ScrollArea className="min-h-0 flex-1">
          {environmentId === null ? (
            <p className="mx-auto w-full max-w-3xl px-6 py-10 text-sm text-muted-foreground">
              No connected environment keeps tickets. Update its Vetra Code server to create one.
            </p>
          ) : (
            <form
              className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 pt-10 pb-16"
              onSubmit={(event) => {
                event.preventDefault();
                void create();
              }}
            >
              <input
                value={title}
                autoFocus
                aria-label="Title"
                placeholder="Ticket title"
                maxLength={500}
                onChange={(event) => setTitle(event.target.value)}
                className="w-full bg-transparent text-3xl leading-tight font-semibold text-foreground outline-none placeholder:text-muted-foreground/60"
              />
              {chosenEnvironmentId !== null && board.loaded && !environmentAvailable ? (
                <p role="status" className="text-sm text-muted-foreground">
                  The selected environment is unavailable. Reconnect it or choose another
                  environment to create this ticket.
                </p>
              ) : null}
              <div
                className="flex min-w-0 flex-wrap items-center gap-2"
                aria-label="Ticket properties"
              >
                {statusId !== null ? (
                  <Select
                    items={
                      statusSet?.statuses.map((status) => ({
                        value: status.id,
                        label: status.name,
                      })) ?? []
                    }
                    value={statusId}
                    onValueChange={(value) => {
                      const status = statusSet?.statuses.find(
                        (candidate) => candidate.id === value,
                      );
                      if (status) setChosenStatusId(status.id);
                    }}
                  >
                    <SelectTrigger variant="ghost" size="compact" aria-label="Status">
                      <span className="flex min-w-0 max-w-48 flex-1 items-center gap-2">
                        {selectedStatus ? (
                          <TicketStatusIcon
                            color={selectedStatus.color}
                            category={selectedStatus.category}
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate">
                          <SelectValue />
                        </span>
                      </span>
                    </SelectTrigger>
                    <SelectPopup>
                      {statusSet?.statuses.map((status) => (
                        <SelectItem key={status.id} value={status.id}>
                          <span className="flex min-w-0 items-center gap-2">
                            <TicketStatusIcon color={status.color} category={status.category} />
                            <span className="min-w-0 flex-1 truncate">{status.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : null}
                <Popover>
                  <PopoverTrigger
                    render={<Button type="button" size="xs" variant="ghost" aria-label="Labels" />}
                  >
                    <TagIcon aria-hidden />
                    <span className="max-w-40 truncate">
                      {labels.length === 0
                        ? "Labels"
                        : labels.length === 1
                          ? labels[0]
                          : `${labels.length} labels`}
                    </span>
                  </PopoverTrigger>
                  <PopoverPopup width="sm" padding="compact" align="start">
                    <TicketLabelsEditor labels={labels} readOnly={false} onChange={setLabels} />
                  </PopoverPopup>
                </Popover>
                <Select
                  items={[
                    { value: NO_PROJECT, label: "Project" },
                    ...environmentProjects.map((project) => ({
                      value: project.id,
                      label: project.title,
                    })),
                  ]}
                  value={projectId}
                  onValueChange={(value) => {
                    if (typeof value === "string") setProjectId(value);
                  }}
                >
                  <SelectTrigger variant="ghost" size="compact" aria-label="Project">
                    <FolderIcon aria-hidden />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={NO_PROJECT}>No project</SelectItem>
                    {environmentProjects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                {environmentOptions.length > 1 || !environmentAvailable ? (
                  <Select
                    items={environmentOptions.map((environment) => ({
                      value: environment.environmentId,
                      label: environment.label,
                    }))}
                    value={environmentId}
                    onValueChange={(value) => {
                      const next = environmentOptions.find(
                        (environment) => environment.environmentId === value,
                      );
                      if (next === undefined) return;
                      setChosenEnvironmentId(next.environmentId);
                      setChosenStatusId(null);
                      setProjectId(NO_PROJECT);
                      setThreadId(null);
                    }}
                  >
                    <SelectTrigger
                      variant="ghost"
                      size="compact"
                      aria-label="Environment"
                      disabled={uploadStarted}
                    >
                      <ServerIcon aria-hidden />
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {environmentOptions.map((environment) => (
                        <SelectItem
                          key={environment.environmentId}
                          value={environment.environmentId}
                        >
                          {environment.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : null}
                {threadId !== null ? (
                  <Badge variant="secondary">
                    <MessageSquareIcon aria-hidden />
                    <span className="truncate">{linkedThread?.title ?? "Missing thread"}</span>
                    <button
                      type="button"
                      aria-label="Remove the thread link"
                      className="rounded-sm text-muted-foreground hover:text-foreground"
                      onClick={() => setThreadId(null)}
                    >
                      <XIcon aria-hidden className="size-3" />
                    </button>
                  </Badge>
                ) : null}
              </div>
              <div className="mt-3">
                <Suspense
                  fallback={
                    <pre className="min-h-64 py-3 font-mono text-sm whitespace-pre-wrap">
                      {body}
                    </pre>
                  }
                >
                  <TicketBodyEditor
                    value={body}
                    onChange={setBody}
                    onFiles={onFiles}
                    placeholder="Describe the work…"
                    ariaLabel="Description"
                    minHeight="16rem"
                  />
                </Suspense>
              </div>

              <div className="mt-4 flex justify-end gap-2 border-t border-border/60 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void navigate({ to: "/tickets", search: {} })}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !environmentAvailable || title.trim().length === 0 || creating || attaching > 0
                  }
                >
                  Create ticket
                </Button>
              </div>
            </form>
          )}
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}
