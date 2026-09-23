import type { PowerhouseReferenceKind } from "@t3tools/shared/composerInlineTokens";
import { FileText, Folder, HardDrive } from "lucide-react";

import { ContextChipLabel } from "../ContextChip";

/** Same icons the Powerhouse panel gives these rows, so a chip reads as the row it came from. */
const KIND_ICONS = {
  drive: HardDrive,
  folder: Folder,
  doc: FileText,
} as const satisfies Record<PowerhouseReferenceKind, unknown>;

/** Icon and label for a Powerhouse reference; render inside `<ContextChip>`. */
export function PowerhouseTagChipContent(props: { kind: PowerhouseReferenceKind; label: string }) {
  const Icon = KIND_ICONS[props.kind];
  return (
    <>
      <Icon aria-hidden="true" />
      <ContextChipLabel>{props.label}</ContextChipLabel>
    </>
  );
}
