import { ScheduledTaskId } from "@t3tools/contracts";

import { randomUUID } from "../../lib/utils";

/** Same shape upstream's service mints, so tasks made here and elsewhere read alike. */
export const newAutomationId = (): ScheduledTaskId =>
  ScheduledTaskId.make(`scheduled-task:${randomUUID()}`);
