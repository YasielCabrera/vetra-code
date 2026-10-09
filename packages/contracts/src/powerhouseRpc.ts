/**
 * The Powerhouse panel's WebSocket RPCs, kept in their own group so the core
 * group in `rpc.ts` stays upstream's. `rpc.ts` spreads the method names into
 * `WS_METHODS` and merges this group into `WsRpcGroup`.
 *
 * @module powerhouseRpc
 */
import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { EnvironmentAuthorizationError } from "./auth.ts";
import {
  PowerhouseDatabaseCatalogInput,
  PowerhouseDatabaseCatalogResult,
  PowerhouseDatabaseDiscoverInput,
  PowerhouseDatabaseDiscoverResult,
  PowerhouseDatabaseError,
  PowerhouseDatabaseExecuteQueryInput,
  PowerhouseDatabaseExecuteQueryResult,
  PowerhouseDatabaseGetRelationInput,
  PowerhouseDatabaseGetRelationResult,
  PowerhouseDatabasePreviewRelationInput,
  PowerhouseDatabasePreviewRelationResult,
  PowerhouseDatabaseRefreshSnapshotInput,
  PowerhouseDatabaseRefreshSnapshotResult,
  PowerhouseDocumentModel,
  PowerhouseGetDocumentModelInput,
  PowerhouseListProjectsInput,
  PowerhouseListProjectsResult,
  PowerhouseListDocumentModelsInput,
  PowerhouseListDocumentModelsResult,
  PowerhouseProjectError,
  PowerhouseReactorConnection,
  PowerhouseReactorDocument,
  PowerhouseReactorError,
  PowerhouseReactorExecuteGraphqlInput,
  PowerhouseReactorExecuteGraphqlResult,
  PowerhouseReactorGetDocumentInput,
  PowerhouseReactorGetOperationsInput,
  PowerhouseReactorGetOperationsResult,
  PowerhouseReactorListDocumentsInput,
  PowerhouseReactorListDocumentsResult,
  PowerhouseReactorListDrivesInput,
  PowerhouseReactorListDrivesResult,
  PowerhouseReactorProbeInput,
} from "./powerhouse.ts";

export const POWERHOUSE_WS_METHODS = {
  powerhouseListProjects: "powerhouse.listProjects",
  powerhouseListDocumentModels: "powerhouse.listDocumentModels",
  powerhouseGetDocumentModel: "powerhouse.getDocumentModel",
  powerhouseReactorProbe: "powerhouse.reactorProbe",
  powerhouseReactorListDrives: "powerhouse.reactorListDrives",
  powerhouseReactorListDocuments: "powerhouse.reactorListDocuments",
  powerhouseReactorGetDocument: "powerhouse.reactorGetDocument",
  powerhouseReactorGetOperations: "powerhouse.reactorGetOperations",
  powerhouseReactorExecuteGraphql: "powerhouse.reactorExecuteGraphql",
  powerhouseDatabaseDiscover: "powerhouse.databaseDiscover",
  powerhouseDatabaseCatalog: "powerhouse.databaseCatalog",
  powerhouseDatabaseGetRelation: "powerhouse.databaseGetRelation",
  powerhouseDatabasePreviewRelation: "powerhouse.databasePreviewRelation",
  powerhouseDatabaseExecuteQuery: "powerhouse.databaseExecuteQuery",
  powerhouseDatabaseRefreshSnapshot: "powerhouse.databaseRefreshSnapshot",
} as const;

export const WsPowerhouseListProjectsRpc = Rpc.make(POWERHOUSE_WS_METHODS.powerhouseListProjects, {
  payload: PowerhouseListProjectsInput,
  success: PowerhouseListProjectsResult,
  error: Schema.Union([PowerhouseProjectError, EnvironmentAuthorizationError]),
});

export const WsPowerhouseListDocumentModelsRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseListDocumentModels,
  {
    payload: PowerhouseListDocumentModelsInput,
    success: PowerhouseListDocumentModelsResult,
    error: Schema.Union([PowerhouseProjectError, EnvironmentAuthorizationError]),
  },
);

export const WsPowerhouseGetDocumentModelRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseGetDocumentModel,
  {
    payload: PowerhouseGetDocumentModelInput,
    success: PowerhouseDocumentModel,
    error: Schema.Union([PowerhouseProjectError, EnvironmentAuthorizationError]),
  },
);

export const WsPowerhouseReactorProbeRpc = Rpc.make(POWERHOUSE_WS_METHODS.powerhouseReactorProbe, {
  payload: PowerhouseReactorProbeInput,
  success: PowerhouseReactorConnection,
  error: Schema.Union([
    PowerhouseReactorError,
    PowerhouseProjectError,
    EnvironmentAuthorizationError,
  ]),
});

export const WsPowerhouseReactorListDrivesRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseReactorListDrives,
  {
    payload: PowerhouseReactorListDrivesInput,
    success: PowerhouseReactorListDrivesResult,
    error: Schema.Union([PowerhouseReactorError, EnvironmentAuthorizationError]),
  },
);

export const WsPowerhouseReactorListDocumentsRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseReactorListDocuments,
  {
    payload: PowerhouseReactorListDocumentsInput,
    success: PowerhouseReactorListDocumentsResult,
    error: Schema.Union([PowerhouseReactorError, EnvironmentAuthorizationError]),
  },
);

export const WsPowerhouseReactorGetDocumentRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseReactorGetDocument,
  {
    payload: PowerhouseReactorGetDocumentInput,
    success: PowerhouseReactorDocument,
    error: Schema.Union([PowerhouseReactorError, EnvironmentAuthorizationError]),
  },
);

export const WsPowerhouseReactorGetOperationsRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseReactorGetOperations,
  {
    payload: PowerhouseReactorGetOperationsInput,
    success: PowerhouseReactorGetOperationsResult,
    error: Schema.Union([PowerhouseReactorError, EnvironmentAuthorizationError]),
  },
);

export const WsPowerhouseReactorExecuteGraphqlRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseReactorExecuteGraphql,
  {
    payload: PowerhouseReactorExecuteGraphqlInput,
    success: PowerhouseReactorExecuteGraphqlResult,
    error: Schema.Union([PowerhouseReactorError, EnvironmentAuthorizationError]),
  },
);

export const WsPowerhouseDatabaseDiscoverRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseDatabaseDiscover,
  {
    payload: PowerhouseDatabaseDiscoverInput,
    success: PowerhouseDatabaseDiscoverResult,
    error: Schema.Union([
      PowerhouseDatabaseError,
      PowerhouseProjectError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsPowerhouseDatabaseCatalogRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseDatabaseCatalog,
  {
    payload: PowerhouseDatabaseCatalogInput,
    success: PowerhouseDatabaseCatalogResult,
    error: Schema.Union([
      PowerhouseDatabaseError,
      PowerhouseProjectError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsPowerhouseDatabaseGetRelationRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseDatabaseGetRelation,
  {
    payload: PowerhouseDatabaseGetRelationInput,
    success: PowerhouseDatabaseGetRelationResult,
    error: Schema.Union([
      PowerhouseDatabaseError,
      PowerhouseProjectError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsPowerhouseDatabasePreviewRelationRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseDatabasePreviewRelation,
  {
    payload: PowerhouseDatabasePreviewRelationInput,
    success: PowerhouseDatabasePreviewRelationResult,
    error: Schema.Union([
      PowerhouseDatabaseError,
      PowerhouseProjectError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsPowerhouseDatabaseExecuteQueryRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseDatabaseExecuteQuery,
  {
    payload: PowerhouseDatabaseExecuteQueryInput,
    success: PowerhouseDatabaseExecuteQueryResult,
    error: Schema.Union([
      PowerhouseDatabaseError,
      PowerhouseProjectError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const WsPowerhouseDatabaseRefreshSnapshotRpc = Rpc.make(
  POWERHOUSE_WS_METHODS.powerhouseDatabaseRefreshSnapshot,
  {
    payload: PowerhouseDatabaseRefreshSnapshotInput,
    success: PowerhouseDatabaseRefreshSnapshotResult,
    error: Schema.Union([
      PowerhouseDatabaseError,
      PowerhouseProjectError,
      EnvironmentAuthorizationError,
    ]),
  },
);

export const PowerhouseRpcGroup = RpcGroup.make(
  WsPowerhouseListProjectsRpc,
  WsPowerhouseListDocumentModelsRpc,
  WsPowerhouseGetDocumentModelRpc,
  WsPowerhouseReactorProbeRpc,
  WsPowerhouseReactorListDrivesRpc,
  WsPowerhouseReactorListDocumentsRpc,
  WsPowerhouseReactorGetDocumentRpc,
  WsPowerhouseReactorGetOperationsRpc,
  WsPowerhouseReactorExecuteGraphqlRpc,
  WsPowerhouseDatabaseDiscoverRpc,
  WsPowerhouseDatabaseCatalogRpc,
  WsPowerhouseDatabaseGetRelationRpc,
  WsPowerhouseDatabasePreviewRelationRpc,
  WsPowerhouseDatabaseExecuteQueryRpc,
  WsPowerhouseDatabaseRefreshSnapshotRpc,
);
