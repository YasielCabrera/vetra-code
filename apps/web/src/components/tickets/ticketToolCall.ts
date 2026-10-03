import { readT3ToolResult } from "@t3tools/client-runtime/t3ToolSummary";
import { PositiveInt, TicketId } from "@t3tools/contracts";
import { resolveT3McpToolSummaryAction } from "@t3tools/shared/t3McpToolPresentation";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CreatedTicket = Schema.Struct({ id: TicketId, number: PositiveInt, title: Schema.String });
type CreatedTicket = typeof CreatedTicket.Type;

const decodeCreatedTicket = Schema.decodeUnknownOption(CreatedTicket);

export function createdTicketFromToolItem(
  item:
    | {
        readonly type: string;
        readonly status: string;
        readonly toolName?: string | null;
        readonly output?: unknown;
      }
    | undefined,
): CreatedTicket | null {
  if (item?.type !== "dynamic_tool" || item.status !== "completed") return null;
  if (resolveT3McpToolSummaryAction(item.toolName) !== "ticket-create") return null;
  return Option.getOrNull(decodeCreatedTicket(readT3ToolResult(item.output)));
}
