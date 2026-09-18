import { AutomationId } from "@t3tools/contracts";

import { randomUUID } from "../../lib/utils";

export const newAutomationId = (): AutomationId => AutomationId.make(randomUUID());
