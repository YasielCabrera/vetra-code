import { useNavigate } from "@tanstack/react-router";
import {
  resolveTicketBoardAvailability,
  ticketCapability,
  ticketKey,
} from "@t3tools/client-runtime/state/tickets";
import {
  EnvironmentId,
  ProjectId,
  type TicketLinkTarget,
  type TicketStatusId,
} from "@t3tools/contracts";
import { FolderIcon, MessageSquareIcon, ServerIcon, TagIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { isElectron } from "../../env";
import { isHostedStaticApp } from "../../hostedPairing";
import { useTicketActions } from "../../hooks/useTicketActions";
import { attachmentReferenceIds } from "../../lib/attachmentReferences";
import { ticketDrafts, type ManualTicketDraft } from "../../ticketDraftStore";
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
import { ticketDraftEnvironment, type NewTicketSearch } from "./ticketDraft.logic";
import { TicketLabelsEditor } from "./TicketPropertiesPanel";
import { TicketStatusIcon } from "./ticketPresentation";

const TicketBodyEditor = lazy(() => import("./TicketBodyEditor"));

const NO_PROJECT = "__none__";

export function NewTicketPage(props: { readonly prefill: NewTicketSearch }) {
  const navigate = useNavigate();
  const actions = useTicketActions();
  const board = useTickets();
  const { environments, isReady: environmentsReady } = useEnvironments();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const catalogReady = environmentsReady && (primaryEnvironmentId !== null || isHostedStaticApp());
  const availability = useMemo(
    () =>
      resolveTicketBoardAvailability({
        catalogReady,
        environments: environments.map((environment) => ({
          enabled: environment.entry.enabled,
          connectionPhase: environment.connection.phase,
          capability: ticketCapability(environment.serverConfig?.environment.capabilities),
        })),
      }),
    [catalogReady, environments],
  );
  const projects = useProjects();
  const threads = useThreadShells();
  const fallbackEnvironmentId = ticketDraftEnvironment(
    props.prefill.env === undefined ? null : EnvironmentId.make(props.prefill.env),
    primaryEnvironmentId,
    board.environmentIds,
  );
  const [chosenDraftKey, setDraftKey] = useState(() =>
    ticketDrafts.openManual(props.prefill, fallbackEnvironmentId),
  );
  const draftKey = chosenDraftKey ?? ticketDrafts.openManual(props.prefill, fallbackEnvironmentId);
  const entry = useStore(ticketDrafts.store, (state) =>
    draftKey === null ? undefined : state.drafts[draftKey],
  );
  const draft = entry?.value.kind === "manual" ? entry.value : null;
  const environmentId = draft?.environmentId ?? fallbackEnvironmentId;
  const chosenEnvironmentId =
    draft?.environmentId ?? (props.prefill.env === undefined ? null : environmentId);
  const environmentAvailable =
    environmentId !== null && board.environmentIds.includes(environmentId);
  const title = draft?.title ?? "";
  const body = draft?.body ?? "";
  const labels = draft?.labels ?? [];
  const chosenStatusId = draft?.statusId ?? null;
  const projectId = draft?.projectId ?? NO_PROJECT;
  const threadId = draft?.threadId ?? null;
  const runtime = useStore(ticketDrafts.store, (state) =>
    entry ? state.runtime[entry.id] : undefined,
  );
  const creating = runtime?.submitting ?? false;
  const attaching = runtime?.uploading ?? 0;
  const uploadStarted = attaching > 0 || (draft?.uploads.length ?? 0) > 0;
  const attachmentProblems =
    draft?.uploads.filter(
      (pending) =>
        attachmentReferenceIds(body).includes(pending.attachment.id) &&
        runtime?.verification[pending.attachment.id] !== "verified",
    ) ?? [];
  const edit = (patch: Partial<ManualTicketDraft>) => {
    const key =
      entry || environmentId === null ? draftKey : ticketDrafts.openManual({}, environmentId);
    const current = key === null ? undefined : ticketDrafts.store.getState().drafts[key];
    if (key !== null && current?.value.kind === "manual") {
      if (key !== chosenDraftKey) setDraftKey(key);
      ticketDrafts.edit(key, { ...current.value, ...patch });
    }
  };
  const setTitle = (value: string) => edit({ title: value });
  const setBody = (value: string) => edit({ body: value });
  const setLabels = (update: (labels: ReadonlyArray<string>) => ReadonlyArray<string>) => {
    const current = draftKey === null ? undefined : ticketDrafts.store.getState().drafts[draftKey];
    if (current?.value.kind === "manual") edit({ labels: update(current.value.labels) });
  };
  const setChosenStatusId = (value: TicketStatusId) => edit({ statusId: value });
  const setProjectId = (value: string) =>
    edit({ projectId: value === NO_PROJECT ? null : ProjectId.make(value) });
  const setThreadId = (value: null) => edit({ threadId: value });
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
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    if (draftKey !== null && environmentAvailable) void ticketDrafts.verify(draftKey);
  }, [draftKey, environmentAvailable]);

  const onFiles = useCallback(
    async (files: ReadonlyArray<File>) => {
      if (environmentId === null || !environmentAvailable) return [];
      const current =
        draftKey === null ? undefined : ticketDrafts.store.getState().drafts[draftKey];
      const key = current ? draftKey : ticketDrafts.openManual({}, environmentId);
      if (key === null) return [];
      setDraftKey(key);
      return ticketDrafts.attach(key, files);
    },
    [environmentAvailable, environmentId, draftKey],
  );

  const create = async () => {
    const trimmedTitle = title.trim();
    if (
      environmentId === null ||
      !environmentAvailable ||
      trimmedTitle.length === 0 ||
      creating ||
      attaching > 0 ||
      draftKey === null
    )
      return;
    const submitted = ticketDrafts.beginSubmission(draftKey);
    if (submitted?.value.kind !== "manual") return;
    setDraftKey(draftKey);
    if (!(await ticketDrafts.verify(draftKey))) {
      ticketDrafts.finishSubmission(draftKey, submitted, false);
      return;
    }
    const value = submitted.value;
    const submittedStatusId =
      value.statusId ??
      board.statusSets
        .get(value.environmentId)
        ?.statuses.find((status) => status.category === "open" && status.isDefault)?.id ??
      null;
    const uploads = value.uploads.filter((upload) =>
      attachmentReferenceIds(value.body).includes(upload.attachment.id),
    );
    const links: TicketLinkTarget[] = [
      ...(value.projectId === null
        ? []
        : [{ kind: "project" as const, projectId: value.projectId }]),
      ...(value.threadId === null ? [] : [{ kind: "thread" as const, threadId: value.threadId }]),
    ];
    let created;
    try {
      created = await actions.create(value.environmentId, {
        title: value.title.trim(),
        body: value.body,
        labels: value.labels,
        ...(submittedStatusId === null ? {} : { statusId: submittedStatusId }),
        ...(links.length > 0 ? { links } : {}),
        ...(uploads.length > 0 ? { attachments: uploads.map((upload) => upload.attachment) } : {}),
      });
    } finally {
      ticketDrafts.finishSubmission(draftKey, submitted, created != null);
    }
    if (created === null || !mountedRef.current) return;
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
              {availability === "unsupported"
                ? "Tickets need a newer server. Update an environment's Vetra Code server to create a ticket."
                : availability === "pending"
                  ? "Waiting for ticket environments."
                  : "Ticket environments are not connected. Connect an environment to create a ticket."}
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
                readOnly={creating}
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
                    <SelectTrigger
                      variant="ghost"
                      size="compact"
                      aria-label="Status"
                      disabled={creating}
                    >
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
                    render={
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        aria-label="Labels"
                        disabled={creating}
                      />
                    }
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
                    <TicketLabelsEditor labels={labels} readOnly={creating} onChange={setLabels} />
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
                  <SelectTrigger
                    variant="ghost"
                    size="compact"
                    aria-label="Project"
                    disabled={creating}
                  >
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
                      setDraftKey(
                        ticketDrafts.openManual({ env: next.environmentId }, next.environmentId),
                      );
                    }}
                  >
                    <SelectTrigger
                      variant="ghost"
                      size="compact"
                      aria-label="Environment"
                      disabled={uploadStarted || creating}
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
                      disabled={creating}
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
                    onDetachedFiles={(snippets) => {
                      if (draftKey !== null && entry)
                        ticketDrafts.appendAttachments(draftKey, entry.id, snippets);
                    }}
                    disabled={creating}
                    placeholder="Describe the work…"
                    ariaLabel="Description"
                    minHeight="16rem"
                  />
                </Suspense>
              </div>

              {attachmentProblems.length > 0 ? (
                <div role="status" className="flex flex-col gap-2 text-sm text-muted-foreground">
                  {attachmentProblems.map((pending) => (
                    <div key={pending.attachment.id} className="flex items-center gap-2">
                      <span>
                        {pending.attachment.name}:{" "}
                        {runtime?.verification[pending.attachment.id] === "missing"
                          ? "This upload expired. Remove it and attach the file again."
                          : runtime?.verification[pending.attachment.id] === "failed"
                            ? "Could not check this upload. Reconnect or retry before creating the ticket."
                            : "Checking this upload. Reconnect or retry before creating the ticket."}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={creating}
                        onClick={() => {
                          if (draftKey !== null)
                            ticketDrafts.removeUpload(draftKey, pending.attachment.id);
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={creating}
                    onClick={() => {
                      if (draftKey !== null) void ticketDrafts.verify(draftKey);
                    }}
                  >
                    Retry uploads
                  </Button>
                </div>
              ) : null}

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
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={creating || attaching > 0}
                  onClick={() => {
                    if (draftKey !== null) ticketDrafts.discard(draftKey);
                  }}
                >
                  Discard draft
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    !environmentAvailable ||
                    title.trim().length === 0 ||
                    creating ||
                    attaching > 0 ||
                    attachmentProblems.length > 0
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
