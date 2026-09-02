import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  hasDeployChanges,
  missingRelayPublicConfigFields,
  publicConfigFromOutput,
  reconcileRootEnvPublicConfig,
  RelayDeployError,
  RelayDeployPublicConfigUnavailableError,
  serializeGithubOutput,
  serializeRelayClientTracingEnvironment,
} from "./deploy.ts";

describe("RelayDeployError", () => {
  it("reports the incomplete state source, stage, and missing fields", () => {
    const missingFields = missingRelayPublicConfigFields({
      url: "https://relay.example.test",
      mobileTracingUrl: "https://api.axiom.co/v1/traces",
    });
    const error = new RelayDeployError({
      source: "alchemy_state",
      stage: "production",
      missingFields,
    });

    expect(error).toMatchObject({
      source: "alchemy_state",
      stage: "production",
      missingFields: [
        "mobileTracingDataset",
        "mobileTracingToken",
        "clientTracingUrl",
        "clientTracingDataset",
        "clientTracingToken",
      ],
    });
    expect(error.message).toBe(
      "Relay deploy output from 'alchemy_state' for stage 'production' is missing required public config fields: mobileTracingDataset, mobileTracingToken, clientTracingUrl, clientTracingDataset, clientTracingToken",
    );
  });

  it("distinguishes deploy results that do not produce public config", () => {
    const error = new RelayDeployPublicConfigUnavailableError({
      result: "dry-run",
      stage: "production",
      outputPath: "/tmp/relay-client.env",
    });

    expect(error.message).toBe(
      "Relay deploy result 'dry-run' for stage 'production' did not produce public config required by GitHub environment output '/tmp/relay-client.env'.",
    );
  });
});

describe("hasDeployChanges", () => {
  it("detects resource, binding, and deletion changes", () => {
    expect(hasDeployChanges({ resources: {}, deletions: {} } as never)).toBe(false);
    expect(
      hasDeployChanges({
        resources: {
          api: { action: "create", bindings: [] },
        },
        deletions: {},
      } as never),
    ).toBe(true);
    expect(
      hasDeployChanges({
        resources: {
          api: { action: "noop", bindings: [{ action: "update" }] },
        },
        deletions: {},
      } as never),
    ).toBe(true);
    expect(
      hasDeployChanges({
        resources: {},
        deletions: {
          api: { action: "delete", bindings: [] },
        },
      } as never),
    ).toBe(true);
  });
});

describe("reconcileRootEnvPublicConfig", () => {
  const config = {
    relayUrl: "https://relay.example.test",
    mobileTracingUrl: "https://api.axiom.co/v1/traces",
    mobileTracingDataset: "vetra-code-mobile-traces-dev",
    mobileTracingToken: "xaat-public-ingest",
    clientTracingUrl: "https://api.axiom.co/v1/traces",
    clientTracingDataset: "vetra-code-relay-client-traces-dev",
    clientTracingToken: "xaat-relay-client-ingest",
  } as const;

  it("adds the complete local client config", () => {
    expect(reconcileRootEnvPublicConfig("", config)).toBe(
      [
        "VETRA_RELAY_URL=https://relay.example.test",
        "VETRA_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VETRA_MOBILE_OTLP_TRACES_DATASET=vetra-code-mobile-traces-dev",
        "VETRA_MOBILE_OTLP_TRACES_TOKEN=xaat-public-ingest",
        "VETRA_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VETRA_RELAY_CLIENT_OTLP_TRACES_DATASET=vetra-code-relay-client-traces-dev",
        "VETRA_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-relay-client-ingest",
        "",
      ].join("\n"),
    );
  });

  it("replaces stale values while preserving unrelated entries", () => {
    expect(
      reconcileRootEnvPublicConfig(
        [
          "VETRA_CLERK_PUBLISHABLE_KEY=pk_test_example",
          "VETRA_RELAY_URL=https://old.example.test",
          "VETRA_MOBILE_OTLP_TRACES_URL=https://old.example.test/v1/traces",
          "VETRA_MOBILE_OTLP_TRACES_DATASET=old-dataset",
          "VETRA_MOBILE_OTLP_TRACES_TOKEN=old-token",
          "VETRA_RELAY_CLIENT_OTLP_TRACES_URL=https://old.example.test/v1/traces",
          "VETRA_RELAY_CLIENT_OTLP_TRACES_DATASET=old-client-dataset",
          "VETRA_RELAY_CLIENT_OTLP_TRACES_TOKEN=old-client-token",
          "",
        ].join("\n"),
        config,
      ),
    ).toBe(
      [
        "VETRA_CLERK_PUBLISHABLE_KEY=pk_test_example",
        "VETRA_RELAY_URL=https://relay.example.test",
        "VETRA_MOBILE_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VETRA_MOBILE_OTLP_TRACES_DATASET=vetra-code-mobile-traces-dev",
        "VETRA_MOBILE_OTLP_TRACES_TOKEN=xaat-public-ingest",
        "VETRA_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VETRA_RELAY_CLIENT_OTLP_TRACES_DATASET=vetra-code-relay-client-traces-dev",
        "VETRA_RELAY_CLIENT_OTLP_TRACES_TOKEN=xaat-relay-client-ingest",
        "",
      ].join("\n"),
    );
  });
});

describe("serializeGithubOutput", () => {
  it("serializes relay deploy metadata for GitHub Actions outputs", () => {
    expect(
      serializeGithubOutput({
        changed: false,
        result: "noop",
        relay_url: "https://relay.example.test",
      }),
    ).toBe("changed=false\nresult=noop\nrelay_url=https://relay.example.test\n");
  });
});

describe("serializeRelayClientTracingEnvironment", () => {
  it("serializes tracing config for downstream GITHUB_ENV loading", () => {
    expect(
      serializeRelayClientTracingEnvironment({
        relayUrl: "https://relay.example.test",
        mobileTracingUrl: "https://api.axiom.co/v1/traces",
        mobileTracingDataset: "mobile",
        mobileTracingToken: "mobile-token",
        clientTracingUrl: "https://api.axiom.co/v1/traces",
        clientTracingDataset: "relay",
        clientTracingToken: "client-token",
      }),
    ).toBe(
      [
        "VETRA_RELAY_CLIENT_OTLP_TRACES_URL=https://api.axiom.co/v1/traces",
        "VETRA_RELAY_CLIENT_OTLP_TRACES_DATASET=relay",
        "VETRA_RELAY_CLIENT_OTLP_TRACES_TOKEN=client-token",
        "",
      ].join("\n"),
    );
  });
});

describe("publicConfigFromOutput", () => {
  it("reads the complete public tracing config from persisted Alchemy output", () => {
    expect(
      publicConfigFromOutput({
        url: "https://relay.example.test",
        mobileTracingUrl: "https://api.axiom.co/v1/traces",
        mobileTracingDataset: "mobile",
        mobileTracingToken: "mobile-token",
        clientTracingUrl: "https://api.axiom.co/v1/traces",
        clientTracingDataset: "relay",
        clientTracingToken: "client-token",
      }),
    ).toEqual({
      relayUrl: "https://relay.example.test",
      mobileTracingUrl: "https://api.axiom.co/v1/traces",
      mobileTracingDataset: "mobile",
      mobileTracingToken: "mobile-token",
      clientTracingUrl: "https://api.axiom.co/v1/traces",
      clientTracingDataset: "relay",
      clientTracingToken: "client-token",
    });
  });

  it("rejects incomplete stack output", () => {
    expect(publicConfigFromOutput({ url: "https://relay.example.test" })).toBeNull();
  });
});
