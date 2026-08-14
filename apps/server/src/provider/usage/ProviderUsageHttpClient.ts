import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientRequest, type HttpClientResponse } from "effect/unstable/http";

import { collectUint8StreamText } from "../../stream/collectUint8StreamText.ts";

const MAX_RESPONSE_BYTES = 1024 * 1024;

export type ProviderUsageHttpErrorKind =
  | "untrusted-url"
  | "redirect"
  | "auth"
  | "rate-limit"
  | "server"
  | "response"
  | "network"
  | "timeout";

export class ProviderUsageHttpError extends Data.TaggedError("ProviderUsageHttpError")<{
  readonly kind: ProviderUsageHttpErrorKind;
  readonly status?: number;
}> {}

export interface ProviderUsageHttpResponse {
  readonly status: number;
  readonly body: string;
}

const classifyStatus = (status: number): ProviderUsageHttpErrorKind => {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server";
  if (status >= 300 && status < 400) return "redirect";
  return "response";
};

const readBody = (response: HttpClientResponse.HttpClientResponse) =>
  collectUint8StreamText({
    stream: response.stream,
    maxBytes: MAX_RESPONSE_BYTES,
  }).pipe(
    Effect.mapError(() => new ProviderUsageHttpError({ kind: "response" })),
    Effect.flatMap((collected) =>
      collected.truncated || collected.invalidUtf8
        ? Effect.fail(new ProviderUsageHttpError({ kind: "response" }))
        : Effect.succeed(collected.text),
    ),
  );

export const providerUsageHttpRequest = (input: {
  readonly client: HttpClient.HttpClient;
  readonly allowedOrigin: string;
  readonly url: string;
  readonly method?: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}): Effect.Effect<ProviderUsageHttpResponse, ProviderUsageHttpError> => {
  let parsed: URL;
  try {
    parsed = new URL(input.url);
  } catch {
    return Effect.fail(new ProviderUsageHttpError({ kind: "untrusted-url" }));
  }
  if (parsed.protocol !== "https:" || parsed.origin !== input.allowedOrigin) {
    return Effect.fail(new ProviderUsageHttpError({ kind: "untrusted-url" }));
  }

  const base =
    input.method === "POST"
      ? HttpClientRequest.post(parsed.toString())
      : HttpClientRequest.get(parsed.toString());
  const withHeaders = Object.entries(input.headers ?? {}).reduce(
    (request, [name, value]) => HttpClientRequest.setHeader(request, name, value),
    base,
  );
  const request =
    input.body === undefined
      ? withHeaders
      : HttpClientRequest.bodyText(withHeaders, input.body, "application/json");

  return input.client.execute(request).pipe(
    Effect.mapError(() => new ProviderUsageHttpError({ kind: "network" })),
    Effect.flatMap((response) => {
      if (response.status < 200 || response.status >= 300) {
        return readBody(response).pipe(
          Effect.ignore,
          Effect.andThen(
            Effect.fail(
              new ProviderUsageHttpError({
                kind: classifyStatus(response.status),
                status: response.status,
              }),
            ),
          ),
        );
      }
      return readBody(response).pipe(Effect.map((body) => ({ status: response.status, body })));
    }),
    // Cover both the connection and body stream. Providers occasionally send
    // headers before stalling, so timing out only `execute` is insufficient.
    Effect.timeoutOrElse({
      duration: "15 seconds",
      orElse: () => Effect.fail(new ProviderUsageHttpError({ kind: "timeout" })),
    }),
  );
};
