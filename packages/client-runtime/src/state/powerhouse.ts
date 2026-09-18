/**
 * Query atoms for the Powerhouse panel.
 *
 * Inspector reads are plain unary queries behind the shared SWR layer.
 * Switchboard execution and database queries are explicit commands. Reactor
 * subscriptions are not relayed: adding a second streaming protocol over the
 * environment websocket needs a separate transport design.
 */
import { WS_METHODS } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export function createPowerhouseEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const databaseCommandScheduler = createAtomCommandScheduler();
  const databaseTargetConcurrency = {
    mode: "singleFlight" as const,
    key: ({
      environmentId,
      input,
    }: {
      environmentId: string;
      input: { target: string; cwd: string; projectPath?: string | undefined };
    }) => JSON.stringify([environmentId, input.cwd, input.projectPath ?? "", input.target]),
  };
  return {
    // Project layout changes rarely, and this decides whether the panel exists
    // at all, so it is asked for on every thread render.
    projects: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:projects",
      tag: WS_METHODS.powerhouseListProjects,
      staleTimeMs: 60_000,
    }),
    documentModels: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:document-models",
      tag: WS_METHODS.powerhouseListDocumentModels,
    }),
    documentModel: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:document-model",
      tag: WS_METHODS.powerhouseGetDocumentModel,
    }),
    // A reactor comes and goes with a dev server, so a stale connection state
    // is worth re-checking sooner than file data.
    reactorProbe: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:reactor-probe",
      tag: WS_METHODS.powerhouseReactorProbe,
      staleTimeMs: 15_000,
    }),
    reactorDrives: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:reactor-drives",
      tag: WS_METHODS.powerhouseReactorListDrives,
      staleTimeMs: 10_000,
    }),
    reactorDocuments: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:reactor-documents",
      tag: WS_METHODS.powerhouseReactorListDocuments,
      staleTimeMs: 10_000,
    }),
    reactorDocument: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:reactor-document",
      tag: WS_METHODS.powerhouseReactorGetDocument,
      staleTimeMs: 10_000,
    }),
    reactorOperations: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:reactor-operations",
      tag: WS_METHODS.powerhouseReactorGetOperations,
      staleTimeMs: 10_000,
    }),
    reactorExecuteGraphql: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:powerhouse:reactor-execute-graphql",
      tag: WS_METHODS.powerhouseReactorExecuteGraphql,
    }),
    databaseDiscover: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:database-discover",
      tag: WS_METHODS.powerhouseDatabaseDiscover,
    }),
    databaseCatalog: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:database-catalog",
      tag: WS_METHODS.powerhouseDatabaseCatalog,
      staleTimeMs: 60_000,
    }),
    databaseRelation: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:database-relation",
      tag: WS_METHODS.powerhouseDatabaseGetRelation,
      staleTimeMs: 60_000,
    }),
    databasePreview: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:powerhouse:database-preview",
      tag: WS_METHODS.powerhouseDatabasePreviewRelation,
      staleTimeMs: 0,
    }),
    databaseExecute: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:powerhouse:database-execute",
      tag: WS_METHODS.powerhouseDatabaseExecuteQuery,
      scheduler: databaseCommandScheduler,
      concurrency: databaseTargetConcurrency,
    }),
    databaseRefresh: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:powerhouse:database-refresh",
      tag: WS_METHODS.powerhouseDatabaseRefreshSnapshot,
      scheduler: databaseCommandScheduler,
      concurrency: databaseTargetConcurrency,
    }),
  };
}
