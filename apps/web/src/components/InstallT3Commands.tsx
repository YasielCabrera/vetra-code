import { cn } from "~/lib/utils";

import { CommandBlock } from "./CommandBlock";

export function InstallT3Commands({
  command,
  className,
}: {
  readonly command: string;
  readonly className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-xs text-muted-foreground">Build Vetra Code on the other computer.</p>
      <CommandBlock command="git clone https://github.com/YasielCabrera/vetra-code.git" />
      <CommandBlock command="cd vetra-code" />
      <CommandBlock command="vp i && vp run build:desktop" />
      <p className="text-xs text-muted-foreground">Then</p>
      <CommandBlock command={command.replace(/^vetra\b/, "node apps/server/dist/bin.mjs")} />
      <p className="text-xs text-muted-foreground">
        You can also install the vetra command from Settings in the desktop app.
      </p>
    </div>
  );
}
