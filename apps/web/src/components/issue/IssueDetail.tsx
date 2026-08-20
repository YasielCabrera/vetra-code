import type { IssueActor, IssueDetail as IssueDetailValue } from "@vetra-code/contracts";
import {
  ArrowLeftIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  ExternalLinkIcon,
  FlagIcon,
  TagIcon,
  UserRoundIcon,
} from "lucide-react";

import { readLocalApi } from "~/localApi";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import { cn } from "~/lib/utils";

import ChatMarkdown from "../ChatMarkdown";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { normalizeIssueExternalUrl } from "./issueExternalUrl";
import { IssueLabel } from "./IssueLabel";

function ActorAvatar({ actor }: { readonly actor: IssueActor | null }) {
  const label = actor?.login ?? "Unknown";
  return (
    <span
      aria-label={label}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold uppercase text-muted-foreground"
    >
      {label.slice(0, 2)}
    </span>
  );
}

function ConversationCard({
  actor,
  createdAt,
  body,
  action,
}: {
  readonly actor: IssueActor | null;
  readonly createdAt: string;
  readonly body: string;
  readonly action: "opened" | "commented";
}) {
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5 text-xs">
        <ActorAvatar actor={actor} />
        <span className="font-semibold text-foreground">{actor?.login ?? "Unknown author"}</span>
        <span className="text-muted-foreground">
          {action} {formatRelativeTimeLabel(createdAt)}
        </span>
      </header>
      <div className="min-h-24 px-4 py-4">
        {body.trim() ? (
          <ChatMarkdown className="max-w-none text-sm" cwd={undefined} text={body} />
        ) : (
          <p className="text-sm italic text-muted-foreground">No description provided.</p>
        )}
      </div>
    </article>
  );
}

export function IssueDetail({
  detail,
  onBack,
}: {
  readonly detail: IssueDetailValue;
  readonly onBack: () => void;
}) {
  const StateIcon = detail.state === "open" ? CircleDotIcon : CheckCircle2Icon;
  const openExternal = (raw: string) => {
    const url = normalizeIssueExternalUrl(raw);
    if (url !== null)
      void readLocalApi()
        ?.shell.openExternal(url)
        .catch(() => undefined);
  };
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-5 pb-12 sm:px-6">
      <Button className="mb-4" size="sm" variant="ghost-muted" onClick={onBack}>
        <ArrowLeftIcon aria-hidden />
        All issues
      </Button>

      <div className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-2xl leading-tight font-semibold text-foreground sm:text-3xl">
            {detail.title}{" "}
            <span className="font-normal text-muted-foreground">#{detail.number}</span>
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={detail.state === "open" ? "success" : "secondary"} size="lg">
              <StateIcon aria-hidden />
              {detail.state === "open" ? "Open" : "Closed"}
            </Badge>
            <span>
              {detail.author?.login ?? "Unknown author"} opened this issue{" "}
              {formatRelativeTimeLabel(detail.createdAt)}
            </span>
            <span>·</span>
            <span>
              {detail.commentCount} {detail.commentCount === 1 ? "comment" : "comments"}
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => openExternal(detail.url)}>
            Open on GitHub
            <ExternalLinkIcon aria-hidden />
          </Button>
          <Button onClick={() => openExternal(detail.newIssueUrl)}>New issue</Button>
        </div>
      </div>

      <div className="mt-6 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <section aria-label="Issue conversation" className="min-w-0 space-y-4">
          <ConversationCard
            action="opened"
            actor={detail.author}
            body={detail.body}
            createdAt={detail.createdAt}
          />
          {detail.comments.map((comment) => (
            <ConversationCard
              key={comment.id}
              action="commented"
              actor={comment.author}
              body={comment.body}
              createdAt={comment.createdAt}
            />
          ))}
          {detail.commentsTruncated ? (
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              More comments are available on GitHub.
            </div>
          ) : null}
        </section>

        <aside aria-label="Issue metadata" className="space-y-5 text-sm">
          <section className="border-b border-border pb-5">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <UserRoundIcon aria-hidden className="size-4 text-muted-foreground" />
              Assignees
            </h2>
            {detail.assignees.length > 0 ? (
              <div className="space-y-2">
                {detail.assignees.map((assignee) => (
                  <div key={assignee.login} className="flex items-center gap-2">
                    <ActorAvatar actor={assignee} />
                    <span className="truncate">{assignee.login}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No one assigned</p>
            )}
          </section>

          <section className="border-b border-border pb-5">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <TagIcon aria-hidden className="size-4 text-muted-foreground" />
              Labels
            </h2>
            {detail.labels.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {detail.labels.map((label) => (
                  <IssueLabel key={label.name} label={label} />
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground">No labels</p>
            )}
          </section>

          <section className="border-b border-border pb-5">
            <h2 className="mb-2 flex items-center gap-2 font-semibold text-foreground">
              <FlagIcon aria-hidden className="size-4 text-muted-foreground" />
              Milestone
            </h2>
            <p className={cn(detail.milestone === null && "text-muted-foreground")}>
              {detail.milestone?.title ?? "No milestone"}
            </p>
          </section>

          <section>
            <h2 className="mb-2 font-semibold text-foreground">Repository</h2>
            <button
              type="button"
              className="max-w-full truncate text-left text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => openExternal(detail.repositoryUrl)}
            >
              {detail.repository}
            </button>
            <p className="mt-1 text-xs text-muted-foreground">{detail.projectTitle}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
