import { createPullRequestEnvironmentAtoms } from "@vetra-studio/client-runtime/state/pull-requests";

import { connectionAtomRuntime } from "../connection/runtime";

export const pullRequestEnvironment = createPullRequestEnvironmentAtoms(connectionAtomRuntime);
