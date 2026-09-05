import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  AuthRelayReadScope,
  AuthRelayWriteScope,
  WS_METHODS,
  WsRpcGroup,
} from "@vetra-code/contracts";
import { describe, expect, it } from "@effect/vitest";

import { RPC_REQUIRED_SCOPES, requiredScopeForRpcMethod } from "./RpcAuthorization.ts";

describe("RPC authorization scopes", () => {
  it("declares exactly one scope for every RPC in the server group", () => {
    expect(new Set(Object.keys(RPC_REQUIRED_SCOPES))).toEqual(new Set(WsRpcGroup.requests.keys()));
  });

  it("authorizes background policy reporting and observation deliberately", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportClientActivity)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverReportHostPowerState)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverGetBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.subscribeBackgroundPolicy)).toBe(
      AuthOrchestrationReadScope,
    );
  });

  it("keeps Powerhouse inspectors read-only and Switchboard mutation-capable", () => {
    for (const method of [
      WS_METHODS.powerhouseListProjects,
      WS_METHODS.powerhouseListDocumentModels,
      WS_METHODS.powerhouseGetDocumentModel,
      WS_METHODS.powerhouseReactorProbe,
      WS_METHODS.powerhouseReactorListDrives,
      WS_METHODS.powerhouseReactorListDocuments,
      WS_METHODS.powerhouseReactorGetDocument,
      WS_METHODS.powerhouseReactorGetOperations,
      WS_METHODS.powerhouseDatabaseDiscover,
      WS_METHODS.powerhouseDatabaseCatalog,
      WS_METHODS.powerhouseDatabaseGetRelation,
      WS_METHODS.powerhouseDatabasePreviewRelation,
      WS_METHODS.powerhouseDatabaseExecuteQuery,
      WS_METHODS.powerhouseDatabaseRefreshSnapshot,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationReadScope);
    }
    expect(requiredScopeForRpcMethod(WS_METHODS.powerhouseReactorExecuteGraphql)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("separates subscription usage reads from credential writes", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.serverGetProviderSubscriptionUsage)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(
      requiredScopeForRpcMethod(WS_METHODS.serverGetProviderSubscriptionCredentialStatus),
    ).toBe(AuthOrchestrationReadScope);
    expect(requiredScopeForRpcMethod(WS_METHODS.serverSetProviderSubscriptionCredential)).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.serverClearProviderSubscriptionCredential)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("allows relay status reads without granting relay installation access", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudGetRelayClientStatus)).toBe(
      AuthRelayReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.cloudInstallRelayClient)).toBe(AuthRelayWriteScope);
  });

  it("requires permission to operate on a thread before uploading feedback", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.providerUploadFeedback)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("requires write access to import agent session history", () => {
    expect(requiredScopeForRpcMethod(WS_METHODS.agentSessionsScan)).toBe(
      AuthOrchestrationReadScope,
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.agentSessionsImport)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("reads the reviewer menu under the same scope as the pull request it belongs to", () => {
    // The candidate list is a read like the detail beside it, and asking somebody for a review is
    // a write like every other pull request operation.
    expect(requiredScopeForRpcMethod(WS_METHODS.pullRequestsReviewerCandidates)).toBe(
      requiredScopeForRpcMethod(WS_METHODS.pullRequestsDetail),
    );
    expect(requiredScopeForRpcMethod(WS_METHODS.pullRequestsRequestReviewers)).toBe(
      requiredScopeForRpcMethod(WS_METHODS.pullRequestsComment),
    );
  });

  it("reads the issue assignee menu but requires operate access to change it", () => {
    for (const method of [
      WS_METHODS.issuesList,
      WS_METHODS.issuesDetail,
      WS_METHODS.issuesActivity,
      WS_METHODS.issuesAssigneeCandidates,
      WS_METHODS.issuesInvalidate,
    ]) {
      expect(requiredScopeForRpcMethod(method)).toBe(AuthOrchestrationReadScope);
    }
    expect(requiredScopeForRpcMethod(WS_METHODS.issuesSetAssignees)).toBe(
      AuthOrchestrationOperateScope,
    );
  });

  it("rejects unknown RPC method names", () => {
    for (const method of ["server.notRegistered", "toString", "constructor"]) {
      expect(() => requiredScopeForRpcMethod(method)).toThrow(
        `RPC method ${method} has no declared authorization scope.`,
      );
    }
  });
});
