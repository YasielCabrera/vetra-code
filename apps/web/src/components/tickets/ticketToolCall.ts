import { readT3ToolResult } from "@t3tools/client-runtime/t3ToolSummary";
import { PositiveInt, TicketId, TicketPlanSummary } from "@t3tools/contracts";
import { resolveT3McpToolSummaryAction } from "@t3tools/shared/t3McpToolPresentation";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

const CreatedTicket = Schema.Struct({ id: TicketId, number: PositiveInt, title: Schema.String });
const WrittenPlan = TicketPlanSummary.mapFields(
  Struct.pick(["ticketId", "number", "ref", "title"]),
);

const decodeCreatedTicket = Schema.decodeUnknownOption(CreatedTicket);
const decodeWrittenPlan = Schema.decodeUnknownOption(WrittenPlan);

/** What a finished ticket tool call produced that the timeline links to. */
export type TicketToolCallTarget =
  | { readonly kind: "ticket"; readonly ticket: typeof CreatedTicket.Type }
  | { readonly kind: "plan"; readonly plan: typeof WrittenPlan.Type };

export function ticketToolCallTarget(
  item:
    | {
        readonly type: string;
        readonly status: string;
        readonly toolName?: string | null;
        readonly output?: unknown;
      }
    | undefined,
): TicketToolCallTarget | null {
  if (item?.type !== "dynamic_tool" || item.status !== "completed") return null;
  switch (resolveT3McpToolSummaryAction(item.toolName)) {
    case "ticket-create":
      return Option.getOrNull(
        Option.map(decodeCreatedTicket(readT3ToolResult(item.output)), (ticket) => ({
          kind: "ticket" as const,
          ticket,
        })),
      );
    case "ticket-plan-create":
    case "ticket-plan-update":
      return Option.getOrNull(
        Option.map(decodeWrittenPlan(readT3ToolResult(item.output)), (plan) => ({
          kind: "plan" as const,
          plan,
        })),
      );
    default:
      return null;
  }
}
