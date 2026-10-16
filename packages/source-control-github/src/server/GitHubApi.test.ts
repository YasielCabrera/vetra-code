import { expect, it } from "@effect/vitest";
import * as TestClock from "effect/testing/TestClock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { HttpClient, HttpClientResponse, type HttpClientRequest } from "effect/http";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";

import * as GitHubApi from "./GitHubApi.ts";
import * as GitHubCredentials from "./GitHubCredentials.ts";
import * as GitHubQuota from "./GitHubQuota.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

function harness(respond: () => Response) {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const http = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      requests.push(request);
      return Effect.succeed(HttpClientResponse.fromWeb(request, respond()));
    }),
  );
  const credentials = Layer.succeed(
    GitHubCredentials.GitHubCredentials,
    GitHubCredentials.GitHubCredentials.of({
      get: (host) =>
        Effect.succeed({
          host,
          token: Redacted.make("selected-token"),
          fingerprint: "selected-account",
          source: "gh",
        }),
      invalidate: () => Effect.void,
    }),
  );
  const layer = GitHubApi.layer.pipe(
    Layer.provideMerge(GitHubRest.layer),
    Layer.provide(Layer.mergeAll(credentials, GitHubQuota.layer, SourceControlRateLimit.layer)),
    Layer.provide(http),
  );
  return { requests, layer };
}

it.effect("issue GraphQL and REST use the same pinned credential", () => {
  const { requests, layer } = harness(() => new Response('{"data":{"viewer":{"login":"dev"}}}'));
  return Effect.gen(function* () {
    const api = yield* GitHubApi.GitHubApi;
    expect(
      yield* api.graphql({
        host: "github.com",
        operation: "viewer",
        query: "query { viewer { login } }",
      }),
    ).toBe('{"data":{"viewer":{"login":"dev"}}}');
    yield* api.rest({ host: "github.com", operation: "issue", path: "repos/acme/app/issues/1" });
    expect(requests.map((request) => request.headers.authorization)).toEqual([
      "Bearer pinned-token",
      "Bearer pinned-token",
    ]);
    expect(requests.map((request) => request.url)).toEqual([
      "https://api.github.com/graphql",
      "https://api.github.com/repos/acme/app/issues/1",
    ]);
  }).pipe(
    Effect.provideService(GitHubRequestPolicy.PinnedGitHubCredential, {
      host: "github.com",
      token: Redacted.make("pinned-token"),
      credentialFingerprint: "pinned-account",
    }),
    Effect.provide(layer),
  );
});

it.effect(
  "an issue GraphQL not-found answer remains distinguishable from a request failure",
  () => {
    const { layer } = harness(
      () =>
        new Response(
          '{"data":{"repository":null},"errors":[{"type":"NOT_FOUND","message":"Missing"}]}',
        ),
    );
    return Effect.gen(function* () {
      const api = yield* GitHubApi.GitHubApi;
      expect(
        yield* Effect.flip(
          api.graphql({
            host: "github.com",
            operation: "issue",
            query: "query { repository { id } }",
          }),
        ),
      ).toMatchObject({ _tag: "GitHubApiNotFoundError", operation: "issue" });
    }).pipe(Effect.provide(layer));
  },
);

it.effect("a truncated issue envelope is refused before the issue decoder reads it", () => {
  const { layer } = harness(() => new Response('{"data":{"viewer":{"login":"dev"}}}'));
  return Effect.gen(function* () {
    const api = yield* GitHubApi.GitHubApi;
    expect(
      yield* Effect.flip(
        api.graphql({
          host: "github.com",
          operation: "issue",
          query: "query { viewer { login } }",
          maxResponseBytes: 8,
        }),
      ),
    ).toMatchObject({ _tag: "GitHubApiResponseError", status: 200 });
  }).pipe(Effect.provide(layer));
});

it.effect("an issue GraphQL rate limit pauses REST through the shared policy", () => {
  const { requests, layer } = harness(
    () =>
      new Response('{"errors":[{"type":"RATE_LIMITED","message":"Wait"}]}', {
        headers: { "retry-after": "60" },
      }),
  );
  return Effect.gen(function* () {
    const api = yield* GitHubApi.GitHubApi;
    expect(
      yield* Effect.flip(
        api.graphql({
          host: "github.com",
          operation: "issue",
          query: "query { viewer { login } }",
          allowReserve: false,
        }),
      ),
    ).toMatchObject({ _tag: "GitHubApiRateLimitError" });
    expect(
      yield* Effect.flip(
        api.rest({
          host: "github.com",
          operation: "issue",
          path: "repos/acme/app/issues/1",
          allowReserve: false,
        }),
      ),
    ).toMatchObject({ _tag: "SourceControlRateLimitPausedError" });
    expect(requests).toHaveLength(1);
  }).pipe(Effect.provide(layer));
});

it.effect("bulk issue reads preserve GraphQL reserve while individual reads can use it", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");
  const reset = now / 1000 + 3600;
  let remaining = 99;
  const { layer, requests } = harness(
    () =>
      new Response(JSON.stringify({ data: { viewer: { id: "1" } } }), {
        headers: {
          "x-ratelimit-resource": "graphql",
          "x-ratelimit-limit": "1000",
          "x-ratelimit-remaining": String(remaining),
          "x-ratelimit-reset": String(reset),
        },
      }),
  );
  return Effect.gen(function* () {
    yield* TestClock.setTime(now);
    const api = yield* GitHubApi.GitHubApi;
    const read = { host: "github.com", operation: "listIssues", query: "query { viewer { id } }" };
    yield* api.graphql({ ...read, allowReserve: false });
    for (const operation of ["listIssues", "getIssueMetadata", "getIssue"]) {
      const paused = yield* api
        .graphql({ ...read, operation, allowReserve: false })
        .pipe(Effect.provideService(SourceControlRateLimit.Interactive, true), Effect.flip);
      expect(paused._tag).toBe("SourceControlRateLimitPausedError");
    }
    expect(requests).toHaveLength(1);
    remaining = 0;
    yield* api
      .graphql({ ...read, operation: "getIssue" })
      .pipe(Effect.provideService(SourceControlRateLimit.Interactive, true));
    const empty = yield* api
      .graphql({ ...read, operation: "getIssue" })
      .pipe(Effect.provideService(SourceControlRateLimit.Interactive, true), Effect.flip);
    expect(empty._tag).toBe("SourceControlRateLimitPausedError");
    expect(requests).toHaveLength(2);
  }).pipe(Effect.provide(layer));
});
