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
  EnvironmentAuthorizationError,
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

type ObserveRpcEffect = <A, E, R>(
  method: string,
  effect: Effect.Effect<A, E, R>,
  traceAttributes?: Readonly<Record<string, unknown>>,
) => Effect.Effect<A, E | EnvironmentAuthorizationError, R>;

const TRACE = { "rpc.aggregate": "powerhouse" } as const;

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
export const makePowerhouseWsHandlers = (observeRpcEffect: ObserveRpcEffect) =>
  Effect.gen(function* () {
    const project = yield* PowerhouseProject.PowerhouseProject;
    const reactor = yield* PowerhouseReactorClient.PowerhouseReactorClient;
    const database = yield* PowerhouseDatabaseInspector.PowerhouseDatabaseInspector;

    return {
      [WS_METHODS.powerhouseListProjects]: (input: { readonly cwd: string }) =>
        observeRpcEffect(
          WS_METHODS.powerhouseListProjects,
          project.listProjects(input.cwd).pipe(Effect.map((projects) => ({ projects }))),
          TRACE,
        ),
      [WS_METHODS.powerhouseListDocumentModels]: (input: {
        readonly cwd: string;
        readonly projectPath?: string | undefined;
      }) =>
        observeRpcEffect(
          WS_METHODS.powerhouseListDocumentModels,
          project.listDocumentModels(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseGetDocumentModel]: (input: {
        readonly cwd: string;
        readonly projectPath?: string | undefined;
        readonly directoryName: string;
      }) =>
        observeRpcEffect(
          WS_METHODS.powerhouseGetDocumentModel,
          project.getDocumentModel(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseReactorProbe]: (input: {
        readonly cwd: string;
        readonly projectPath?: string | undefined;
        readonly overrideUrl?: string | undefined;
      }) =>
        observeRpcEffect(
          WS_METHODS.powerhouseReactorProbe,
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
          TRACE,
        ),
      [WS_METHODS.powerhouseReactorListDrives]: (input: { readonly url: string }) =>
        observeRpcEffect(
          WS_METHODS.powerhouseReactorListDrives,
          reactor.listDrives(input.url),
          TRACE,
        ),
      [WS_METHODS.powerhouseReactorListDocuments]: (input: PowerhouseReactorListDocumentsInput) =>
        observeRpcEffect(
          WS_METHODS.powerhouseReactorListDocuments,
          reactor.listDocuments(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseReactorGetDocument]: (input: PowerhouseReactorGetDocumentInput) =>
        observeRpcEffect(
          WS_METHODS.powerhouseReactorGetDocument,
          reactor.getDocument(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseReactorGetOperations]: (input: PowerhouseReactorGetOperationsInput) =>
        observeRpcEffect(
          WS_METHODS.powerhouseReactorGetOperations,
          reactor.getOperations(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseReactorExecuteGraphql]: (input: PowerhouseReactorExecuteGraphqlInput) =>
        observeRpcEffect(
          WS_METHODS.powerhouseReactorExecuteGraphql,
          reactor.executeGraphql(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseDatabaseDiscover]: (input: PowerhouseDatabaseDiscoverInput) =>
        observeRpcEffect(WS_METHODS.powerhouseDatabaseDiscover, database.discover(input), TRACE),
      [WS_METHODS.powerhouseDatabaseCatalog]: (input: PowerhouseDatabaseCatalogInput) =>
        observeRpcEffect(WS_METHODS.powerhouseDatabaseCatalog, database.catalog(input), TRACE),
      [WS_METHODS.powerhouseDatabaseGetRelation]: (input: PowerhouseDatabaseGetRelationInput) =>
        observeRpcEffect(
          WS_METHODS.powerhouseDatabaseGetRelation,
          database.getRelation(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseDatabasePreviewRelation]: (
        input: PowerhouseDatabasePreviewRelationInput,
      ) =>
        observeRpcEffect(
          WS_METHODS.powerhouseDatabasePreviewRelation,
          database.previewRelation(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseDatabaseExecuteQuery]: (input: PowerhouseDatabaseExecuteQueryInput) =>
        observeRpcEffect(
          WS_METHODS.powerhouseDatabaseExecuteQuery,
          database.executeQuery(input),
          TRACE,
        ),
      [WS_METHODS.powerhouseDatabaseRefreshSnapshot]: (
        input: PowerhouseDatabaseRefreshSnapshotInput,
      ) =>
        observeRpcEffect(
          WS_METHODS.powerhouseDatabaseRefreshSnapshot,
          database.refreshSnapshot(input),
          TRACE,
        ),
    };
  });
