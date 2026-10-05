import { useNavigate } from "@tanstack/react-router";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  type TicketDetail,
  type TicketLink,
  type TicketLinkKind,
  type TicketLinkTarget,
  type TicketStatusId,
  type TicketStatusSet,
  ticketLinkTargetKey,
} from "@t3tools/contracts";
import {
  CircleAlertIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  XIcon,
} from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";

import { useThreadShells } from "../../state/entities";
import { useTicketIssueLinksSupported } from "../../state/tickets";
import { buildThreadRouteParams } from "../../threadRoutes";
import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { addTicketLabel } from "./ticketDraft.logic";
import { openOnGitHub } from "./TicketGitHub";
import type { TicketLinkPreviewTarget } from "./TicketLinkPreview";
import { TicketLinkPicker } from "./TicketLinkPicker";
import { TicketPropertyRow, TicketStatusIcon } from "./ticketPresentation";
import { TicketProjectsEditor } from "./TicketProjectsEditor";
import { resolveTicketThreadStatus } from "./ticketThreadStatus.logic";

function PanelSection(props: {
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex h-6 items-center justify-between gap-2">
        <h2 className="text-xs font-semibold text-foreground">{props.title}</h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export function TicketStatusSelect(props: {
  readonly statusSet: TicketStatusSet | null;
  readonly value: TicketStatusId;
  readonly onChange: (statusId: TicketStatusId) => void;
}) {
  const statuses = props.statusSet?.statuses ?? [];
  const selected = statuses.find((status) => status.id === props.value);
  const items = statuses.map((status) => ({ value: status.id, label: status.name }));
  return (
    <Select
      items={items}
      value={props.value}
      onValueChange={(value) => {
        const status = statuses.find((candidate) => candidate.id === value);
        if (status) props.onChange(status.id);
      }}
    >
      <SelectTrigger variant="ghost" size="compact" aria-label="Status">
        <span className="flex min-w-0 max-w-48 flex-1 items-center gap-2">
          {selected ? (
            <TicketStatusIcon color={selected.color} category={selected.category} />
          ) : null}
          <span className="min-w-0 flex-1 truncate">
            <SelectValue />
          </span>
        </span>
      </SelectTrigger>
      <SelectPopup>
        {statuses.map((status) => (
          <SelectItem key={status.id} value={status.id}>
            <span className="flex min-w-0 items-center gap-2">
              <TicketStatusIcon color={status.color} category={status.category} />
              <span className="min-w-0 flex-1 truncate">{status.name}</span>
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

/** `onChange` gets an update to apply to the newest labels, which may be ahead of `labels`. */
export function TicketLabelsEditor(props: {
  readonly labels: ReadonlyArray<string>;
  readonly readOnly: boolean;
  readonly onChange: (update: (labels: ReadonlyArray<string>) => ReadonlyArray<string>) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-1 pt-1">
      {props.labels.map((label) => (
        <Badge key={label} variant="outline" className="min-w-0 max-w-full">
          <Tooltip>
            <TooltipTrigger render={<span className="min-w-0 truncate" />}>{label}</TooltipTrigger>
            <TooltipPopup side="top">{label}</TooltipPopup>
          </Tooltip>
          {props.readOnly ? null : (
            <button
              type="button"
              aria-label={`Remove label ${label}`}
              className="-me-0.5 shrink-0 rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() =>
                props.onChange((labels) => labels.filter((existing) => existing !== label))
              }
            >
              <XIcon aria-hidden className="size-3" />
            </button>
          )}
        </Badge>
      ))}
      {props.readOnly ? (
        props.labels.length === 0 ? (
          <span className="text-xs text-muted-foreground">None</span>
        ) : null
      ) : (
        <Input
          size="compact"
          value={draft}
          placeholder="Add label"
          aria-label="Add label"
          className="w-28 min-w-0 max-w-full"
          onChange={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const typed = draft;
            setDraft("");
            props.onChange((labels) => addTicketLabel(labels, typed));
          }}
        />
      )}
    </div>
  );
}

function LinkRow(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly detail: string | null;
  readonly threadStatus?: ReturnType<typeof resolveTicketThreadStatus>;
  readonly missing: boolean;
  readonly onPreview: (() => void) | null;
  readonly onOpen: (() => void) | null;
  readonly onUnlink: () => void;
}) {
  const label = (
    <>
      <span
        className={props.missing ? "block truncate text-muted-foreground italic" : "block truncate"}
      >
        {props.title}
      </span>
      {props.detail ? (
        <span className="block truncate text-xs text-muted-foreground">{props.detail}</span>
      ) : null}
      {props.threadStatus ? (
        <span className={`block truncate text-xs ${props.threadStatus.colorClass}`}>
          {props.threadStatus.label}
        </span>
      ) : null}
    </>
  );
  return (
    <li className="group/link flex min-w-0 items-center gap-2 rounded-md px-1.5 py-2 hover:bg-accent/40">
      {props.threadStatus ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <span
                aria-label={props.threadStatus.label}
                className={`inline-flex size-3.5 shrink-0 items-center justify-center ${props.threadStatus.colorClass}`}
              />
            }
          >
            {props.threadStatus.kind === "error" ? (
              <CircleAlertIcon aria-hidden className="size-3.5" />
            ) : (
              <span
                aria-hidden
                className={`size-[9px] rounded-full ${props.threadStatus.dotClass}`}
              />
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">{props.threadStatus.tooltip}</TooltipPopup>
        </Tooltip>
      ) : (
        <span className="shrink-0 text-muted-foreground">{props.icon}</span>
      )}
      {props.onPreview ? (
        <button
          type="button"
          aria-label={`Preview ${props.title}`}
          className="min-w-0 flex-1 text-left"
          onClick={props.onPreview}
        >
          {label}
        </button>
      ) : (
        <span className="min-w-0 flex-1">{label}</span>
      )}
      {props.onOpen ? (
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Open ${props.title}`}
          onClick={props.onOpen}
        >
          <ExternalLinkIcon aria-hidden />
        </Button>
      ) : null}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Unlink ${props.title}`}
        onClick={props.onUnlink}
      >
        <XIcon aria-hidden />
      </Button>
    </li>
  );
}

const LINK_KIND_ORDER: ReadonlyArray<Exclude<TicketLinkKind, "project">> = [
  "thread",
  "pull_request",
  "issue",
];

export const TicketPropertiesPanel = memo(function TicketPropertiesPanel(props: {
  readonly environmentId: EnvironmentId;
  readonly detail: TicketDetail;
  readonly statusSet: TicketStatusSet | null;
  readonly onStatusChange: (statusId: TicketStatusId) => void;
  readonly onLabelsChange: (
    update: (labels: ReadonlyArray<string>) => ReadonlyArray<string>,
  ) => void;
  readonly onLink: (target: TicketLinkTarget) => Promise<unknown>;
  readonly onUnlink: (kind: TicketLinkKind, targetKey: string) => void;
  readonly onPreview: (target: TicketLinkPreviewTarget) => void;
  readonly githubProperties?: ReactNode;
}) {
  const navigate = useNavigate();
  const threads = useThreadShells();
  const issueLinksSupported = useTicketIssueLinksSupported(props.environmentId);
  const { summary, links } = props.detail;
  const threadById = useMemo(
    () =>
      new Map(
        threads
          .filter((thread) => thread.environmentId === props.environmentId)
          .map((thread) => [thread.id, thread]),
      ),
    [props.environmentId, threads],
  );
  const otherLinks = LINK_KIND_ORDER.flatMap((kind) =>
    links.filter((link) => link.target.kind === kind),
  );

  const describeLink = (link: TicketLink) => {
    const { target } = link;
    switch (target.kind) {
      case "thread": {
        const thread = threadById.get(target.threadId);
        return {
          icon: <MessageSquareIcon aria-hidden className="size-3.5" />,
          title: thread?.title ?? "Missing thread",
          detail: null,
          threadStatus: thread === undefined ? null : resolveTicketThreadStatus(thread),
          missing: thread === undefined,
          onPreview: thread === undefined ? null : () => props.onPreview(target),
          onOpen:
            thread === undefined
              ? null
              : () =>
                  void navigate({
                    to: "/$environmentId/$threadId",
                    params: buildThreadRouteParams(
                      scopeThreadRef(props.environmentId, target.threadId),
                    ),
                  }),
        };
      }
      case "pull_request":
      case "issue": {
        const Icon = target.kind === "pull_request" ? PullRequestGlyph.pullRequest : CircleDotIcon;
        return {
          icon: <Icon aria-hidden className="size-3.5" />,
          title: target.snapshot.title,
          detail: `${target.ref.repository}#${target.ref.number} · ${target.snapshot.state}`,
          missing: false,
          onPreview:
            target.kind === "issue" && !issueLinksSupported ? null : () => props.onPreview(target),
          onOpen: () => openOnGitHub(target.snapshot.url),
        };
      }
      case "project":
        return null;
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PanelSection title="Properties">
        <TicketPropertyRow label="Status">
          <TicketStatusSelect
            statusSet={props.statusSet}
            value={summary.statusId}
            onChange={props.onStatusChange}
          />
        </TicketPropertyRow>
        <TicketPropertyRow label="Labels">
          <TicketLabelsEditor
            labels={summary.labels}
            readOnly={summary.kind === "github"}
            onChange={props.onLabelsChange}
          />
        </TicketPropertyRow>
        <TicketPropertyRow label="Projects">
          <TicketProjectsEditor environmentId={props.environmentId} detail={props.detail} />
        </TicketPropertyRow>
      </PanelSection>

      {props.githubProperties ? (
        <PanelSection title="GitHub">{props.githubProperties}</PanelSection>
      ) : null}

      <PanelSection
        title="Links"
        action={
          <TicketLinkPicker
            environmentId={props.environmentId}
            ticketId={summary.id}
            links={links}
            onLink={props.onLink}
          />
        }
      >
        {otherLinks.length === 0 ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Link a thread, pull request or issue to keep related work together.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0 text-sm">
            {otherLinks.map((link) => {
              const row = describeLink(link);
              if (row === null) return null;
              const targetKey = ticketLinkTargetKey(link.target);
              return (
                <LinkRow
                  key={`${link.target.kind}:${targetKey}`}
                  {...row}
                  onUnlink={() => props.onUnlink(link.target.kind, targetKey)}
                />
              );
            })}
          </ul>
        )}
      </PanelSection>
    </div>
  );
});
