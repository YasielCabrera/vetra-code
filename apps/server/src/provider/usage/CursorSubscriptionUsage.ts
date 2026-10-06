// @effect-diagnostics nodeBuiltinImport:off
import * as NodeBuffer from "node:buffer";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import type {
  ProviderSubscriptionUsageCost,
  ProviderSubscriptionUsageDetail,
  ProviderSubscriptionUsageInstanceResult,
  ProviderSubscriptionUsageWindow,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { HttpClient } from "effect/http";

import type { ProviderInstance, ProviderSubscriptionUsageCapability } from "../ProviderDriver.ts";
import { fetchCursorDashboardUsage } from "./CursorDashboardUsage.ts";
import type { ProviderSubscriptionCredentialStoreShape } from "./ProviderSubscriptionCredentialStore.ts";
import {
  configFingerprint,
  failureProbe,
  formatMoney,
  percentageWindow,
  settledProbe,
  settledResult,
  type ProviderSubscriptionUsageIdentity,
} from "./providerSubscriptionUsageHelpers.ts";
import { ProviderUsageHttpError, providerUsageHttpRequest } from "./ProviderUsageHttpClient.ts";

const CURSOR_ORIGIN = "https://cursor.com";
const CURSOR_COST_TTL_MS = 60 * 60_000;

type UnknownRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
const number = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const string = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;
const boolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const normalizeCookieHeader = (value: string): string | undefined => {
  const normalized = value
    .trim()
    .replace(/^cookie\s*:\s*/iu, "")
    .trim();
  if (!normalized || /[\r\n]/u.test(normalized)) return undefined;
  return normalized;
};

const cursorStateDbPath = (environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string => {
  const home = environment.HOME?.trim() || NodeOS.homedir();
  if (platform === "darwin") {
    return NodePath.join(
      home,
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  if (platform === "win32") {
    return NodePath.join(
      environment.APPDATA?.trim() || NodePath.join(home, "AppData", "Roaming"),
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  return NodePath.join(
    environment.XDG_CONFIG_HOME?.trim() || NodePath.join(home, ".config"),
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
};

export interface CursorAppSession {
  readonly accessToken: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly cookieHeader: string;
}

export const parseCursorAppAccessToken = (
  accessToken: string,
  nowSeconds = DateTime.toEpochMillis(DateTime.nowUnsafe()) / 1_000,
): CursorAppSession | undefined => {
  const payloadPart = accessToken.split(".")[1];
  if (!payloadPart) return undefined;
  try {
    const payload = record(
      JSON.parse(NodeBuffer.Buffer.from(payloadPart, "base64url").toString("utf8")),
    );
    const subject = string(payload?.sub);
    const expiresAt = number(payload?.exp);
    const userId = subject?.split("|").findLast((part) => part.length > 0);
    if (
      !userId ||
      !/^[A-Za-z0-9._-]+$/u.test(userId) ||
      !expiresAt ||
      expiresAt <= nowSeconds + 60
    ) {
      return undefined;
    }
    return {
      accessToken,
      userId,
      expiresAt,
      cookieHeader: `WorkosCursorSessionToken=${userId}%3A%3A${accessToken}`,
    };
  } catch {
    return undefined;
  }
};

const readCursorAppSession = (
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Effect.Effect<CursorAppSession | undefined> =>
  Effect.try({
    try: () => {
      const database = new NodeSqlite.DatabaseSync(cursorStateDbPath(environment, platform), {
        readOnly: true,
      });
      try {
        const row = database
          .prepare("SELECT value FROM ItemTable WHERE key = ? LIMIT 1")
          .get("cursorAuth/accessToken") as { readonly value?: string | Uint8Array } | null;
        if (!row?.value) return undefined;
        const token =
          typeof row.value === "string" ? row.value : new TextDecoder("utf-8").decode(row.value);
        return parseCursorAppAccessToken(token.trim());
      } finally {
        database.close();
      }
    },
    catch: () => undefined,
  }).pipe(Effect.orElseSucceed(() => undefined));

const parseIso = (value: unknown): string | undefined => {
  const candidate = string(value);
  if (!candidate) return undefined;
  return Option.match(DateTime.make(candidate), {
    onNone: () => undefined,
    onSome: DateTime.formatIso,
  });
};

const percentFromUsage = (usage: UnknownRecord | undefined): number | undefined => {
  const explicit = number(usage?.totalPercentUsed);
  if (explicit !== undefined) return Math.max(0, explicit);
  const auto = number(usage?.autoPercentUsed);
  const api = number(usage?.apiPercentUsed);
  if (auto !== undefined && api !== undefined) return Math.max(0, (auto + api) / 2);
  if (auto !== undefined) return Math.max(0, auto);
  if (api !== undefined) return Math.max(0, api);
  const used = number(usage?.used);
  const limit = number(usage?.limit);
  return used !== undefined && limit && limit > 0 ? Math.max(0, (used / limit) * 100) : undefined;
};

const moneyDetail = (
  details: ProviderSubscriptionUsageDetail[],
  id: string,
  label: string,
  value: UnknownRecord | undefined,
) => {
  const used = number(value?.used);
  const limit = number(value?.limit);
  const enabled = boolean(value?.enabled);
  if (enabled === false && used === undefined && limit === undefined) return;
  if (used === undefined && limit === undefined) return;
  details.push({
    id,
    label,
    value:
      limit !== undefined
        ? `${formatMoney((used ?? 0) / 100)} / ${formatMoney(limit / 100)}`
        : `${formatMoney((used ?? 0) / 100)} used`,
  });
};

export const parseCursorSubscriptionUsage = (input: {
  readonly identity: ProviderSubscriptionUsageIdentity;
  readonly fetchedAt: string;
  readonly source: "provider-app" | "manual-credential";
  readonly summary: unknown;
  readonly userInfo?: unknown;
  readonly legacyUsage?: unknown;
  readonly cost?: ProviderSubscriptionUsageCost;
}): ProviderSubscriptionUsageInstanceResult => {
  const summary = record(input.summary) ?? {};
  const individual = record(summary.individualUsage);
  const team = record(summary.teamUsage);
  const plan = record(individual?.plan);
  const overall = record(individual?.overall);
  const pooled = record(team?.pooled);
  const planPercent =
    percentFromUsage(plan) ?? percentFromUsage(overall) ?? percentFromUsage(pooled);
  const billingStart = parseIso(summary.billingCycleStart);
  const billingEnd = parseIso(summary.billingCycleEnd);
  const durationMinutes =
    billingStart && billingEnd
      ? Math.max(0, Math.round((Date.parse(billingEnd) - Date.parse(billingStart)) / 60_000))
      : undefined;
  const windows: ProviderSubscriptionUsageWindow[] = [];
  const details: ProviderSubscriptionUsageDetail[] = [];
  const legacy = record(record(input.legacyUsage)?.["gpt-4"]);
  const requestsUsed = number(legacy?.numRequestsTotal) ?? number(legacy?.numRequests);
  const requestsLimit = number(legacy?.maxRequestUsage);
  const hasLegacyRequestQuota =
    requestsUsed !== undefined && requestsLimit !== undefined && requestsLimit > 0;

  if (hasLegacyRequestQuota) {
    const window = percentageWindow({
      id: "legacy-request-quota",
      label: "Monthly request quota",
      usedPercent: Math.max(0, (requestsUsed / requestsLimit) * 100),
      durationMinutes,
      ...(billingEnd ? { resetsAt: billingEnd } : {}),
    });
    if (window) windows.push(window);
    details.push({
      id: "legacy-requests",
      label: "Requests",
      value: `${requestsUsed} / ${requestsLimit}`,
    });
  } else {
    if (planPercent !== undefined) {
      const window = percentageWindow({
        id: "monthly-included",
        label: "Total",
        usedPercent: planPercent,
        durationMinutes,
        ...(billingEnd ? { resetsAt: billingEnd } : {}),
      });
      if (window) windows.push(window);
    }
    for (const [id, label, value] of [
      ["auto-composer", "Auto", number(plan?.autoPercentUsed)],
      ["api-models", "API", number(plan?.apiPercentUsed)],
    ] as const) {
      if (value === undefined) continue;
      const window = percentageWindow({
        id,
        label,
        usedPercent: Math.max(0, value),
        durationMinutes,
        ...(billingEnd ? { resetsAt: billingEnd } : {}),
      });
      if (window) windows.push(window);
    }
  }

  moneyDetail(details, "included", "Included usage", plan ?? overall ?? pooled);
  moneyDetail(details, "personal-on-demand", "Personal on-demand", record(individual?.onDemand));
  moneyDetail(details, "team-on-demand", "Team on-demand", record(team?.onDemand));
  moneyDetail(details, "team-pool", "Team pool", pooled);

  const user = record(input.userInfo);
  const accountEmail = string(user?.email);
  const planLabel = string(summary.membershipType);
  return settledResult(input.identity, {
    state: "ready",
    freshness: "fresh",
    fetchedAt: input.fetchedAt,
    source: input.source,
    ...(accountEmail ? { accountLabel: accountEmail } : {}),
    ...(planLabel ? { planLabel } : {}),
    ...(input.cost ? { cost: input.cost } : {}),
    windows,
    details,
  });
};

const json = (body: string): unknown => JSON.parse(body) as unknown;

export const makeCursorSubscriptionUsageCapability = (input: {
  readonly instance: Pick<ProviderInstance, "instanceId" | "driverKind" | "displayName">;
  readonly environment: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly httpClient: HttpClient.HttpClient;
  readonly credentials: ProviderSubscriptionCredentialStoreShape;
}): ProviderSubscriptionUsageCapability => {
  const identity: ProviderSubscriptionUsageIdentity = {
    instanceId: input.instance.instanceId,
    driver: input.instance.driverKind,
    displayName: input.instance.displayName ?? "Cursor",
  };
  let costCache:
    | {
        readonly fingerprint: string;
        readonly expiresAt: number;
        readonly value: ProviderSubscriptionUsageCost | undefined;
      }
    | undefined;

  const readCost = (cookieHeader: string, nowMs: number) => {
    const fingerprint = configFingerprint({ cookieHeader });
    const current = costCache?.fingerprint === fingerprint ? costCache : undefined;
    if (current && current.expiresAt > nowMs) return Effect.succeed(current.value);
    return fetchCursorDashboardUsage({
      client: input.httpClient,
      cookieHeader,
      nowMs,
    }).pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          costCache = { fingerprint, expiresAt: nowMs + CURSOR_COST_TTL_MS, value };
        }),
      ),
      Effect.orElseSucceed(() => current?.value),
    );
  };

  const resolveCredential = Effect.gen(function* () {
    const manual = yield* input.credentials.get(input.instance.instanceId);
    if (Option.isSome(manual)) {
      const cookieHeader = normalizeCookieHeader(manual.value);
      return cookieHeader
        ? ({ source: "manual-credential" as const, cookieHeader } as const)
        : undefined;
    }
    const app = yield* readCursorAppSession(input.environment, input.platform);
    return app
      ? ({
          source: "provider-app" as const,
          cookieHeader: app.cookieHeader,
          userId: app.userId,
        } as const)
      : undefined;
  });

  const fingerprint = resolveCredential.pipe(
    Effect.map((credential) =>
      configFingerprint({
        source: credential?.source ?? "none",
        cookieHeader: credential?.cookieHeader ?? "",
        statePath: cursorStateDbPath(input.environment, input.platform),
      }),
    ),
    Effect.orElseSucceed(() => configFingerprint({ source: "unreadable" })),
  );

  const read = resolveCredential.pipe(
    Effect.flatMap((credential) => {
      if (!credential) {
        return Effect.succeed(
          settledProbe(
            settledResult(identity, {
              state: "needs-auth",
              message:
                "Sign in to the Cursor app on this environment or save a Cursor Cookie header in provider settings.",
              windows: [],
              details: [],
            }),
          ),
        );
      }
      const headers = { Accept: "application/json", Cookie: credential.cookieHeader };
      return DateTime.now.pipe(
        Effect.flatMap((now) =>
          Effect.all(
            {
              summary: providerUsageHttpRequest({
                client: input.httpClient,
                allowedOrigin: CURSOR_ORIGIN,
                url: `${CURSOR_ORIGIN}/api/usage-summary`,
                headers,
              }),
              user: providerUsageHttpRequest({
                client: input.httpClient,
                allowedOrigin: CURSOR_ORIGIN,
                url: `${CURSOR_ORIGIN}/api/auth/me`,
                headers,
              }).pipe(Effect.option),
              cost: readCost(credential.cookieHeader, DateTime.toEpochMillis(now)),
            },
            { concurrency: 3 },
          ).pipe(Effect.map((responses) => ({ ...responses, now }))),
        ),
        Effect.flatMap(({ summary, user, cost, now }) => {
          const userInfo = Option.isSome(user) ? json(user.value.body) : undefined;
          const remoteSubject = string(record(userInfo)?.sub);
          const remoteUserId = remoteSubject?.split("|").findLast((part) => part.length > 0);
          if (
            "userId" in credential &&
            remoteUserId !== undefined &&
            remoteUserId !== credential.userId
          ) {
            return Effect.succeed(
              settledResult(identity, {
                state: "needs-auth",
                message: "The Cursor app session account changed while limits were refreshing.",
                windows: [],
                details: [],
              }),
            );
          }
          // CodexBar sends the full `/api/auth/me` subject when it is
          // available. The JWT-derived suffix remains only a fallback for
          // environments where account metadata cannot be read.
          const requestUsageUserId =
            remoteSubject ?? ("userId" in credential ? credential.userId : undefined);
          const legacy = requestUsageUserId
            ? providerUsageHttpRequest({
                client: input.httpClient,
                allowedOrigin: CURSOR_ORIGIN,
                url: `${CURSOR_ORIGIN}/api/usage?user=${encodeURIComponent(requestUsageUserId)}`,
                headers,
              }).pipe(
                Effect.map((response) => json(response.body)),
                Effect.option,
              )
            : Effect.succeed(Option.none<unknown>());
          return legacy.pipe(
            Effect.map((legacyUsage) =>
              parseCursorSubscriptionUsage({
                identity,
                fetchedAt: DateTime.formatIso(now),
                source: credential.source,
                summary: json(summary.body),
                ...(userInfo ? { userInfo } : {}),
                ...(Option.isSome(legacyUsage) ? { legacyUsage: legacyUsage.value } : {}),
                ...(cost ? { cost } : {}),
              }),
            ),
          );
        }),
        Effect.map(settledProbe),
        Effect.catch((error) => {
          const unauthenticated = error instanceof ProviderUsageHttpError && error.kind === "auth";
          return Effect.succeed(
            failureProbe(
              settledResult(identity, {
                state: unauthenticated ? "needs-auth" : "error",
                message: unauthenticated
                  ? "The Cursor session is no longer authenticated."
                  : "Cursor subscription limits could not be refreshed.",
                windows: [],
                details: [],
              }),
              error,
            ),
          );
        }),
      );
    }),
    // A defect here means parser drift or a broken assumption, never a blip, so
    // it must not qualify for the last-good stale path.
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
      return Effect.succeed(
        settledProbe(
          settledResult(identity, {
            state: "error",
            message: "Cursor subscription limits could not be refreshed.",
            windows: [],
            details: [],
          }),
        ),
      );
    }),
  );

  return { fingerprint, read };
};
