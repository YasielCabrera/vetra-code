import { AuthMcpClientAccess } from "@t3tools/contracts";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { EyeIcon, type LucideIcon, TicketIcon, WrenchIcon } from "lucide-react";
import { useId } from "react";

import { cn } from "~/lib/utils";
import { runtimeModeConfig } from "../chat/runtimeModeConfig";
import { RadioGroup } from "../ui/radio-group";

export type McpToolsChoice = "all" | "tickets";

interface ChoiceConfig {
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

const toolsConfig: Record<McpToolsChoice, ChoiceConfig> = {
  all: {
    label: "All tools",
    description: "Threads, worktrees, pull requests, projects and tickets.",
    icon: WrenchIcon,
  },
  tickets: {
    label: "Tickets only",
    description: "Tickets and their plans, plus listing projects. Cannot see or start threads.",
    icon: TicketIcon,
  },
};

function accessConfig(tools: McpToolsChoice): Record<AuthMcpClientAccess, ChoiceConfig> {
  return {
    "read-only": {
      label: "Read only",
      description:
        tools === "tickets"
          ? "Read projects and tickets. Cannot create or change anything."
          : "Read projects and threads. Cannot start, message or change anything.",
      icon: EyeIcon,
    },
    ...runtimeModeConfig,
  };
}

export function McpClientGrantFields({
  access,
  onAccessChange,
  accessOptions = AuthMcpClientAccess.literals,
  tools,
  onToolsChange,
}: {
  readonly access: AuthMcpClientAccess;
  readonly onAccessChange: (access: AuthMcpClientAccess) => void;
  readonly accessOptions?: ReadonlyArray<AuthMcpClientAccess>;
  readonly tools: McpToolsChoice;
  readonly onToolsChange: (tools: McpToolsChoice) => void;
}) {
  const id = useId();
  const accessChoices = accessConfig(tools);
  return (
    <>
      <div className="space-y-2">
        <span id={`${id}-access`} className="text-sm font-medium">
          What it may do
        </span>
        <RadioGroup
          aria-labelledby={`${id}-access`}
          value={access}
          onValueChange={(value) => onAccessChange(value as AuthMcpClientAccess)}
        >
          {accessOptions.map((option) => (
            <ChoiceOption
              key={option}
              value={option}
              selected={option === access}
              {...accessChoices[option]}
            />
          ))}
        </RadioGroup>
        <p className="text-xs text-muted-foreground">
          {tools === "tickets"
            ? "Beyond read only, it can create and edit tickets and their plans."
            : "Beyond read only, it can start, message and stop threads, and none of them can run with more than the mode you pick."}
        </p>
      </div>

      <div className="space-y-2">
        <span id={`${id}-tools`} className="text-sm font-medium">
          Tools
        </span>
        <RadioGroup
          aria-labelledby={`${id}-tools`}
          value={tools}
          onValueChange={(value) => onToolsChange(value as McpToolsChoice)}
        >
          {(["all", "tickets"] as const).map((option) => (
            <ChoiceOption
              key={option}
              value={option}
              selected={option === tools}
              {...toolsConfig[option]}
            />
          ))}
        </RadioGroup>
      </div>
    </>
  );
}

function ChoiceOption({
  value,
  selected,
  label,
  description,
  icon: Icon,
}: ChoiceConfig & { readonly value: string; readonly selected: boolean }) {
  return (
    <RadioPrimitive.Root
      value={value}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow]",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-background ring-2 ring-inset ring-primary/25 dark:border-transparent dark:bg-primary/10 dark:ring-1 dark:ring-primary/30"
          : "border-border bg-background hover:bg-muted/50 dark:border-transparent dark:bg-white/[0.035] dark:hover:bg-accent",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </RadioPrimitive.Root>
  );
}
