import type { PowerhouseReferenceKind } from "@vetra-code/shared/composerInlineTokens";
import { FileText, Folder, HardDrive } from "lucide-react";

import {
  CHAT_INLINE_CHIP_CLASS_NAME,
  CHAT_INLINE_CHIP_LABEL_CLASS_NAME,
  COMPOSER_INLINE_CHIP_CLASS_NAME,
  COMPOSER_INLINE_CHIP_ICON_CLASS_NAME,
  COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME,
} from "../composerInlineChip";

export const POWERHOUSE_TAG_CHIP_CLASS_NAME = COMPOSER_INLINE_CHIP_CLASS_NAME;
export const CHAT_POWERHOUSE_TAG_CHIP_CLASS_NAME = CHAT_INLINE_CHIP_CLASS_NAME;

/** Same icons the Powerhouse panel gives these rows, so a chip reads as the row it came from. */
const KIND_ICONS = {
  drive: HardDrive,
  folder: Folder,
  doc: FileText,
} as const satisfies Record<PowerhouseReferenceKind, unknown>;

export function PowerhouseTagChipContent(props: {
  kind: PowerhouseReferenceKind;
  label: string;
  selectable?: boolean;
}) {
  const Icon = KIND_ICONS[props.kind];
  return (
    <>
      <Icon aria-hidden="true" className={COMPOSER_INLINE_CHIP_ICON_CLASS_NAME} />
      <span
        className={
          props.selectable
            ? CHAT_INLINE_CHIP_LABEL_CLASS_NAME
            : COMPOSER_INLINE_CHIP_LABEL_CLASS_NAME
        }
      >
        {props.label}
      </span>
    </>
  );
}
