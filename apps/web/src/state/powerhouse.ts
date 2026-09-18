import { createPowerhouseEnvironmentAtoms } from "@t3tools/client-runtime/state/powerhouse";

import { connectionAtomRuntime } from "../connection/runtime";

export const powerhouseEnvironment = createPowerhouseEnvironmentAtoms(connectionAtomRuntime);
