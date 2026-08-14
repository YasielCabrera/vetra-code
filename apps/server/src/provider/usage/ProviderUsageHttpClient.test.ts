import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { ProviderUsageHttpError, providerUsageHttpRequest } from "./ProviderUsageHttpClient.ts";

const clientFor = (status: number, body = "{}") =>
  HttpClient.make((request) =>
    Effect.succeed(HttpClientResponse.fromWeb(request, new Response(body, { status }))),
  );

describe("ProviderUsageHttpClient", () => {
  it.effect("accepts only the exact fixed HTTPS origin", () =>
    Effect.gen(function* () {
      const client = clientFor(200);
      for (const url of [
        "http://cursor.com/api/usage-summary",
        "https://evil.example/api/usage-summary",
        "https://cursor.com.evil.example/api/usage-summary",
      ]) {
        const error = yield* providerUsageHttpRequest({
          client,
          allowedOrigin: "https://cursor.com",
          url,
        }).pipe(Effect.flip);
        expect(error.kind).toBe("untrusted-url");
      }
    }),
  );

  it.effect.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate-limit"],
    [500, "server"],
    [302, "redirect"],
  ] as const)("classifies HTTP %s as %s without exposing the response body", ([status, kind]) =>
    Effect.gen(function* () {
      const error = yield* providerUsageHttpRequest({
        client: clientFor(status, "secret provider response"),
        allowedOrigin: "https://cursor.com",
        url: "https://cursor.com/api/usage-summary",
      }).pipe(Effect.flip);
      expect(error).toBeInstanceOf(ProviderUsageHttpError);
      expect(error.kind).toBe(kind);
      expect(String(error)).not.toContain("secret provider response");
    }),
  );

  it.effect("rejects responses larger than one MiB", () =>
    Effect.gen(function* () {
      const error = yield* providerUsageHttpRequest({
        client: clientFor(200, "x".repeat(1024 * 1024 + 1)),
        allowedOrigin: "https://opencode.ai",
        url: "https://opencode.ai/_server",
      }).pipe(Effect.flip);
      expect(error.kind).toBe("response");
    }),
  );

  it.effect("keeps server classification when an error body exceeds the cap", () =>
    Effect.gen(function* () {
      const error = yield* providerUsageHttpRequest({
        client: clientFor(503, "x".repeat(1024 * 1024 + 1)),
        allowedOrigin: "https://cursor.com",
        url: "https://cursor.com/api/usage-summary",
      }).pipe(Effect.flip);
      expect(error.kind).toBe("server");
      expect(error.status).toBe(503);
    }),
  );

  it.effect("times out a provider that never returns a response", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = HttpClient.make(() => Effect.never);
        const fiber = yield* providerUsageHttpRequest({
          client,
          allowedOrigin: "https://cursor.com",
          url: "https://cursor.com/api/usage-summary",
        }).pipe(Effect.flip, Effect.forkScoped);

        yield* TestClock.adjust("15 seconds");
        const error = yield* Fiber.join(fiber);
        expect(error.kind).toBe("timeout");
      }),
    ),
  );
});
