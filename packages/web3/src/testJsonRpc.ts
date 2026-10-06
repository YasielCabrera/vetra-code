/**
 * Test-only JSON-RPC stubs.
 *
 * Deliberately absent from this package's `exports` map, so it is unreachable
 * from other workspaces while still being typechecked and linted like the rest
 * of `src`. The JSON here goes through Schema codecs rather than `JSON.parse`
 * because the repo's `preferSchemaOverJson` rule applies to tests too.
 *
 * @module Web3TestJsonRpc
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import { HttpBody, HttpClient, HttpClientResponse } from "effect/http";

const JsonRpcCall = Schema.Struct({ method: Schema.String });
const decodeJsonRpcCall = Schema.decodeSync(Schema.fromJsonString(JsonRpcCall));
const encodeJsonString = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

export const toJsonString = (value: unknown): string => encodeJsonString(value);

export interface RecordedJsonRpcCall {
  readonly url: string;
  readonly method: string;
}

const readRequestBody = (body: HttpBody.HttpBody): string =>
  body._tag === "Uint8Array" ? new TextDecoder().decode(body.body) : "{}";

/**
 * An `HttpClient` that answers JSON-RPC calls from a per-method table and
 * records what was asked. Methods absent from the table answer with a JSON-RPC
 * error, which is how a real node reports an unsupported method — that is what
 * exercises the "error body arrives with HTTP 200" path.
 */
export const makeJsonRpcClientLayer = (
  responders: Record<string, unknown>,
  calls: Array<RecordedJsonRpcCall> = [],
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.sync(() => {
        const call = decodeJsonRpcCall(readRequestBody(request.body));
        calls.push({ url: request.url, method: call.method });

        const body =
          call.method in responders
            ? { jsonrpc: "2.0", id: 1, result: responders[call.method] }
            : {
                jsonrpc: "2.0",
                id: 1,
                error: { code: -32601, message: `Method not found: ${call.method}` },
              };
        return HttpClientResponse.fromWeb(request, new Response(toJsonString(body)));
      }),
    ),
  );
