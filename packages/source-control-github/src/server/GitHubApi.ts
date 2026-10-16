import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import * as SourceControlRateLimit from "@t3tools/source-control-core/server/SourceControlRateLimit";

import * as GitHubRest from "./GitHubRest.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";

export interface GitHubGraphQlInput {
  readonly host: string;
  readonly operation: string;
  readonly query: string;
  readonly variables?: Readonly<Record<string, unknown>>;
  readonly allowReserve?: boolean;
  readonly maxResponseBytes?: number;
}

/** Raw GraphQL envelopes for issue reads, with the same request policy as pull requests. */
export class GitHubApi extends Context.Service<
  GitHubApi,
  GitHubRest.GitHubRest["Service"] & {
    readonly graphql: (
      input: GitHubGraphQlInput,
    ) => Effect.Effect<string, GitHubRequestPolicy.GitHubApiError>;
  }
>()("@t3tools/source-control-github/server/GitHubApi") {}

const decodeGraphQlErrors = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      errors: Schema.NonEmptyArray(
        Schema.Struct({
          type: Schema.optional(Schema.String),
          message: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
);

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const rest = yield* GitHubRest.GitHubRest;
  const policy = yield* GitHubRequestPolicy.GitHubRequestPolicy;

  const graphql: GitHubApi["Service"]["graphql"] = Effect.fn("GitHubApi.graphql")(
    function* (input) {
      const host = GitHubRequestPolicy.normalizeHost(input.host);
      return yield* policy.request(
        {
          host,
          operation: input.operation,
          resource: "graphql",
          allowReserve: input.allowReserve ?? (yield* SourceControlRateLimit.Interactive),
        },
        (headers) =>
          Effect.gen(function* () {
            const response = yield* httpClient.execute(
              HttpClientRequest.post(GitHubRequestPolicy.gitHubApiUrls(host).graphql).pipe(
                HttpClientRequest.setHeaders(headers),
                HttpClientRequest.acceptJson,
                HttpClientRequest.bodyJsonUnsafe({
                  query: input.query,
                  variables: input.variables ?? {},
                }),
              ),
            );
            const collected = yield* collectUint8StreamText({
              stream: response.stream,
              maxBytes: input.maxResponseBytes ?? 8 * 1024 * 1024,
            }).pipe(
              Effect.catchIf(
                (error) => error.reason._tag === "EmptyBodyError",
                () => Effect.succeed({ text: "", truncated: false, invalidUtf8: false }),
              ),
            );
            const status = response.status;
            const meta = { status, headers: response.headers };
            const errors = Option.getOrUndefined(decodeGraphQlErrors(collected.text))?.errors;
            if (
              GitHubRequestPolicy.isRateLimited({
                ...meta,
                body: collected.text,
                ...(errors === undefined ? {} : { graphqlErrors: errors }),
              })
            ) {
              return { _tag: "RateLimited", ...meta } as const;
            }
            if (status === 401) return { _tag: "Unauthorized", ...meta } as const;
            if (status === 404 || errors?.every((error) => error.type === "NOT_FOUND") === true) {
              return { _tag: "NotFound", ...meta } as const;
            }
            if (errors !== undefined) {
              return {
                _tag: "Failed",
                ...meta,
                messages: errors.flatMap((error) =>
                  error.message === undefined ? [] : [error.message],
                ),
              } as const;
            }
            if (status < 200 || status >= 300 || collected.truncated || collected.invalidUtf8) {
              return { _tag: "Failed", ...meta } as const;
            }
            return { _tag: "Ok", value: collected.text, ...meta } as const;
          }).pipe(
            Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
            Effect.mapError(
              (cause) =>
                new GitHubRequestPolicy.GitHubApiRequestError({
                  host,
                  operation: input.operation,
                  cause,
                }),
            ),
          ),
      );
    },
  );
  return GitHubApi.of({ ...rest, graphql });
});

export const layer = Layer.effect(GitHubApi, make);
export const layerWithDependencies = layer.pipe(
  Layer.provideMerge(GitHubRest.layerWithDependencies),
);
