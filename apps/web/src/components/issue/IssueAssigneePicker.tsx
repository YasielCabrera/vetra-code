/** Assigning an issue from the same compact people picker used for pull-request reviewers. */
import type {
  EnvironmentId,
  IssueAssigneeCandidate,
  IssueRef,
  TicketGitHubIssueRef,
} from "@t3tools/contracts";
import { CheckIcon, UserPlusIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";

import { ticketEnvironment } from "~/state/tickets";
import { issueEnvironment } from "~/state/issues";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";

import { SourceControlActorAvatar } from "../SourceControlActorAvatar";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";

const EMPTY_ASSIGNEE_CANDIDATES: ReadonlyArray<IssueAssigneeCandidate> = [];

function matches(candidate: IssueAssigneeCandidate, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return (
    needle.length === 0 ||
    candidate.login.toLowerCase().includes(needle) ||
    (candidate.name ?? "").toLowerCase().includes(needle)
  );
}

function readableFailure(failure: unknown): string {
  const fallback =
    "GitHub refused the assignment. Check that you have permission and the person still has repository access.";
  const raw =
    failure instanceof Error ? failure.message : typeof failure === "string" ? failure : "";
  const detail = raw.replace(/^Issue operation \w+ failed:\s*/iu, "").trim();
  if (!detail || /^(command failed|exited? with (code|status) \d+)\.?$/iu.test(detail)) {
    return fallback;
  }
  return detail.length <= 320 ? detail : `${detail.slice(0, 319)}…`;
}

export function IssueAssigneePicker({
  environmentId,
  reference,
  onAssigned,
}: {
  readonly environmentId: EnvironmentId;
  readonly reference: IssueRef | TicketGitHubIssueRef;
  readonly onAssigned: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const candidatesQuery = useEnvironmentQuery(
    !open
      ? null
      : "ticketId" in reference
        ? ticketEnvironment.githubIssueAssigneeCandidates({ environmentId, input: reference })
        : issueEnvironment.assigneeCandidates({ environmentId, input: reference }),
  );
  const setAssignees = useAtomCommand(issueEnvironment.setAssignees, { reportFailure: false });
  const setTicketAssignees = useAtomCommand(ticketEnvironment.githubIssueSetAssignees, {
    reportFailure: false,
  });
  const allCandidates = candidatesQuery.data?.candidates ?? EMPTY_ASSIGNEE_CANDIDATES;
  const viewer = allCandidates.find((candidate) => candidate.isViewer) ?? null;
  const candidates = useMemo(
    () => allCandidates.filter((candidate) => !candidate.isViewer && matches(candidate, query)),
    [allCandidates, query],
  );

  const toggle = async (candidate: IssueAssigneeCandidate) => {
    if (pending !== null) return;
    setPending(candidate.id);
    const assigned = !candidate.isAssigned;
    const result =
      "ticketId" in reference
        ? await setTicketAssignees({
            environmentId,
            input: { ...reference, assignees: [candidate.id], assigned },
          })
        : await setAssignees({
            environmentId,
            input: { ...reference, assignees: [candidate.id], assigned },
          });
    setPending(null);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: assigned
          ? `Could not assign ${candidate.login}`
          : `Could not unassign ${candidate.login}`,
        description: readableFailure(squashAtomCommandFailure(result)),
      });
      return;
    }
    toastManager.add({
      type: "success",
      title: assigned ? `${candidate.login} assigned` : `${candidate.login} unassigned`,
    });
    onAssigned();
    candidatesQuery.refresh();
  };

  return (
    <Menu open={open} onOpenChange={setOpen}>
      <MenuTrigger
        render={
          <Button size="icon-xs" variant="ghost" aria-label="Assign someone to this issue">
            <UserPlusIcon className="size-3.5" />
          </Button>
        }
      />
      <MenuPopup align="start" side="bottom" className="w-72">
        {viewer !== null ? (
          <button
            type="button"
            disabled={pending !== null}
            onClick={() => void toggle(viewer)}
            className="flex w-full items-center gap-2 border-b border-border/60 px-3 py-2 text-left text-xs hover:bg-accent/60 disabled:opacity-60"
          >
            <SourceControlActorAvatar actor={viewer} className="size-5" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">
                {viewer.isAssigned ? "Unassign yourself" : "Assign yourself"}
              </span>
              <span className="block truncate text-muted-foreground">@{viewer.login}</span>
            </span>
            {viewer.isAssigned ? <CheckIcon aria-label="Assigned" className="size-3.5" /> : null}
          </button>
        ) : null}
        <div className="border-b border-border/60 p-2">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search people with access"
            aria-label="Search people with access"
            size="compact"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {candidatesQuery.isPending ? (
            <p className="p-2 text-xs text-muted-foreground">Loading people…</p>
          ) : candidatesQuery.error !== null ? (
            <p className="p-2 text-xs text-muted-foreground">
              The people who can be assigned could not be read. {candidatesQuery.error}
            </p>
          ) : candidates.length === 0 ? (
            <p className="p-2 text-xs text-muted-foreground">
              {query.trim().length > 0
                ? "Nobody with access matches that."
                : "Nobody else can be assigned to this issue."}
            </p>
          ) : (
            candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                disabled={pending !== null}
                onClick={() => void toggle(candidate)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent/60 disabled:opacity-60"
              >
                <SourceControlActorAvatar actor={candidate} className="size-5" />
                <span className="min-w-0 flex-1 truncate">
                  {candidate.name && candidate.name !== candidate.login
                    ? `${candidate.name} (@${candidate.login})`
                    : candidate.login}
                </span>
                {candidate.isAssigned ? (
                  <CheckIcon aria-label="Assigned" className="size-3.5 shrink-0" />
                ) : null}
              </button>
            ))
          )}
          {candidatesQuery.data?.truncated ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              More people have access than are listed here. Use GitHub to find the rest.
            </p>
          ) : null}
        </div>
      </MenuPopup>
    </Menu>
  );
}
