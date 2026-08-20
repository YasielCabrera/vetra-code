import type { CSSProperties } from "react";
import type { IssueLabel as IssueLabelValue } from "@vetra-code/contracts";

const HEX_COLOR = /^[0-9a-f]{6}$/iu;

export function IssueLabel({ label }: { readonly label: IssueLabelValue }) {
  const color = label.color !== null && HEX_COLOR.test(label.color) ? label.color : null;
  const style: CSSProperties | undefined =
    color === null
      ? undefined
      : {
          backgroundColor: `#${color}20`,
          borderColor: `#${color}70`,
        };
  return (
    <span
      className="inline-flex max-w-48 items-center truncate rounded-full border border-border bg-muted/70 px-2 py-0.5 text-[11px] font-medium text-foreground"
      style={style}
    >
      {label.name}
    </span>
  );
}
