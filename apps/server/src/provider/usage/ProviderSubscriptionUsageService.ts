import {
  PROVIDER_SUBSCRIPTION_USAGE_CONTRACT_VERSION,
  ProviderSubscriptionUsageError,
  type ProviderInstanceId,
  type ProviderSubscriptionCredentialStatus,
  type ProviderSubscriptionUsageInstanceResult,
  type ProviderSubscriptionUsageReadInput,
  type ProviderSubscriptionUsageReport,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";

import type { ProviderInstance } from "../ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import { ProviderSubscriptionCredentialStore } from "./ProviderSubscriptionCredentialStore.ts";

const HEALTHY_TTL_MS = 5 * 60_000;
const DEGRADED_TTL_MS = 60_000;
const MAX_CONCURRENT_PROBES = 3;

interface CachedResult {
  readonly fingerprint: string;
  readonly result: ProviderSubscriptionUsageInstanceResult;
  readonly expiresAt: number;
  readonly lastGood?: Extract<ProviderSubscriptionUsageInstanceResult, { readonly state: "ready" }>;
}

interface InFlight {
  readonly deferred: Deferred.Deferred<ProviderSubscriptionUsageInstanceResult>;
}

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

const credentialRequirement = (driver: string) => {
  if (driver === "cursor") return "optional" as const;
  if (driver === "opencode") return "required" as const;
  return "none" as const;
};

const credentialDetail = (driver: string, configured: boolean): string => {
  if (driver === "cursor") {
    return configured
      ? "A saved Cookie header overrides automatic Cursor app discovery."
      : "Vetra first uses the Cursor app session; a Cookie header is an optional fallback.";
  }
  if (driver === "opencode") {
    return configured
      ? "An OpenCode Go Cookie header is saved for this instance."
      : "OpenCode Go subscription limits require a Cookie header from opencode.ai.";
  }
  return "This provider uses its own configured authentication and does not accept a quota credential.";
};

const errorResult = (
  instance: Pick<ProviderInstance, "instanceId" | "driverKind" | "displayName">,
  message: string,
): ProviderSubscriptionUsageInstanceResult => ({
  instanceId: instance.instanceId,
  driver: instance.driverKind,
  displayName: instance.displayName ?? instance.driverKind,
  state: "error",
  message,
  windows: [],
  details: [],
});

const accountIdentityMismatch = (
  providerAccount: string | undefined,
  runtimeEmail: string | undefined,
): boolean => {
  if (!providerAccount || !runtimeEmail) return false;
  if (!providerAccount.includes("@")) return false;
  return providerAccount.trim().toLowerCase() !== runtimeEmail.trim().toLowerCase();
};

export interface ProviderSubscriptionUsageServiceShape {
  readonly read: (
    input: ProviderSubscriptionUsageReadInput,
  ) => Effect.Effect<ProviderSubscriptionUsageReport>;
  readonly getCredentialStatus: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderSubscriptionCredentialStatus, ProviderSubscriptionUsageError>;
  readonly setCredential: (
    instanceId: ProviderInstanceId,
    secret: string,
  ) => Effect.Effect<ProviderSubscriptionCredentialStatus, ProviderSubscriptionUsageError>;
  readonly clearCredential: (
    instanceId: ProviderInstanceId,
  ) => Effect.Effect<ProviderSubscriptionCredentialStatus, ProviderSubscriptionUsageError>;
  readonly invalidate: (instanceId: ProviderInstanceId) => Effect.Effect<void>;
}

const unavailableServiceError = () =>
  new ProviderSubscriptionUsageError({
    reason: "unsupported",
    detail: "Provider subscription usage is not available in this server runtime.",
  });

/** The default keeps partial RPC test runtimes backwards-compatible. Production overrides it. */
export class ProviderSubscriptionUsageService extends Context.Reference<ProviderSubscriptionUsageServiceShape>(
  "t3/provider/usage/ProviderSubscriptionUsageService",
  {
    defaultValue: () => ({
      read: () =>
        DateTime.now.pipe(
          Effect.map((readAt) => ({
            contractVersion: PROVIDER_SUBSCRIPTION_USAGE_CONTRACT_VERSION,
            readAt: DateTime.formatIso(readAt),
            instances: [],
          })),
        ),
      getCredentialStatus: () => Effect.fail(unavailableServiceError()),
      setCredential: () => Effect.fail(unavailableServiceError()),
      clearCredential: () => Effect.fail(unavailableServiceError()),
      invalidate: () => Effect.void,
    }),
  },
) {}

export const make = Effect.gen(function* () {
  const registry = yield* ProviderInstanceRegistry;
  const credentials = yield* ProviderSubscriptionCredentialStore;
  const cache = yield* Ref.make(new Map<ProviderInstanceId, CachedResult>());
  const latestFingerprints = yield* Ref.make(new Map<ProviderInstanceId, string>());
  const inFlight = yield* Ref.make(new Map<string, InFlight>());
  const acquisitionLock = yield* Semaphore.make(1);

  const invalidate = (instanceId: ProviderInstanceId) =>
    acquisitionLock.withPermits(1)(
      Effect.all([
        Ref.update(cache, (entries) => {
          const next = new Map(entries);
          next.delete(instanceId);
          return next;
        }),
        Ref.update(latestFingerprints, (entries) => {
          const next = new Map(entries);
          next.delete(instanceId);
          return next;
        }),
      ]).pipe(Effect.asVoid),
    );

  const cacheIfCurrent = (
    instanceId: ProviderInstanceId,
    fingerprint: string,
    result: CachedResult,
  ) =>
    acquisitionLock.withPermits(1)(
      Effect.gen(function* () {
        const latest = (yield* Ref.get(latestFingerprints)).get(instanceId);
        if (latest !== fingerprint) return;
        yield* Ref.update(cache, (entries) => {
          const next = new Map(entries);
          next.set(instanceId, result);
          return next;
        });
      }),
    );

  const resolveDriver = (instanceId: ProviderInstanceId) =>
    Effect.gen(function* () {
      const instance = yield* registry.getInstance(instanceId);
      if (instance) return instance.driverKind;
      const unavailable = yield* registry.listUnavailable;
      return unavailable.find((candidate) => candidate.instanceId === instanceId)?.driver;
    });

  const getCredentialStatus = (
    instanceId: ProviderInstanceId,
  ): Effect.Effect<ProviderSubscriptionCredentialStatus, ProviderSubscriptionUsageError> =>
    Effect.gen(function* () {
      const driver = yield* resolveDriver(instanceId);
      if (!driver) {
        return yield* new ProviderSubscriptionUsageError({
          reason: "unknown-instance",
          detail: "The provider instance no longer exists.",
        });
      }
      const configured = yield* credentials.has(instanceId).pipe(
        Effect.mapError(
          () =>
            new ProviderSubscriptionUsageError({
              reason: "read-failed",
              detail: "The saved provider credential could not be inspected.",
            }),
        ),
      );
      return {
        instanceId,
        driver,
        requirement: credentialRequirement(driver),
        configured,
        detail: credentialDetail(driver, configured),
      };
    });

  const setCredential = (
    instanceId: ProviderInstanceId,
    secret: string,
  ): Effect.Effect<ProviderSubscriptionCredentialStatus, ProviderSubscriptionUsageError> =>
    Effect.gen(function* () {
      const status = yield* getCredentialStatus(instanceId);
      if (status.requirement === "none") {
        return yield* new ProviderSubscriptionUsageError({
          reason: "unsupported",
          detail: "This provider does not accept a manual subscription credential.",
        });
      }
      const normalized = secret.trim();
      if (normalized.length === 0) {
        return yield* new ProviderSubscriptionUsageError({
          reason: "invalid-credential",
          detail: "The Cookie header cannot be empty.",
        });
      }
      yield* credentials.set(instanceId, normalized).pipe(
        Effect.mapError(
          () =>
            new ProviderSubscriptionUsageError({
              reason: "write-failed",
              detail: "The provider credential could not be saved.",
            }),
        ),
      );
      yield* invalidate(instanceId);
      return yield* getCredentialStatus(instanceId);
    });

  const clearCredential = (
    instanceId: ProviderInstanceId,
  ): Effect.Effect<ProviderSubscriptionCredentialStatus, ProviderSubscriptionUsageError> =>
    Effect.gen(function* () {
      yield* getCredentialStatus(instanceId);
      yield* credentials.clear(instanceId).pipe(
        Effect.mapError(
          () =>
            new ProviderSubscriptionUsageError({
              reason: "write-failed",
              detail: "The provider credential could not be cleared.",
            }),
        ),
      );
      yield* invalidate(instanceId);
      return yield* getCredentialStatus(instanceId);
    });

  const probe = (instance: ProviderInstance, fingerprint: string) =>
    Effect.gen(function* () {
      if (!instance.subscriptionUsage) {
        return {
          instanceId: instance.instanceId,
          driver: instance.driverKind,
          displayName: instance.displayName ?? instance.driverKind,
          state: "unsupported" as const,
          message: "Subscription limits are not supported by this provider driver.",
          windows: [],
          details: [],
        } satisfies ProviderSubscriptionUsageInstanceResult;
      }

      const probed = yield* instance.subscriptionUsage.read;
      let result = probed.result;
      if (result.state === "ready" && result.accountLabel) {
        const runtime = yield* instance.snapshot.getSnapshot;
        if (accountIdentityMismatch(result.accountLabel, runtime.auth.email)) {
          result = {
            instanceId: instance.instanceId,
            driver: instance.driverKind,
            displayName: instance.displayName ?? instance.driverKind,
            state: "needs-auth",
            message: "The quota account does not match the account used by this provider instance.",
            windows: [],
            details: [],
          };
        }
      }

      const now = yield* Clock.currentTimeMillis;
      const previous = (yield* Ref.get(cache)).get(instance.instanceId);
      const sameIdentity = previous?.fingerprint === fingerprint;
      if (
        result.state === "error" &&
        probed.transient === true &&
        sameIdentity &&
        previous?.lastGood
      ) {
        const lastGood = previous.lastGood;
        const stale: ProviderSubscriptionUsageInstanceResult = {
          ...lastGood,
          freshness: "stale",
          message:
            result.message ?? "The provider could not be refreshed; showing last known data.",
        };
        yield* cacheIfCurrent(instance.instanceId, fingerprint, {
          fingerprint,
          result: stale,
          lastGood,
          expiresAt: now + DEGRADED_TTL_MS,
        });
        return stale;
      }

      const normalized =
        result.state === "ready" ? { ...result, freshness: "fresh" as const } : result;
      yield* cacheIfCurrent(instance.instanceId, fingerprint, {
        fingerprint,
        result: normalized,
        ...(normalized.state === "ready" ? { lastGood: normalized } : {}),
        expiresAt: now + (normalized.state === "ready" ? HEALTHY_TTL_MS : DEGRADED_TTL_MS),
      });
      return normalized;
    });

  const readOne = (instance: ProviderInstance, forceRefresh: boolean) =>
    Effect.gen(function* () {
      const fingerprint = instance.subscriptionUsage
        ? yield* instance.subscriptionUsage.fingerprint
        : `unsupported:${instance.driverKind}`;
      const flightKey = `${instance.instanceId}\u0000${fingerprint}`;
      yield* acquisitionLock.withPermits(1)(
        Ref.update(latestFingerprints, (entries) => {
          const next = new Map(entries);
          next.set(instance.instanceId, fingerprint);
          return next;
        }),
      );
      const now = yield* Clock.currentTimeMillis;
      const cached = (yield* Ref.get(cache)).get(instance.instanceId);
      if (!forceRefresh && cached && cached.fingerprint === fingerprint && cached.expiresAt > now) {
        return cached.result;
      }

      const acquired = yield* acquisitionLock.withPermits(1)(
        Effect.gen(function* () {
          const running = (yield* Ref.get(inFlight)).get(flightKey);
          if (running) return { leader: false as const, deferred: running.deferred };
          const deferred = yield* Deferred.make<ProviderSubscriptionUsageInstanceResult>();
          yield* Ref.update(inFlight, (entries) => {
            const next = new Map(entries);
            next.set(flightKey, { deferred });
            return next;
          });
          return { leader: true as const, deferred };
        }),
      );

      if (!acquired.leader) return yield* Deferred.await(acquired.deferred);

      const failedResult = errorResult(
        instance,
        "The provider subscription limits could not be read.",
      );
      return yield* probe(instance, fingerprint).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          return Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            yield* cacheIfCurrent(instance.instanceId, fingerprint, {
              fingerprint,
              result: failedResult,
              expiresAt: now + DEGRADED_TTL_MS,
            });
            return failedResult;
          });
        }),
        Effect.tap((result) => Deferred.succeed(acquired.deferred, result)),
        Effect.onInterrupt(() =>
          Deferred.succeed(acquired.deferred, failedResult).pipe(Effect.asVoid),
        ),
        Effect.ensuring(
          Ref.update(inFlight, (entries) => {
            const next = new Map(entries);
            next.delete(flightKey);
            return next;
          }),
        ),
      );
    });

  const read = (input: ProviderSubscriptionUsageReadInput) =>
    Effect.gen(function* () {
      const instances = (yield* registry.listInstances).filter((instance) => instance.enabled);
      const unavailable = (yield* registry.listUnavailable).filter((instance) => instance.enabled);
      const liveIds = new Set(instances.map((instance) => instance.instanceId));
      yield* acquisitionLock.withPermits(1)(
        Effect.all([
          Ref.update(cache, (entries) => {
            const next = new Map(entries);
            for (const id of next.keys()) if (!liveIds.has(id)) next.delete(id);
            return next;
          }),
          Ref.update(latestFingerprints, (entries) => {
            const next = new Map(entries);
            for (const id of next.keys()) if (!liveIds.has(id)) next.delete(id);
            return next;
          }),
        ]).pipe(Effect.asVoid),
      );

      const liveResults = yield* Effect.forEach(
        instances,
        (instance) =>
          readOne(instance, input.forceRefresh === true).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.interrupt
                : Effect.succeed(
                    errorResult(instance, "The provider subscription limits could not be read."),
                  ),
            ),
          ),
        { concurrency: MAX_CONCURRENT_PROBES },
      );
      const unavailableResults = unavailable.map(
        (instance): ProviderSubscriptionUsageInstanceResult => ({
          instanceId: instance.instanceId,
          driver: instance.driver,
          displayName: instance.displayName ?? instance.driver,
          state: "error",
          message: instance.unavailableReason ?? "This provider instance is unavailable.",
          windows: [],
          details: [],
        }),
      );
      return {
        contractVersion: PROVIDER_SUBSCRIPTION_USAGE_CONTRACT_VERSION,
        readAt: yield* nowIso,
        instances: [...liveResults, ...unavailableResults],
      } satisfies ProviderSubscriptionUsageReport;
    });

  // Remove instance-scoped quota secrets and cache entries when the registry
  // confirms an instance was deleted. Rebuilds retain the same id and secret.
  const initialInstances = yield* registry.listInstances;
  const initialUnavailable = yield* registry.listUnavailable;
  const knownIds = yield* Ref.make(
    new Set([
      ...initialInstances.map((instance) => instance.instanceId),
      ...initialUnavailable.map((instance) => instance.instanceId),
    ]),
  );
  const subscription = yield* registry.subscribeChanges;
  yield* Effect.forever(
    PubSub.take(subscription).pipe(
      Effect.flatMap(() =>
        Effect.gen(function* () {
          const currentInstances = yield* registry.listInstances;
          const currentUnavailable = yield* registry.listUnavailable;
          const current = new Set([
            ...currentInstances.map((instance) => instance.instanceId),
            ...currentUnavailable.map((instance) => instance.instanceId),
          ]);
          const previous = yield* Ref.getAndSet(knownIds, current);
          // Any retained id may have been rebuilt with new provider settings.
          // Invalidate all probe state before an older in-flight read can write
          // back quota data for that prior materialization.
          yield* acquisitionLock.withPermits(1)(
            Effect.all([Ref.set(cache, new Map()), Ref.set(latestFingerprints, new Map())]).pipe(
              Effect.asVoid,
            ),
          );
          for (const instanceId of previous) {
            if (current.has(instanceId)) continue;
            yield* credentials.clear(instanceId).pipe(Effect.ignore);
          }
        }),
      ),
    ),
  ).pipe(Effect.forkScoped);

  return {
    read,
    getCredentialStatus,
    setCredential,
    clearCredential,
    invalidate,
  } satisfies ProviderSubscriptionUsageServiceShape;
});

export const layer = Layer.effect(ProviderSubscriptionUsageService, make);
