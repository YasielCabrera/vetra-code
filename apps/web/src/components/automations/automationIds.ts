import { AutomationId } from "@vetra-code/contracts";

import { randomUUID } from "../../lib/utils";

export const newAutomationId = (): AutomationId => AutomationId.make(randomUUID());
