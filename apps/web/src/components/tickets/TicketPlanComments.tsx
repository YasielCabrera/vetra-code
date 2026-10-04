import type {
  EnvironmentId,
  TicketPlanComment,
  TicketPlanCommentId,
  TicketPlanId,
} from "@t3tools/contracts";
import type { PlanCommentThread } from "@t3tools/shared/ticketPlanAnchors";
import { memo, useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import type { useTicketActions } from "../../hooks/useTicketActions";
import { cn } from "../../lib/utils";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { TicketActorName } from "./TicketActivityTimeline";
import { PLAN_BLOCK_LABELS, type PlanCommentDraft } from "./TicketPlanCommentSurface";

/** A Markdown comment box: Cmd/Ctrl+Enter submits, Escape cancels. */
function PlanCommentComposer({
  ref,
  label,
  placeholder,
  submitLabel,
  autoFocus,
  onSubmit,
  onCancel,
  children,
}: {
  readonly ref?: Ref<HTMLTextAreaElement>;
  readonly label: string;
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly autoFocus?: boolean;
  /** Resolves true once the comment is saved, which clears the box. */
  readonly onSubmit: (body: string) => Promise<boolean>;
  readonly onCancel?: (() => void) | undefined;
  /** What the comment is about, above the box. */
  readonly children?: ReactNode;
}) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const submit = async () => {
    const body = text.trim();
    if (!body || posting) return;
    setPosting(true);
    const saved = await onSubmit(body);
    setPosting(false);
    if (saved) setText("");
  };
  return (
    <div className="flex flex-col gap-2">
      {children}
      <Textarea
        ref={ref}
        value={text}
        size="sm"
        aria-label={label}
        placeholder={placeholder}
        autoFocus={autoFocus}
        readOnly={posting}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape" && !posting) {
            event.preventDefault();
            setText("");
            onCancel?.();
            event.currentTarget.blur();
          }
        }}
      />
      {text.trim() || onCancel ? (
        <div className="flex items-center justify-end gap-1.5">
          {onCancel ? (
            <Button size="xs" variant="ghost" disabled={posting} onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button size="xs" disabled={!text.trim() || posting} onClick={() => void submit()}>
            {posting ? "Posting…" : submitLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** The thread in focus. `reveal` scrolls the comment list to it, which a click in the list skips. */
export interface PlanCommentFocus {
  readonly id: TicketPlanCommentId;
  readonly reveal: boolean;
}

function PlanCommentExcerpt(props: { readonly quote: string | null; readonly source: string }) {
  return props.quote !== null ? (
    <p className="line-clamp-3 border-s-2 border-primary/50 ps-2 text-xs text-muted-foreground">
      {props.quote}
    </p>
  ) : (
    <pre className="line-clamp-4 rounded-md bg-muted/50 px-2 py-1.5 font-mono text-2xs whitespace-pre-wrap break-words text-muted-foreground">
      {props.source}
    </pre>
  );
}

/**
 * The top of the Open tab: a comment on the passage the user picked, or on the whole plan.
 * `draft` comes from the plan's Comment buttons; cancelling drops it.
 */
export function TicketPlanNewComment({
  ref,
  draft,
  onCancelDraft,
  onSubmit,
}: {
  readonly ref: Ref<HTMLTextAreaElement>;
  readonly draft: PlanCommentDraft | null;
  readonly onCancelDraft: () => void;
  readonly onSubmit: (body: string) => Promise<boolean>;
}) {
  return (
    <PlanCommentComposer
      ref={ref}
      label={draft === null ? "Comment on the whole plan" : "Comment on the selection"}
      placeholder={draft === null ? "Comment on the whole plan…" : "Add a comment…"}
      submitLabel="Comment"
      onSubmit={onSubmit}
      onCancel={draft === null ? undefined : onCancelDraft}
    >
      {draft === null ? null : draft.kind !== null ? (
        <p className="text-xs text-muted-foreground">On this {PLAN_BLOCK_LABELS[draft.kind]}</p>
      ) : (
        <PlanCommentExcerpt quote={draft.anchor.quote?.text ?? null} source={draft.anchor.source} />
      )}
    </PlanCommentComposer>
  );
}

function PlanCommentByline(props: {
  readonly environmentId: EnvironmentId;
  readonly comment: TicketPlanComment;
  readonly children?: ReactNode;
}) {
  const { comment } = props;
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="truncate font-medium text-foreground">
        <TicketActorName environmentId={props.environmentId} actor={comment.author} />
      </span>
      <time dateTime={comment.createdAt} aria-label={new Date(comment.createdAt).toLocaleString()}>
        {formatRelativeTimeLabel(comment.createdAt)}
      </time>
      {props.children}
    </div>
  );
}

function PlanCommentBody(props: { readonly environmentId: EnvironmentId; readonly body: string }) {
  return (
    <ChatMarkdown
      text={props.body}
      cwd={undefined}
      environmentId={props.environmentId}
      allowLocalFileLinks={false}
    />
  );
}

/**
 * One top-level comment with its replies. Clicking it, or its excerpt by keyboard, selects it;
 * the plan scrolls to its passage.
 */
const TicketPlanCommentThread = memo(function TicketPlanCommentThread(props: {
  readonly environmentId: EnvironmentId;
  readonly planId: TicketPlanId;
  readonly revision: number;
  readonly thread: PlanCommentThread;
  readonly focus: PlanCommentFocus | null;
  readonly onSelect: (thread: PlanCommentThread) => void;
  readonly actions: ReturnType<typeof useTicketActions>;
}) {
  const { environmentId, planId, revision, thread, focus, onSelect, actions } = props;
  const { comment, location, replies } = thread;
  const [replying, setReplying] = useState(false);
  const itemRef = useRef<HTMLLIElement>(null);
  const focused = focus !== null;
  const resolved = comment.resolvedAt !== null;
  const outdated = location?.status === "outdated";

  // A new comment mounts after its focus is set, so this also reveals it once it arrives.
  useEffect(() => {
    if (focus?.reveal) itemRef.current?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  const remove = (target: TicketPlanComment) =>
    void actions.confirmAndDeletePlanComment(environmentId, planId, target);

  return (
    <li
      ref={itemRef}
      aria-current={focused || undefined}
      className={cn(
        "flex flex-col gap-2 rounded-lg border p-3",
        focused ? "border-primary/50 bg-primary/5" : "border-border/70",
      )}
      onClick={(event) => {
        if (window.getSelection()?.isCollapsed === false) return;
        if (!(event.target as Element).closest("a, button, textarea")) onSelect(thread);
      }}
    >
      <PlanCommentByline environmentId={environmentId} comment={comment}>
        {outdated ? (
          <span className="ms-auto shrink-0 rounded-sm bg-muted px-1.5 text-2xs">Outdated</span>
        ) : null}
      </PlanCommentByline>
      {comment.anchor === null ? null : outdated ? (
        <PlanCommentExcerpt quote={null} source={comment.anchor.source} />
      ) : (
        <button
          type="button"
          className="rounded-sm text-start outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => onSelect(thread)}
        >
          <PlanCommentExcerpt
            quote={comment.anchor.quote?.text ?? null}
            source={comment.anchor.source}
          />
        </button>
      )}
      <PlanCommentBody environmentId={environmentId} body={comment.body} />

      {replies.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-2 border-s border-border/70 p-0 ps-3">
          {replies.map((reply) => (
            <li key={reply.id} className="group/reply flex flex-col gap-1">
              <PlanCommentByline environmentId={environmentId} comment={reply}>
                <div className="ms-auto opacity-0 group-hover/reply:opacity-100 group-focus-within/reply:opacity-100">
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    aria-label="Delete reply"
                    onClick={() => remove(reply)}
                  >
                    Delete
                  </Button>
                </div>
              </PlanCommentByline>
              <PlanCommentBody environmentId={environmentId} body={reply.body} />
            </li>
          ))}
        </ol>
      ) : null}

      {replying ? (
        <PlanCommentComposer
          label="Reply"
          placeholder="Reply…"
          submitLabel="Reply"
          autoFocus
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            const reply = await actions.addPlanComment(environmentId, {
              planId,
              body,
              parentCommentId: comment.id,
            });
            if (reply !== null) setReplying(false);
            return reply !== null;
          }}
        />
      ) : null}

      {comment.resolvedAt !== null && comment.resolvedBy !== null ? (
        <p className="text-xs text-muted-foreground">
          Resolved by <TicketActorName environmentId={environmentId} actor={comment.resolvedBy} />
          {" · "}
          {formatRelativeTimeLabel(comment.resolvedAt)}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {resolved ? (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => void actions.reopenPlanComment(environmentId, planId, comment)}
          >
            Reopen
          </Button>
        ) : (
          <>
            {replying ? null : (
              <Button size="xs" variant="ghost" onClick={() => setReplying(true)}>
                Reply
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                void actions.updatePlan(environmentId, {
                  planId,
                  expectedRevision: revision,
                  resolveCommentIds: [comment.id],
                })
              }
            >
              Resolve
            </Button>
          </>
        )}
        <div className="ms-auto">
          <Button size="xs" variant="ghost-muted" onClick={() => remove(comment)}>
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
});

export function TicketPlanCommentList(props: {
  readonly environmentId: EnvironmentId;
  readonly planId: TicketPlanId;
  readonly revision: number;
  readonly threads: ReadonlyArray<PlanCommentThread>;
  readonly focus: PlanCommentFocus | null;
  readonly onSelect: (thread: PlanCommentThread) => void;
  readonly actions: ReturnType<typeof useTicketActions>;
  readonly empty: string;
}) {
  if (props.threads.length === 0) {
    return <p className="text-xs text-muted-foreground">{props.empty}</p>;
  }
  return (
    <ol aria-label="Comments" className="m-0 flex list-none flex-col gap-3 p-0">
      {props.threads.map((thread) => (
        <TicketPlanCommentThread
          key={thread.comment.id}
          environmentId={props.environmentId}
          planId={props.planId}
          revision={props.revision}
          thread={thread}
          focus={props.focus?.id === thread.comment.id ? props.focus : null}
          onSelect={props.onSelect}
          actions={props.actions}
        />
      ))}
    </ol>
  );
}
