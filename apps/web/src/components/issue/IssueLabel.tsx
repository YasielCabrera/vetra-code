import type { CSSProperties } from "react";
import type { IssueLabel as IssueLabelValue } from "@t3tools/contracts";

const HEX_COLOR = /^[0-9a-f]{6}$/iu;

export function IssueLabel({ label }: { readonly label: IssueLabelValue }) {
  const color = label.color !== null && HEX_COLOR.test(label.color) ? label.color : null;
  const style: CSSProperties | undefined =
    color === null ? undefined : { backgroundColor: `#${color}` };
  return (
    <span className="inline-flex max-w-48 items-center gap-1.5 rounded-full border border-border/70 bg-muted/40 py-0.5 pr-2 pl-1.5 text-xs text-foreground">
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-muted-foreground"
        style={style}
      />
      <span className="truncate">{label.name}</span>
    </span>
  );
}
