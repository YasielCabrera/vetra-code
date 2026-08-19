import { createPowerhouseEnvironmentAtoms } from "@vetra-code/client-runtime/state/powerhouse";

import { connectionAtomRuntime } from "../connection/runtime";

export const powerhouseEnvironment = createPowerhouseEnvironmentAtoms(connectionAtomRuntime);
