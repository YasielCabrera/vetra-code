/**
 * Query atoms for the Powerhouse panel.
 *
 * Everything here is a plain unary query behind the shared SWR layer — no
 * subscriptions. The reactor can push document changes, but relaying them
 * reactor→server→client websocket would multiply traffic for a read-only
 * diagnostic surface; refresh-on-demand is honest and cheap.
 */
import { WS_METHODS } from "@vetra-code/contracts";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcQueryAtomFamily } from "./runtime.ts";

export function createPowerhouseEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
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
  };
}
