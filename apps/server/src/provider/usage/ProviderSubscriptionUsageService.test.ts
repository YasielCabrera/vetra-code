import { it } from "@effect/vitest";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderSubscriptionUsageInstanceResult,
} from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { describe, expect } from "vite-plus/test";

import type { ProviderInstance, ProviderSubscriptionUsageProbe } from "../ProviderDriver.ts";
import { ProviderInstanceRegistry } from "../Services/ProviderInstanceRegistry.ts";
import {
  ProviderSubscriptionCredentialStore,
  type ProviderSubscriptionCredentialStoreShape,
} from "./ProviderSubscriptionCredentialStore.ts";
import { make } from "./ProviderSubscriptionUsageService.ts";
import { settledProbe } from "./providerSubscriptionUsageHelpers.ts";

const instanceId = (value: string) => ProviderInstanceId.make(value);

const readyResult = (
  id: string,
  usedPercent: number,
  accountLabel?: string,
): ProviderSubscriptionUsageInstanceResult => ({
  instanceId: instanceId(id),
  driver: ProviderDriverKind.make("codex"),
  displayName: id,
  state: "ready",
  freshness: "fresh",
  fetchedAt: "2026-08-13T12:00:00.000Z",
  source: "provider-cli",
  ...(accountLabel ? { accountLabel } : {}),
  windows: [{ id: "weekly", label: "Weekly", usedPercent }],
  details: [],
});

const errorResult = (id: string): ProviderSubscriptionUsageInstanceResult => ({
  instanceId: instanceId(id),
  driver: ProviderDriverKind.make("codex"),
  displayName: id,
  state: "error",
  message: "Provider temporarily unavailable.",
  windows: [],
  details: [],
});

const readyProbe = (
  id: string,
  usedPercent: number,
  accountLabel?: string,
): ProviderSubscriptionUsageProbe => settledProbe(readyResult(id, usedPercent, accountLabel));

const errorProbe = (id: string): ProviderSubscriptionUsageProbe => settledProbe(errorResult(id));

const makeInstance = (input: {
  readonly id: string;
  readonly driver?: ProviderInstance["driverKind"];
  readonly fingerprint?: Effect.Effect<string>;
  readonly read: Effect.Effect<ProviderSubscriptionUsageProbe>;
  readonly runtimeEmail?: string;
}): ProviderInstance =>
  ({
    instanceId: instanceId(input.id),
    driverKind: input.driver ?? ProviderDriverKind.make("codex"),
    continuationIdentity: {
      driverKind: input.driver ?? ProviderDriverKind.make("codex"),
      continuationKey: `${input.driver ?? "codex"}:${input.id}`,
    },
    displayName: input.id,
    enabled: true,
    snapshot: {
      getSnapshot: Effect.succeed({
        auth: { email: input.runtimeEmail },
      } as never),
    } as unknown as ProviderInstance["snapshot"],
    adapter: {} as ProviderInstance["adapter"],
    textGeneration: {} as ProviderInstance["textGeneration"],
    subscriptionUsage: {
      fingerprint: input.fingerprint ?? Effect.succeed(`fingerprint:${input.id}`),
      read: input.read,
    },
  }) satisfies ProviderInstance;

const makeCredentialStore = (cleared: string[] = []): ProviderSubscriptionCredentialStoreShape => ({
  get: () => Effect.succeed(Option.none()),
  has: () => Effect.succeed(false),
  set: () => Effect.void,
  clear: (id) => Effect.sync(() => void cleared.push(id)),
  fingerprint: () => Effect.succeed("automatic"),
});

const makeRegistryHarness = Effect.gen(function* () {
  const instances = yield* Ref.make<ReadonlyArray<ProviderInstance>>([]);
  const changes = yield* PubSub.unbounded<void>();
  const registry: ProviderInstanceRegistry["Service"] = {
    getInstance: (id) =>
      Ref.get(instances).pipe(
        Effect.map((entries) => entries.find((entry) => entry.instanceId === id)),
      ),
    listInstances: Ref.get(instances),
    listUnavailable: Effect.succeed([]),
    streamChanges: Stream.fromPubSub(changes),
    subscribeChanges: PubSub.subscribe(changes),
  };
  return { instances, changes, registry };
});

const makeService = (
  registry: ProviderInstanceRegistry["Service"],
  credentials: ProviderSubscriptionCredentialStoreShape = makeCredentialStore(),
) =>
  make.pipe(
    Effect.provideService(ProviderInstanceRegistry, registry),
    Effect.provideService(ProviderSubscriptionCredentialStore, credentials),
  );

describe("ProviderSubscriptionUsageService", () => {
  it.effect("keeps same-kind instances isolated and honors healthy TTL and force refresh", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        const personalCalls = yield* Ref.make(0);
        const workCalls = yield* Ref.make(0);
        yield* Ref.set(harness.instances, [
          makeInstance({
            id: "codex_personal",
            read: Ref.updateAndGet(personalCalls, (value) => value + 1).pipe(
              Effect.map((call) => readyProbe("codex_personal", call * 10)),
            ),
          }),
          makeInstance({
            id: "codex_work",
            read: Ref.updateAndGet(workCalls, (value) => value + 1).pipe(
              Effect.map((call) => readyProbe("codex_work", call * 20)),
            ),
          }),
        ]);
        const service = yield* makeService(harness.registry);

        const first = yield* service.read({});
        expect(first.instances.map((entry) => entry.instanceId)).toEqual([
          "codex_personal",
          "codex_work",
        ]);
        expect(first.instances.map((entry) => entry.windows[0]?.usedPercent)).toEqual([10, 20]);

        yield* service.read({});
        expect(yield* Ref.get(personalCalls)).toBe(1);
        expect(yield* Ref.get(workCalls)).toBe(1);

        yield* TestClock.adjust(299_000);
        yield* service.read({});
        expect(yield* Ref.get(personalCalls)).toBe(1);

        yield* TestClock.adjust("1 second");
        yield* service.read({});
        expect(yield* Ref.get(personalCalls)).toBe(2);
        expect(yield* Ref.get(workCalls)).toBe(2);

        yield* service.read({ forceRefresh: true });
        expect(yield* Ref.get(personalCalls)).toBe(3);
        expect(yield* Ref.get(workCalls)).toBe(3);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("joins concurrent force refreshes per instance", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        const calls = yield* Ref.make(0);
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        yield* Ref.set(harness.instances, [
          makeInstance({
            id: "codex_personal",
            read: Effect.gen(function* () {
              yield* Ref.update(calls, (value) => value + 1);
              yield* Deferred.succeed(started, undefined);
              yield* Deferred.await(release);
              return readyProbe("codex_personal", 42);
            }),
          }),
        ]);
        const service = yield* makeService(harness.registry);

        const first = yield* service.read({ forceRefresh: true }).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        const second = yield* service.read({ forceRefresh: true }).pipe(Effect.forkScoped);
        yield* Effect.yieldNow;
        expect(yield* Ref.get(calls)).toBe(1);
        yield* Deferred.succeed(release, undefined);

        const [firstReport, secondReport] = yield* Effect.all([
          Fiber.join(first),
          Fiber.join(second),
        ]);
        expect(firstReport.instances[0]?.windows[0]?.usedPercent).toBe(42);
        expect(secondReport.instances[0]?.windows[0]?.usedPercent).toBe(42);
        expect(yield* Ref.get(calls)).toBe(1);
      }),
    ),
  );

  it.effect("does not join an in-flight probe after the instance fingerprint changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        const oldStarted = yield* Deferred.make<void>();
        const newStarted = yield* Deferred.make<void>();
        const releaseOld = yield* Deferred.make<void>();
        const releaseNew = yield* Deferred.make<void>();
        const newCalls = yield* Ref.make(0);
        const oldInstance = makeInstance({
          id: "codex_work",
          fingerprint: Effect.succeed("account-a"),
          read: Deferred.succeed(oldStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseOld)),
            Effect.as(readyProbe("codex_work", 10)),
          ),
        });
        const newInstance = makeInstance({
          id: "codex_work",
          fingerprint: Effect.succeed("account-b"),
          read: Ref.update(newCalls, (value) => value + 1).pipe(
            Effect.andThen(Deferred.succeed(newStarted, undefined)),
            Effect.andThen(Deferred.await(releaseNew)),
            Effect.as(readyProbe("codex_work", 20)),
          ),
        });
        yield* Ref.set(harness.instances, [oldInstance]);
        const service = yield* makeService(harness.registry);

        const oldRead = yield* service.read({ forceRefresh: true }).pipe(Effect.forkScoped);
        yield* Deferred.await(oldStarted);
        yield* Ref.set(harness.instances, [newInstance]);
        const newRead = yield* service.read({ forceRefresh: true }).pipe(Effect.forkScoped);
        yield* Deferred.await(newStarted);

        yield* Deferred.succeed(releaseNew, undefined);
        const newReport = yield* Fiber.join(newRead);
        expect(newReport.instances[0]?.windows[0]?.usedPercent).toBe(20);

        yield* Deferred.succeed(releaseOld, undefined);
        const oldReport = yield* Fiber.join(oldRead);
        expect(oldReport.instances[0]?.windows[0]?.usedPercent).toBe(10);

        const cachedNewAccount = yield* service.read({});
        expect(cachedNewAccount.instances[0]?.windows[0]?.usedPercent).toBe(20);
        expect(yield* Ref.get(newCalls)).toBe(1);
      }),
    ),
  );

  it.effect("invalidates cached usage when a retained instance is rebuilt", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        const calls = yield* Ref.make(0);
        const instance = makeInstance({
          id: "codex_work",
          read: Ref.updateAndGet(calls, (value) => value + 1).pipe(
            Effect.map((call) => readyProbe("codex_work", call * 10)),
          ),
        });
        yield* Ref.set(harness.instances, [instance]);
        const service = yield* makeService(harness.registry);

        expect((yield* service.read({})).instances[0]?.windows[0]?.usedPercent).toBe(10);
        yield* PubSub.publish(harness.changes, undefined);
        yield* Effect.yieldNow;
        expect((yield* service.read({})).instances[0]?.windows[0]?.usedPercent).toBe(20);
      }),
    ),
  );

  it.effect("caps provider probes at three while settling every instance", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        const active = yield* Ref.make(0);
        const maximum = yield* Ref.make(0);
        const reachedLimit = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const instances = Array.from({ length: 5 }, (_, index) => {
          const id = `codex_${index + 1}`;
          return makeInstance({
            id,
            read: Effect.gen(function* () {
              const count = yield* Ref.updateAndGet(active, (value) => value + 1);
              yield* Ref.update(maximum, (value) => Math.max(value, count));
              if (count === 3) yield* Deferred.succeed(reachedLimit, undefined);
              yield* Deferred.await(release);
              yield* Ref.update(active, (value) => value - 1);
              return readyProbe(id, 25);
            }),
          });
        });
        yield* Ref.set(harness.instances, instances);
        const service = yield* makeService(harness.registry);

        const reportFiber = yield* service.read({ forceRefresh: true }).pipe(Effect.forkScoped);
        yield* Deferred.await(reachedLimit);
        yield* Effect.yieldNow;
        expect(yield* Ref.get(maximum)).toBe(3);
        yield* Deferred.succeed(release, undefined);
        const report = yield* Fiber.join(reportFiber);

        expect(report.instances).toHaveLength(5);
        expect(yield* Ref.get(maximum)).toBe(3);
      }),
    ),
  );

  it.effect("uses last-good data for a degraded minute and clears it on identity changes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        const fingerprint = yield* Ref.make("account-a");
        const next = yield* Ref.make<ProviderSubscriptionUsageProbe>(
          readyProbe("codex_personal", 90),
        );
        const calls = yield* Ref.make(0);
        yield* Ref.set(harness.instances, [
          makeInstance({
            id: "codex_personal",
            fingerprint: Ref.get(fingerprint),
            read: Ref.update(calls, (value) => value + 1).pipe(Effect.andThen(Ref.get(next))),
          }),
        ]);
        const service = yield* makeService(harness.registry);

        yield* service.read({});
        yield* Ref.set(next, { result: errorResult("codex_personal"), transient: true });
        const stale = yield* service.read({ forceRefresh: true });
        expect(stale.instances[0]?.state).toBe("ready");
        expect(stale.instances[0]?.freshness).toBe("stale");
        expect(stale.instances[0]?.windows[0]?.usedPercent).toBe(90);

        yield* service.read({});
        expect(yield* Ref.get(calls)).toBe(2);
        yield* TestClock.adjust("1 minute");
        yield* service.read({});
        expect(yield* Ref.get(calls)).toBe(3);

        yield* Ref.set(fingerprint, "account-b");
        const changedIdentity = yield* service.read({ forceRefresh: true });
        expect(changedIdentity.instances[0]?.state).toBe("error");
        expect(changedIdentity.instances[0]?.freshness).toBeUndefined();
        expect(changedIdentity.instances[0]?.windows).toEqual([]);
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  );

  it.effect("rejects quota/runtime account mismatches instead of retaining prior quota", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        yield* Ref.set(harness.instances, [
          makeInstance({
            id: "codex_work",
            runtimeEmail: "runtime@example.com",
            read: Effect.succeed(readyProbe("codex_work", 12, "other@example.com")),
          }),
        ]);
        const service = yield* makeService(harness.registry);
        const report = yield* service.read({ forceRefresh: true });

        expect(report.instances[0]?.state).toBe("needs-auth");
        expect(report.instances[0]?.windows).toEqual([]);
        expect(report.instances[0]?.message).toContain("does not match");
      }),
    ),
  );

  it.effect("removes cache and the instance-scoped secret after deletion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        const calls = yield* Ref.make(0);
        const cleared: string[] = [];
        const deletionObserved = yield* Deferred.make<void>();
        const credentials: ProviderSubscriptionCredentialStoreShape = {
          ...makeCredentialStore(cleared),
          clear: (id) =>
            Effect.sync(() => void cleared.push(id)).pipe(
              Effect.andThen(Deferred.succeed(deletionObserved, undefined)),
              Effect.asVoid,
            ),
        };
        const instance = makeInstance({
          id: "codex_personal",
          read: Ref.updateAndGet(calls, (value) => value + 1).pipe(
            Effect.map((call) => readyProbe("codex_personal", call)),
          ),
        });
        yield* Ref.set(harness.instances, [instance]);
        const service = yield* makeService(harness.registry, credentials);
        yield* service.read({});

        yield* Ref.set(harness.instances, []);
        yield* PubSub.publish(harness.changes, undefined);
        yield* Deferred.await(deletionObserved);
        expect(cleared).toEqual(["codex_personal"]);

        yield* Ref.set(harness.instances, [instance]);
        const recreated = yield* service.read({});
        expect(recreated.instances[0]?.windows[0]?.usedPercent).toBe(2);
      }),
    ),
  );

  it.effect("returns only credential status while preserving manual override semantics", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const harness = yield* makeRegistryHarness;
        const saved = yield* Ref.make(Option.none<string>());
        const credentials: ProviderSubscriptionCredentialStoreShape = {
          get: () => Ref.get(saved),
          has: () => Ref.get(saved).pipe(Effect.map(Option.isSome)),
          set: (_id, secret) => Ref.set(saved, Option.some(secret)),
          clear: () => Ref.set(saved, Option.none()),
          fingerprint: () =>
            Ref.get(saved).pipe(
              Effect.map(Option.match({ onNone: () => "automatic", onSome: () => "manual" })),
            ),
        };
        yield* Ref.set(harness.instances, [
          makeInstance({
            id: "cursor_work",
            driver: ProviderDriverKind.make("cursor"),
            read: Effect.succeed(errorProbe("cursor_work")),
          }),
          makeInstance({
            id: "codex_work",
            read: Effect.succeed(errorProbe("codex_work")),
          }),
        ]);
        const service = yield* makeService(harness.registry, credentials);

        const before = yield* service.getCredentialStatus(instanceId("cursor_work"));
        expect(before.requirement).toBe("optional");
        expect(before.configured).toBe(false);

        const secret = "Cookie: WorkosCursorSessionToken=do-not-return-this";
        const savedStatus = yield* service.setCredential(instanceId("cursor_work"), secret);
        expect(savedStatus.configured).toBe(true);
        expect("secret" in savedStatus).toBe(false);
        expect(Object.values(savedStatus)).not.toContain(secret);
        expect(yield* Ref.get(saved)).toEqual(Option.some(secret));

        const clearedStatus = yield* service.clearCredential(instanceId("cursor_work"));
        expect(clearedStatus.configured).toBe(false);
        expect(yield* Ref.get(saved)).toEqual(Option.none());

        const unsupported = yield* service
          .setCredential(instanceId("codex_work"), "not-allowed")
          .pipe(Effect.flip);
        expect(unsupported.reason).toBe("unsupported");
        const unknown = yield* service
          .getCredentialStatus(instanceId("deleted_instance"))
          .pipe(Effect.flip);
        expect(unknown.reason).toBe("unknown-instance");
      }),
    ),
  );
});
