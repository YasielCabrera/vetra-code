import type { ProviderInstanceId } from "@vetra-code/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { ServerSecretStore } from "../../auth/ServerSecretStore.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const secretName = (instanceId: ProviderInstanceId) => `provider-subscription-usage-${instanceId}`;

export class ProviderSubscriptionCredentialStoreError extends Data.TaggedError(
  "ProviderSubscriptionCredentialStoreError",
)<{
  readonly operation: "read" | "write" | "clear" | "fingerprint";
}> {}

export interface ProviderSubscriptionCredentialStoreShape {
  readonly get: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<Option.Option<string>, ProviderSubscriptionCredentialStoreError>;
  readonly has: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<boolean, ProviderSubscriptionCredentialStoreError>;
  readonly set: (
    instanceId: ProviderInstanceId,
    secret: string,
  ) => Effect.Effect<void, ProviderSubscriptionCredentialStoreError>;
  readonly clear: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<void, ProviderSubscriptionCredentialStoreError>;
  /** A one-way value suitable for cache keys. The credential itself never leaves this module. */
  readonly fingerprint: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<string, ProviderSubscriptionCredentialStoreError>;
}

const unavailable = (operation: ProviderSubscriptionCredentialStoreError["operation"]) =>
  Effect.fail(new ProviderSubscriptionCredentialStoreError({ operation }));

/**
 * Drivers only read this reference while materializing an optional capability.
 * The no-op default keeps provider construction independently testable; the
 * production runtime overrides it with the encrypted ServerSecretStore layer.
 */
export class ProviderSubscriptionCredentialStore extends Context.Reference<ProviderSubscriptionCredentialStoreShape>(
  "@vetra-code/server/provider/usage/ProviderSubscriptionCredentialStore",
  {
    defaultValue: () => ({
      get: () => Effect.succeed(Option.none()),
      has: () => Effect.succeed(false),
      set: () => unavailable("write"),
      clear: () => unavailable("clear"),
      fingerprint: () => Effect.succeed("automatic"),
    }),
  },
) {}

export const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore;
  const crypto = yield* Crypto.Crypto;

  const get = (instanceId: ProviderInstanceId) =>
    secrets.get(secretName(instanceId)).pipe(
      Effect.map(Option.map((bytes) => decoder.decode(bytes).trim())),
      Effect.map(Option.filter((value) => value.length > 0)),
      Effect.mapError(() => new ProviderSubscriptionCredentialStoreError({ operation: "read" })),
    );

  const fingerprint = (instanceId: ProviderInstanceId) =>
    get(instanceId).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed("automatic"),
          onSome: (secret) =>
            crypto.digest("SHA-256", encoder.encode(secret)).pipe(
              Effect.map(Encoding.encodeHex),
              Effect.map((digest) => `manual:${digest}`),
              Effect.mapError(
                () =>
                  new ProviderSubscriptionCredentialStoreError({
                    operation: "fingerprint",
                  }),
              ),
            ),
        }),
      ),
    );

  return {
    get,
    has: (instanceId) => get(instanceId).pipe(Effect.map(Option.isSome)),
    set: (instanceId, secret) =>
      secrets
        .set(secretName(instanceId), encoder.encode(secret.trim()))
        .pipe(
          Effect.mapError(
            () => new ProviderSubscriptionCredentialStoreError({ operation: "write" }),
          ),
        ),
    clear: (instanceId) =>
      secrets
        .remove(secretName(instanceId))
        .pipe(
          Effect.mapError(
            () => new ProviderSubscriptionCredentialStoreError({ operation: "clear" }),
          ),
        ),
    fingerprint,
  } satisfies ProviderSubscriptionCredentialStoreShape;
});

export const layer = Layer.effect(ProviderSubscriptionCredentialStore, make);
