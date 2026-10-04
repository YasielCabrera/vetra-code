import type { EnvironmentId } from "@t3tools/contracts";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import {
  type ComponentProps,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useRef,
} from "react";

import { Button } from "../ui/button";
import { uploadTicketFiles } from "./ticketAttachments";
import { hasUnsavedBody } from "./ticketDocument.logic";
import type { useAutosavedDocument } from "./useAutosavedDocument";

const TicketBodyEditor = lazy(() => import("./TicketBodyEditor"));

export function TicketDocumentEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly doc: Pick<
    ReturnType<typeof useAutosavedDocument>,
    "state" | "edit" | "reload" | "keepMine" | "addPendingUpload"
  >;
  readonly label: "Description" | "Plan";
  readonly editing: boolean;
  readonly onDone: () => void;
  readonly doneDisabled?: boolean;
  readonly editor: Omit<
    ComponentProps<typeof TicketBodyEditor>,
    "value" | "onChange" | "onFiles" | "ariaLabel"
  >;
  readonly notice?: ReactNode;
  readonly emptyText: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { environmentId, doc, label, editing } = props;
  const noun = label.toLowerCase();
  const unsaved = hasUnsavedBody(doc.state);

  const editingRef = useRef(editing);
  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);
  const { addPendingUpload } = doc;
  const onFiles = useCallback(
    (files: ReadonlyArray<File>) =>
      uploadTicketFiles(
        environmentId,
        files,
        (upload) => editingRef.current && addPendingUpload(upload),
      ),
    [addPendingUpload, environmentId],
  );

  return (
    <>
      {doc.state.conflict ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-sm text-warning-foreground"
        >
          <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            Someone else changed the {noun} while you were editing.
          </span>
          <Button size="xs" variant="outline" onClick={doc.reload}>
            Reload
          </Button>
          <Button size="xs" onClick={doc.keepMine}>
            Keep mine
          </Button>
        </div>
      ) : null}

      <section aria-label={label} className="relative flex flex-col gap-3">
        {editing || unsaved || props.notice !== undefined ? (
          <div className="flex items-center justify-end gap-2">
            {unsaved ? (
              <span role="status" className="text-xs text-muted-foreground">
                Unsaved changes
              </span>
            ) : null}
            {props.notice}
            {editing ? (
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Done editing ${noun}`}
                disabled={props.doneDisabled}
                onClick={props.onDone}
              >
                <CheckIcon aria-hidden />
                Done
              </Button>
            ) : null}
          </div>
        ) : null}
        {editing ? (
          <div className="rounded-lg border border-input p-3 focus-within:border-ring">
            <Suspense
              fallback={
                <pre className="min-h-48 px-3 py-3 font-mono text-sm whitespace-pre-wrap">
                  {doc.state.text}
                </pre>
              }
            >
              <TicketBodyEditor
                {...props.editor}
                value={doc.state.text}
                onChange={doc.edit}
                onFiles={onFiles}
                ariaLabel={label}
              />
            </Suspense>
          </div>
        ) : (
          <div className="min-w-0">
            {doc.state.text.trim().length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{props.emptyText}</p>
            ) : (
              props.children
            )}
          </div>
        )}
        {props.footer}
      </section>
    </>
  );
}
