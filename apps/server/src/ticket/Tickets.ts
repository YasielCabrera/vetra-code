import * as Layer from "effect/Layer";

import * as IssueProviderRegistry from "../issue/IssueProviderRegistry.ts";
import * as SourceControlRateLimit from "../sourceControl/SourceControlRateLimit.ts";
import * as TicketDrafting from "./TicketDrafting.ts";
import * as TicketGitHub from "./TicketGitHub.ts";
import * as TicketGitHubSync from "./TicketGitHubSync.ts";
import * as TicketService from "./TicketService.ts";

const gitHubLayer = TicketGitHub.layer.pipe(
  Layer.provide(Layer.merge(IssueProviderRegistry.layer, SourceControlRateLimit.layer)),
);
const serviceLayer = TicketService.layer.pipe(Layer.provide(gitHubLayer));
const syncLayer = TicketGitHubSync.layer.pipe(
  Layer.provide(Layer.mergeAll(serviceLayer, gitHubLayer, IssueProviderRegistry.layer)),
);

export const layer = Layer.mergeAll(
  serviceLayer,
  syncLayer,
  TicketDrafting.layer.pipe(Layer.provide(serviceLayer)),
  TicketGitHubSync.workerLive.pipe(Layer.provide(syncLayer)),
);
