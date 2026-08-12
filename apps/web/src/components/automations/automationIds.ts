import { AutomationId } from "@vetra-studio/contracts";

import { randomUUID } from "../../lib/utils";

export const newAutomationId = (): AutomationId => AutomationId.make(randomUUID());
