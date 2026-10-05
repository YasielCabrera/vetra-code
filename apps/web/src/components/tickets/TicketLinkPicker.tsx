import type {
  EnvironmentId,
  ProjectId,
  TicketId,
  TicketLink,
  TicketLinkTarget,
} from "@t3tools/contracts";
import { ticketLinkTargetKey } from "@t3tools/contracts";
import { LinkIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { useProjects, useThreadShells } from "../../state/entities";
import { ticketEnvironment, useTicketIssueLinksSupported } from "../../state/tickets";
import { pullRequestEnvironment } from "../../state/pullRequests";
import { useEnvironmentQuery } from "../../state/query";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

type PickerKind = "thread" | "project" | "pull_request" | "issue";

const PICKER_KINDS: ReadonlyArray<{ readonly value: PickerKind; readonly label: string }> = [
  { value: "thread", label: "Threads" },
  { value: "project", label: "Projects" },
  { value: "pull_request", label: "PRs" },
  { value: "issue", label: "Issues" },
];

interface PickerItem {
  readonly key: string;
  readonly title: string;
  readonly detail: string;
  readonly target: TicketLinkTarget;
}

const MAX_ITEMS = 50;

function matches(item: Pick<PickerItem, "title" | "detail">, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle.length === 0 ||
    item.title.toLowerCase().includes(needle) ||
    item.detail.toLowerCase().includes(needle)
  );
}

export function TicketLinkPicker(props: {
  readonly environmentId: EnvironmentId;
  readonly ticketId: TicketId;
  readonly links: ReadonlyArray<TicketLink>;
  readonly onLink: (target: TicketLinkTarget) => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [requestedKind, setKind] = useState<PickerKind>("thread");
  const [query, setQuery] = useState("");
  const issueLinksSupported = useTicketIssueLinksSupported(props.environmentId);
  const kind = requestedKind === "issue" && !issueLinksSupported ? "thread" : requestedKind;
  const pickerKinds = PICKER_KINDS.filter(
    (option) => option.value !== "issue" || issueLinksSupported,
  );
  const threads = useThreadShells();
  const projects = useProjects();
  const linkedKeys = useMemo(
    () =>
      new Set(props.links.map((link) => `${link.target.kind}:${ticketLinkTargetKey(link.target)}`)),
    [props.links],
  );
  const linkedProjectIds = useMemo(
    () =>
      props.links.flatMap((link): ReadonlyArray<ProjectId> =>
        link.target.kind === "project" ? [link.target.projectId] : [],
      ),
    [props.links],
  );
  const hostedListInput =
    linkedProjectIds.length === 0
      ? null
      : ({ state: "open", projectIds: linkedProjectIds, limit: 30 } as const);
  const pullRequests = useEnvironmentQuery(
    open && kind === "pull_request" && hostedListInput !== null
      ? pullRequestEnvironment.list({ environmentId: props.environmentId, input: hostedListInput })
      : null,
  );
  const issues = useEnvironmentQuery(
    open && kind === "issue" && hostedListInput !== null && issueLinksSupported
      ? ticketEnvironment.issueLinkCandidates({
          environmentId: props.environmentId,
          input: { ticketId: props.ticketId },
        })
      : null,
  );
  const projectTitleById = useMemo(
    () =>
      new Map(
        projects
          .filter((project) => project.environmentId === props.environmentId)
          .map((project) => [project.id, project.title]),
      ),
    [projects, props.environmentId],
  );

  const items = useMemo((): ReadonlyArray<PickerItem> => {
    const candidates: PickerItem[] = [];
    switch (kind) {
      case "thread":
        for (const thread of threads) {
          if (thread.environmentId !== props.environmentId) continue;
          candidates.push({
            key: thread.id,
            title: thread.title,
            detail: projectTitleById.get(thread.projectId) ?? "",
            target: { kind: "thread", threadId: thread.id },
          });
        }
        break;
      case "project":
        for (const [projectId, title] of projectTitleById) {
          candidates.push({
            key: projectId,
            title,
            detail: "",
            target: { kind: "project", projectId },
          });
        }
        break;
      case "pull_request":
        for (const entry of pullRequests.data?.entries ?? []) {
          const ref = { host: entry.host, repository: entry.repository, number: entry.number };
          candidates.push({
            key: `${entry.host}/${entry.repository}#${entry.number}`,
            title: entry.title,
            detail: `${entry.repository}#${entry.number}`,
            target: {
              kind: "pull_request",
              ref,
              snapshot: { title: entry.title, state: entry.state, url: entry.url },
            },
          });
        }
        break;
      case "issue":
        for (const entry of issues.data?.entries ?? []) {
          const ref = { host: entry.host, repository: entry.repository, number: entry.number };
          candidates.push({
            key: `${entry.host}/${entry.repository}#${entry.number}`,
            title: entry.title,
            detail: `${entry.repository}#${entry.number}`,
            target: {
              kind: "issue",
              ref,
              snapshot: { title: entry.title, state: entry.state, url: entry.url },
            },
          });
        }
        break;
    }
    return candidates
      .filter(
        (item) =>
          !linkedKeys.has(`${item.target.kind}:${ticketLinkTargetKey(item.target)}`) &&
          matches(item, query),
      )
      .slice(0, MAX_ITEMS);
  }, [
    issues.data,
    kind,
    linkedKeys,
    projectTitleById,
    props.environmentId,
    pullRequests.data,
    query,
    threads,
  ]);

  const hosted = kind === "pull_request" || kind === "issue";
  const hostedQuery = kind === "pull_request" ? pullRequests : issues;
  const emptyMessage =
    hosted && hostedListInput === null
      ? "Link a project first; its repository's open pull requests and issues show here."
      : hosted && hostedQuery.isPending
        ? "Loading…"
        : hosted && hostedQuery.error !== null
          ? `Could not read the repository. ${hostedQuery.error}`
          : kind === "issue" && (issues.data?.errors.length ?? 0) > 0
            ? issues.data?.errors.map((error) => error.message).join(" ")
            : query.trim().length > 0
              ? "Nothing matches that."
              : "Nothing left to link here.";

  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <MenuTrigger render={<Button size="xs" variant="ghost" />}>
        <LinkIcon aria-hidden />
        Link
      </MenuTrigger>
      <MenuPopup align="end" side="bottom" className="w-80">
        <div className="flex flex-col gap-2 border-b border-border/60 p-2">
          <ToggleGroup
            aria-label="Link to"
            variant="segmented"
            value={[kind]}
            onValueChange={(next) => {
              const selected = pickerKinds.find((option) => option.value === next[0]);
              if (selected) setKind(selected.value);
            }}
          >
            {pickerKinds.map((option) => (
              <Toggle key={option.value} value={option.value}>
                {option.label}
              </Toggle>
            ))}
          </ToggleGroup>
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search"
            aria-label="Search link targets"
            size="compact"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {kind === "issue" && items.length > 0
            ? issues.data?.errors.map((error) => (
                <p key={error.projectId} className="p-2 text-xs text-muted-foreground">
                  {error.projectTitle}: {error.message}
                </p>
              ))
            : null}
          {items.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">{emptyMessage}</p>
          ) : (
            items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  setOpen(false);
                  void props.onLink(item.target);
                }}
                className="flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60"
              >
                <span className="truncate text-foreground">{item.title}</span>
                {item.detail.length > 0 ? (
                  <span className="truncate text-muted-foreground">{item.detail}</span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </MenuPopup>
    </Menu>
  );
}
