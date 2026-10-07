/**
 * handlers - the Powerhouse panel's RPC handlers, packaged as one record.
 *
 * Kept out of `ws.ts` so the whole surface stays deletable: `ws.ts` imports this
 * and spreads it, and removing the feature removes both lines.
 *
 * @module handlers
 */
import * as Effect from "effect/Effect";

import {
  POWERHOUSE_DEFAULT_REACTOR_PORT,
  POWERHOUSE_FALLBACK_REACTOR_PORT,
  type PowerhouseDatabaseCatalogInput,
  type PowerhouseDatabaseDiscoverInput,
  type PowerhouseDatabaseExecuteQueryInput,
  type PowerhouseDatabaseGetRelationInput,
  type PowerhouseDatabasePreviewRelationInput,
  type PowerhouseDatabaseRefreshSnapshotInput,
  type PowerhouseReactorGetDocumentInput,
  type PowerhouseReactorExecuteGraphqlInput,
  type PowerhouseReactorGetOperationsInput,
  type PowerhouseReactorListDocumentsInput,
  WS_METHODS,
} from "@t3tools/contracts";

import * as PowerhouseProject from "./PowerhouseProject.ts";
import * as PowerhouseReactorClient from "./PowerhouseReactorClient.ts";
import * as PowerhouseDatabaseInspector from "./PowerhouseDatabaseInspector.ts";

const loopbackUrl = (port: number) => `http://127.0.0.1:${port}`;

/**
 * Reactor URLs to try, most specific first.
 *
 * An explicit override is the only candidate when set: falling back from it
 * would report a connection to somewhere the user did not ask for.
 */
export function reactorCandidates(input: {
  readonly overrideUrl?: string | undefined;
  readonly configuredPort?: number | undefined;
}): ReadonlyArray<PowerhouseReactorClient.PowerhouseReactorCandidate> {
  if (input.overrideUrl !== undefined) {
    return [{ url: input.overrideUrl, source: "override" }];
  }
  const candidates: Array<PowerhouseReactorClient.PowerhouseReactorCandidate> = [];
  const seen = new Set<number>();
  if (input.configuredPort !== undefined) {
    seen.add(input.configuredPort);
    candidates.push({ url: loopbackUrl(input.configuredPort), source: "config" });
  }
  // The `ph` CLI defaults to 4001; reactor-api embedded as a library defaults to 4000.
  for (const port of [POWERHOUSE_DEFAULT_REACTOR_PORT, POWERHOUSE_FALLBACK_REACTOR_PORT]) {
    if (seen.has(port)) continue;
    seen.add(port);
    candidates.push({ url: loopbackUrl(port), source: "default" });
  }
  return candidates;
}

/**
 * Build the panel's handler record. Callers spread the result into
 * `WsRpcGroup.of({...})`.
 */
export const makePowerhouseWsHandlers = Effect.gen(function* () {
  const project = yield* PowerhouseProject.PowerhouseProject;
  const reactor = yield* PowerhouseReactorClient.PowerhouseReactorClient;
  const database = yield* PowerhouseDatabaseInspector.PowerhouseDatabaseInspector;

  return {
    [WS_METHODS.powerhouseListProjects]: (input: { readonly cwd: string }) =>
      project.listProjects(input.cwd).pipe(Effect.map((projects) => ({ projects }))),
    [WS_METHODS.powerhouseListDocumentModels]: (input: {
      readonly cwd: string;
      readonly projectPath?: string | undefined;
    }) => project.listDocumentModels(input),
    [WS_METHODS.powerhouseGetDocumentModel]: (input: {
      readonly cwd: string;
      readonly projectPath?: string | undefined;
      readonly directoryName: string;
    }) => project.getDocumentModel(input),
    [WS_METHODS.powerhouseReactorProbe]: (input: {
      readonly cwd: string;
      readonly projectPath?: string | undefined;
      readonly overrideUrl?: string | undefined;
    }) =>
      Effect.gen(function* () {
        // An override needs no config, so a project whose config went
        // missing can still be pointed at a running reactor.
        const configuredPort =
          input.overrideUrl === undefined
            ? (yield* project.readConfig(input)).reactorPort
            : undefined;
        return yield* reactor.probe(
          reactorCandidates({
            ...(input.overrideUrl === undefined ? {} : { overrideUrl: input.overrideUrl }),
            ...(configuredPort === undefined ? {} : { configuredPort }),
          }),
        );
      }),
    [WS_METHODS.powerhouseReactorListDrives]: (input: { readonly url: string }) =>
      reactor.listDrives(input.url),
    [WS_METHODS.powerhouseReactorListDocuments]: (input: PowerhouseReactorListDocumentsInput) =>
      reactor.listDocuments(input),
    [WS_METHODS.powerhouseReactorGetDocument]: (input: PowerhouseReactorGetDocumentInput) =>
      reactor.getDocument(input),
    [WS_METHODS.powerhouseReactorGetOperations]: (input: PowerhouseReactorGetOperationsInput) =>
      reactor.getOperations(input),
    [WS_METHODS.powerhouseReactorExecuteGraphql]: (input: PowerhouseReactorExecuteGraphqlInput) =>
      reactor.executeGraphql(input),
    [WS_METHODS.powerhouseDatabaseDiscover]: (input: PowerhouseDatabaseDiscoverInput) =>
      database.discover(input),
    [WS_METHODS.powerhouseDatabaseCatalog]: (input: PowerhouseDatabaseCatalogInput) =>
      database.catalog(input),
    [WS_METHODS.powerhouseDatabaseGetRelation]: (input: PowerhouseDatabaseGetRelationInput) =>
      database.getRelation(input),
    [WS_METHODS.powerhouseDatabasePreviewRelation]: (
      input: PowerhouseDatabasePreviewRelationInput,
    ) => database.previewRelation(input),
    [WS_METHODS.powerhouseDatabaseExecuteQuery]: (input: PowerhouseDatabaseExecuteQueryInput) =>
      database.executeQuery(input),
    [WS_METHODS.powerhouseDatabaseRefreshSnapshot]: (
      input: PowerhouseDatabaseRefreshSnapshotInput,
    ) => database.refreshSnapshot(input),
  };
});
