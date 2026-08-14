import * as NodeCrypto from "node:crypto";

import type {
  OpenCodeSettings,
  ProviderSubscriptionUsageDetail,
  ProviderSubscriptionUsageInstanceResult,
  ProviderSubscriptionUsageWindow,
} from "@vetra-code/contracts";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type { HttpClient } from "effect/unstable/http";

import type { ProviderInstance, ProviderSubscriptionUsageCapability } from "../ProviderDriver.ts";
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

const OPENCODE_ORIGIN = "https://opencode.ai";
const WORKSPACES_SERVER_ID = "def39973159c7f0483d8793a822b8dbb10d067e12c65455fcb4608459ba0234f";
const ZEN_BILLING_SERVER_ID = "c83b78a614689c38ebee981f9b39a8b377716db85c1fd7dbab604adc02d3313d";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/143 Safari/537.36";

type UnknownRecord = Readonly<Record<string, unknown>>;

const record = (value: unknown): UnknownRecord | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
const finiteNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replaceAll(",", ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const normalizeCookie = (value: string): string | undefined => {
  const cookie = value
    .trim()
    .replace(/^cookie\s*:\s*/iu, "")
    .trim();
  if (!cookie || /[\r\n]/u.test(cookie)) return undefined;
  return cookie;
};

export const normalizeOpenCodeWorkspaceId = (value: string): string | undefined => {
  const match =
    value.trim().match(/(?:^|\/)(wrk_[A-Za-z0-9]+)(?:$|\/)/u) ??
    value.trim().match(/\b(wrk_[A-Za-z0-9]+)\b/u);
  return match?.[1];
};

const looksSignedOut = (text: string): boolean => {
  const lower = text.toLowerCase();
  return (
    lower.includes("auth/authorize") ||
    lower.includes("not associated with an account") ||
    lower.includes('actor of type "public"')
  );
};

const parseJson = (text: string): unknown | undefined => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const collectWorkspaceIds = (value: unknown, ids: Set<string>): void => {
  if (typeof value === "string") {
    const workspaceId = normalizeOpenCodeWorkspaceId(value);
    if (workspaceId) ids.add(workspaceId);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectWorkspaceIds(item, ids);
    return;
  }
  const object = record(value);
  if (!object) return;
  for (const item of Object.values(object)) collectWorkspaceIds(item, ids);
};

export const parseOpenCodeWorkspaceIds = (text: string): ReadonlyArray<string> => {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\bwrk_[A-Za-z0-9]+\b/gu)) ids.add(match[0]);
  const parsed = parseJson(text);
  if (parsed !== undefined) collectWorkspaceIds(parsed, ids);
  return [...ids];
};

const PERCENT_KEYS = [
  "usagePercent",
  "usedPercent",
  "percentUsed",
  "percent",
  "usage_percent",
  "used_percent",
  "utilization",
  "utilizationPercent",
  "utilization_percent",
] as const;
const RESET_IN_KEYS = [
  "resetInSec",
  "resetInSeconds",
  "resetSeconds",
  "reset_sec",
  "reset_in_sec",
  "resetsInSec",
  "resetsInSeconds",
  "resetIn",
  "resetSec",
] as const;
const RESET_AT_KEYS = [
  "resetAt",
  "resetsAt",
  "reset_at",
  "resets_at",
  "nextReset",
  "next_reset",
  "renewAt",
  "renew_at",
] as const;

const firstNumber = (object: UnknownRecord, keys: ReadonlyArray<string>): number | undefined => {
  for (const key of keys) {
    const value = finiteNumber(object[key]);
    if (value !== undefined) return value;
  }
  return undefined;
};

const normalizeDirectPercent = (value: number): number =>
  value >= 0 && value <= 1 ? value * 100 : value;

const dateFromUnknown = (value: unknown): string | undefined => {
  const numeric = finiteNumber(value);
  if (numeric !== undefined && numeric > 1_000_000_000) {
    return Option.match(DateTime.make(numeric > 1_000_000_000_000 ? numeric : numeric * 1_000), {
      onNone: () => undefined,
      onSome: DateTime.formatIso,
    });
  }
  if (typeof value === "string") {
    return Option.match(DateTime.make(value), {
      onNone: () => undefined,
      onSome: DateTime.formatIso,
    });
  }
  return undefined;
};

interface WindowCandidate {
  readonly path: string;
  readonly usedPercent: number;
  readonly resetsAt?: string;
}

const windowFromRecord = (
  object: UnknownRecord,
  path: string,
  nowMs: number,
): WindowCandidate | undefined => {
  let usedPercent = firstNumber(object, PERCENT_KEYS);
  const percentIsDirect = usedPercent !== undefined;
  if (usedPercent === undefined) {
    const used = firstNumber(object, ["used", "usage", "consumed", "count", "usedTokens"]);
    const limit = firstNumber(object, ["limit", "total", "quota", "max", "cap", "tokenLimit"]);
    if (used !== undefined && limit !== undefined && limit > 0) usedPercent = (used / limit) * 100;
  }
  if (usedPercent === undefined || usedPercent < 0) return undefined;
  if (percentIsDirect) usedPercent = normalizeDirectPercent(usedPercent);

  const resetIn = firstNumber(object, RESET_IN_KEYS);
  let resetsAt =
    resetIn !== undefined
      ? DateTime.formatIso(DateTime.makeUnsafe(nowMs + Math.max(0, resetIn) * 1_000))
      : undefined;
  if (!resetsAt) {
    for (const key of RESET_AT_KEYS) {
      resetsAt = dateFromUnknown(object[key]);
      if (resetsAt) break;
    }
  }
  return { path: path.toLowerCase(), usedPercent, ...(resetsAt ? { resetsAt } : {}) };
};

const collectWindowCandidates = (
  value: unknown,
  nowMs: number,
  path: ReadonlyArray<string> = [],
  output: WindowCandidate[] = [],
): WindowCandidate[] => {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectWindowCandidates(item, nowMs, [...path, `[${index}]`], output),
    );
    return output;
  }
  const object = record(value);
  if (!object) return output;
  const candidate = windowFromRecord(object, path.join("."), nowMs);
  if (candidate) output.push(candidate);
  for (const [key, nested] of Object.entries(object)) {
    collectWindowCandidates(nested, nowMs, [...path, key], output);
  }
  return output;
};

const extractEmbeddedJson = (text: string): ReadonlyArray<unknown> => {
  const direct = parseJson(text);
  if (direct !== undefined) return [direct];
  const values: unknown[] = [];
  for (const match of text.matchAll(/<(?:script)[^>]*>([\s\S]*?)<\/(?:script)>/giu)) {
    const body = match[1]?.trim();
    if (!body) continue;
    const parsed = parseJson(body);
    if (parsed !== undefined) values.push(parsed);
  }
  return values;
};

export const parseOpenCodeGoSubscriptionUsage = (input: {
  readonly identity: ProviderSubscriptionUsageIdentity;
  readonly fetchedAt: string;
  readonly text: string;
  readonly zenBalance?: number;
  readonly nowMs?: number;
}): ProviderSubscriptionUsageInstanceResult | undefined => {
  const nowMs = input.nowMs ?? DateTime.toEpochMillis(DateTime.nowUnsafe());
  const roots = extractEmbeddedJson(input.text);
  const candidates = roots.flatMap((root) => collectWindowCandidates(root, nowMs));
  const regexCandidates: WindowCandidate[] = [];
  for (const [path, expression] of [
    ["rolling", /rollingUsage[^}]*?usagePercent\s*:\s*([0-9]+(?:\.[0-9]+)?)/iu],
    ["weekly", /weeklyUsage[^}]*?usagePercent\s*:\s*([0-9]+(?:\.[0-9]+)?)/iu],
    ["monthly", /monthlyUsage[^}]*?usagePercent\s*:\s*([0-9]+(?:\.[0-9]+)?)/iu],
  ] as const) {
    const match = input.text.match(expression);
    if (!match?.[1]) continue;
    const resetMatch = input.text.match(
      new RegExp(`${path}Usage[^}]*?resetInSec\\s*:\\s*([0-9]+)`, "iu"),
    );
    regexCandidates.push({
      path,
      usedPercent: normalizeDirectPercent(Number(match[1])),
      ...(resetMatch?.[1]
        ? {
            resetsAt: DateTime.formatIso(
              DateTime.makeUnsafe(nowMs + Number(resetMatch[1]) * 1_000),
            ),
          }
        : {}),
    });
  }
  const all = [...candidates, ...regexCandidates];
  const choose = (terms: ReadonlyArray<string>) =>
    all.find((candidate) => terms.some((term) => candidate.path.includes(term)));
  const rolling = choose(["rolling", "five", "5h", "5-hour", "hour"]);
  const weekly = choose(["weekly", "week"]);
  const monthly = choose(["monthly", "month"]);
  if (!rolling && !weekly && !monthly && input.zenBalance === undefined) return undefined;

  const windows: ProviderSubscriptionUsageWindow[] = [];
  for (const [id, label, durationMinutes, candidate] of [
    ["five-hour", "5-hour", 300, rolling],
    ["weekly", "Weekly", 10_080, weekly],
    ["monthly", "Monthly", undefined, monthly],
  ] as const) {
    if (!candidate) continue;
    const window = percentageWindow({
      id,
      label,
      usedPercent: candidate.usedPercent,
      durationMinutes,
      ...(candidate.resetsAt ? { resetsAt: candidate.resetsAt } : {}),
    });
    if (window) windows.push(window);
  }
  const details: ProviderSubscriptionUsageDetail[] = [];
  if (input.zenBalance !== undefined) {
    details.push({
      id: "zen-balance",
      label: "Zen balance",
      value: formatMoney(input.zenBalance),
    });
  }
  return settledResult(input.identity, {
    state: "ready",
    freshness: "fresh",
    fetchedAt: input.fetchedAt,
    source: "manual-credential",
    planLabel: "OpenCode Go",
    windows,
    details,
  });
};

const findZenPageBalance = (value: unknown): number | undefined => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findZenPageBalance(item);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const object = record(value);
  if (!object) return undefined;
  for (const [key, nested] of Object.entries(object)) {
    const normalized = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
    if (
      [
        "zenbalance",
        "zencurrentbalance",
        "currentbalance",
        "currentbalanceusd",
        "balanceusd",
        "usdbalance",
      ].includes(normalized)
    ) {
      const amount = finiteNumber(nested);
      if (amount !== undefined) return amount;
    }
    const found = findZenPageBalance(nested);
    if (found !== undefined) return found;
  }
  return undefined;
};

export const parseOpenCodeZenBalance = (
  text: string,
  billingResponse = false,
): number | undefined => {
  const parsed = parseJson(text);
  if (billingResponse && parsed !== undefined) {
    const findRaw = (value: unknown): number | undefined => {
      if (Array.isArray(value)) {
        for (const item of value) {
          const found = findRaw(item);
          if (found !== undefined) return found;
        }
        return undefined;
      }
      const object = record(value);
      if (!object) return undefined;
      if (typeof object.customerID === "string") {
        const balance = finiteNumber(object.balance);
        if (balance !== undefined) return balance / 100_000_000;
      }
      for (const nested of Object.values(object)) {
        const found = findRaw(nested);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    return findRaw(parsed);
  }
  if (parsed !== undefined) {
    const found = findZenPageBalance(parsed);
    if (found !== undefined) return found;
  }
  const match = text.match(
    /(?:current\s+balance|zen\s+balance|balance)[\s\S]{0,120}?\$\s*([0-9][0-9,]*(?:\.[0-9]+)?)/iu,
  );
  return match?.[1] ? finiteNumber(match[1]) : undefined;
};

const serverHeaders = (input: {
  readonly cookie: string;
  readonly serverId: string;
  readonly referer: string;
}) => ({
  Cookie: input.cookie,
  "X-Server-Id": input.serverId,
  "X-Server-Instance": `server-fn:${NodeCrypto.randomUUID()}`,
  "User-Agent": USER_AGENT,
  Origin: OPENCODE_ORIGIN,
  Referer: input.referer,
  Accept: "text/javascript, application/json;q=0.9, */*;q=0.8",
});

const serverRequest = (input: {
  readonly client: HttpClient.HttpClient;
  readonly cookie: string;
  readonly serverId: string;
  readonly args?: ReadonlyArray<string>;
  readonly method?: "GET" | "POST";
  readonly referer: string;
}) => {
  const method = input.method ?? "GET";
  const args = input.args ? JSON.stringify(input.args) : undefined;
  const url =
    method === "GET"
      ? `${OPENCODE_ORIGIN}/_server?id=${encodeURIComponent(input.serverId)}${args ? `&args=${encodeURIComponent(args)}` : ""}`
      : `${OPENCODE_ORIGIN}/_server`;
  return providerUsageHttpRequest({
    client: input.client,
    allowedOrigin: OPENCODE_ORIGIN,
    url,
    method,
    headers: serverHeaders(input),
    ...(method === "POST" ? { body: args ?? "[]" } : {}),
  });
};

export const makeOpenCodeSubscriptionUsageCapability = (input: {
  readonly instance: Pick<ProviderInstance, "instanceId" | "driverKind" | "displayName">;
  readonly settings: OpenCodeSettings;
  readonly httpClient: HttpClient.HttpClient;
  readonly credentials: ProviderSubscriptionCredentialStoreShape;
}): ProviderSubscriptionUsageCapability => {
  const identity: ProviderSubscriptionUsageIdentity = {
    instanceId: input.instance.instanceId,
    driver: input.instance.driverKind,
    displayName: input.instance.displayName ?? "OpenCode",
  };
  const workspaceOverride = normalizeOpenCodeWorkspaceId(input.settings.goWorkspaceId ?? "");
  const fingerprint = input.credentials.fingerprint(input.instance.instanceId).pipe(
    Effect.map((credential) => configFingerprint({ credential, workspaceOverride })),
    Effect.orElseSucceed(() => configFingerprint({ credential: "unreadable", workspaceOverride })),
  );

  const read = input.credentials.get(input.instance.instanceId).pipe(
    Effect.flatMap(
      Option.match({
        onNone: () =>
          Effect.succeed(
            settledProbe(
              settledResult(identity, {
                state: "needs-auth",
                message: "OpenCode Go subscription limits require an opencode.ai Cookie header.",
                windows: [],
                details: [],
              }),
            ),
          ),
        onSome: (rawCookie) => {
          const cookie = normalizeCookie(rawCookie);
          if (!cookie) {
            return Effect.succeed(
              settledProbe(
                settledResult(identity, {
                  state: "needs-auth",
                  message: "The saved OpenCode Go Cookie header is invalid.",
                  windows: [],
                  details: [],
                }),
              ),
            );
          }
          const resolveWorkspace = workspaceOverride
            ? Effect.succeed(workspaceOverride)
            : serverRequest({
                client: input.httpClient,
                cookie,
                serverId: WORKSPACES_SERVER_ID,
                referer: OPENCODE_ORIGIN,
              }).pipe(
                Effect.flatMap((response) => {
                  const first = parseOpenCodeWorkspaceIds(response.body)[0];
                  if (first) return Effect.succeed(first);
                  return serverRequest({
                    client: input.httpClient,
                    cookie,
                    serverId: WORKSPACES_SERVER_ID,
                    method: "POST",
                    referer: OPENCODE_ORIGIN,
                  }).pipe(
                    Effect.flatMap((fallback) => {
                      const resolved = parseOpenCodeWorkspaceIds(fallback.body)[0];
                      return resolved
                        ? Effect.succeed(resolved)
                        : Effect.fail(new ProviderUsageHttpError({ kind: "response" }));
                    }),
                  );
                }),
              );
          return resolveWorkspace.pipe(
            Effect.flatMap((workspaceId) => {
              const commonHeaders = {
                Cookie: cookie,
                "User-Agent": USER_AGENT,
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              };
              const usage = providerUsageHttpRequest({
                client: input.httpClient,
                allowedOrigin: OPENCODE_ORIGIN,
                url: `${OPENCODE_ORIGIN}/workspace/${encodeURIComponent(workspaceId)}/go`,
                headers: commonHeaders,
              });
              const zen = providerUsageHttpRequest({
                client: input.httpClient,
                allowedOrigin: OPENCODE_ORIGIN,
                url: `${OPENCODE_ORIGIN}/workspace/${encodeURIComponent(workspaceId)}`,
                headers: commonHeaders,
              }).pipe(
                Effect.flatMap((page) => {
                  const balance = parseOpenCodeZenBalance(page.body);
                  if (balance !== undefined) return Effect.succeed(balance);
                  return serverRequest({
                    client: input.httpClient,
                    cookie,
                    serverId: ZEN_BILLING_SERVER_ID,
                    args: [workspaceId],
                    referer: `${OPENCODE_ORIGIN}/workspace/${workspaceId}`,
                  }).pipe(Effect.map((response) => parseOpenCodeZenBalance(response.body, true)));
                }),
                Effect.timeoutOption("5 seconds"),
                Effect.orElseSucceed(() => Option.none<number>()),
              );
              return Effect.all({ usage, zen }, { concurrency: 2 }).pipe(
                Effect.flatMap(({ usage: usageResponse, zen: zenBalance }) =>
                  Effect.gen(function* () {
                    if (looksSignedOut(usageResponse.body)) {
                      return yield* new ProviderUsageHttpError({ kind: "auth" });
                    }
                    const parsed = parseOpenCodeGoSubscriptionUsage({
                      identity,
                      fetchedAt: DateTime.formatIso(yield* DateTime.now),
                      text: usageResponse.body,
                      ...(Option.isSome(zenBalance) && zenBalance.value !== undefined
                        ? { zenBalance: zenBalance.value }
                        : {}),
                    });
                    return parsed
                      ? parsed
                      : yield* new ProviderUsageHttpError({ kind: "response" });
                  }),
                ),
              );
            }),
            Effect.map(settledProbe),
            Effect.catch((error) => {
              const auth = error instanceof ProviderUsageHttpError && error.kind === "auth";
              const unsupported =
                error instanceof ProviderUsageHttpError &&
                error.kind === "response" &&
                error.status === 404;
              return Effect.succeed(
                failureProbe(
                  settledResult(identity, {
                    state: auth ? "needs-auth" : unsupported ? "unsupported" : "error",
                    message: auth
                      ? "The OpenCode Go Cookie header is no longer authenticated."
                      : unsupported
                        ? "This OpenCode account does not expose OpenCode Go subscription limits."
                        : "OpenCode Go subscription limits could not be refreshed.",
                    windows: [],
                    details: [],
                  }),
                  error,
                ),
              );
            }),
          );
        },
      }),
    ),
    // A defect here means parser drift or a broken assumption, never a blip, so
    // it must not qualify for the last-good stale path.
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
      return Effect.succeed(
        settledProbe(
          settledResult(identity, {
            state: "error",
            message: "OpenCode Go subscription limits could not be refreshed.",
            windows: [],
            details: [],
          }),
        ),
      );
    }),
  );

  return { fingerprint, read };
};
