import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/testing/TestClock";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import * as PowerhouseReactorClient from "./PowerhouseReactorClient.ts";
import { resolveGraphqlEndpoint } from "./PowerhouseReactorClient.ts";

interface RecordedRequest {
  readonly url: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

const decodeUnknownJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

/**
 * A reactor stand-in. `respond` sees the request URL and the GraphQL body, so a
 * test can answer differently per query without a real server.
 */
const reactorLayer = (
  respond: (request: RecordedRequest) => Response | Promise<Response>,
  recorded?: Array<RecordedRequest>,
) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.promise(async () => {
        const body =
          request.body._tag === "Uint8Array"
            ? new TextDecoder().decode(request.body.body)
            : typeof (request.body as { body?: unknown }).body === "string"
              ? String((request.body as { body?: unknown }).body)
              : "";
        const entry = { url: request.url, body, headers: request.headers };
        recorded?.push(entry);
        return HttpClientResponse.fromWeb(request, await respond(entry));
      }),
    ),
  );

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });

const SYSTEM_OK = { data: { system: { version: "6.2.2", gitHash: "abc123", gitUrl: null } } };

const document = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  slug: null,
  name: `Doc ${id}`,
  documentType: "powerhouse/document-drive",
  createdAtUtcIso: "2026-01-01T00:00:00.000Z",
  lastModifiedAtUtcIso: "2026-01-02T00:00:00.000Z",
  ...overrides,
});

const withClient = <A, E>(
  layer: Layer.Layer<HttpClient.HttpClient>,
  use: (
    client: PowerhouseReactorClient.PowerhouseReactorClient["Service"],
  ) => Effect.Effect<A, E, never>,
) =>
  Effect.gen(function* () {
    const client = yield* PowerhouseReactorClient.PowerhouseReactorClient;
    return yield* use(client);
  }).pipe(Effect.provide(PowerhouseReactorClient.layer.pipe(Layer.provide(layer))));

describe("resolveGraphqlEndpoint", () => {
  it.each([
    ["http://127.0.0.1:4001", "http://127.0.0.1:4001/graphql"],
    ["http://127.0.0.1:4001/", "http://127.0.0.1:4001/graphql"],
    ["https://reactor.example.com", "https://reactor.example.com/graphql"],
    ["http://127.0.0.1:4001/graphql", "http://127.0.0.1:4001/graphql"],
    ["http://127.0.0.1:4001/base", "http://127.0.0.1:4001/base/graphql"],
  ])("normalizes %s", (input, expected) => {
    expect(resolveGraphqlEndpoint(input)).toBe(expected);
  });

  it("drops credentials rather than forwarding them", () => {
    expect(resolveGraphqlEndpoint("http://user:secret@127.0.0.1:4001")).toBe(
      "http://127.0.0.1:4001/graphql",
    );
  });

  it("drops any query string the caller attached", () => {
    expect(resolveGraphqlEndpoint("http://127.0.0.1:4001/?query=whatever")).toBe(
      "http://127.0.0.1:4001/graphql",
    );
  });

  it.each(["file:///etc/passwd", "ftp://example.com", "not a url", "ws://127.0.0.1:4001"])(
    "rejects %s",
    (input) => {
      expect(resolveGraphqlEndpoint(input)).toBeNull();
    },
  );
});

describe("PowerhouseReactorClient.probe", () => {
  it.effect("returns the first candidate that identifies as a reactor", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const connection = yield* withClient(
        reactorLayer(
          (request) =>
            request.url.startsWith("http://127.0.0.1:4001")
              ? json(SYSTEM_OK)
              : json({ errors: [{ message: "nope" }] }, 404),
          recorded,
        ),
        (client) =>
          client.probe([
            { url: "http://127.0.0.1:9999", source: "config" },
            { url: "http://127.0.0.1:4001", source: "default" },
          ]),
      );
      expect(connection.url).toBe("http://127.0.0.1:4001");
      expect(connection.source).toBe("default");
      expect(connection.system).toEqual({
        version: "6.2.2",
        gitHash: "abc123",
        gitUrl: null,
      });
      // Candidates are tried in order and stop at the first success.
      expect(recorded.map((entry) => entry.url)).toEqual([
        "http://127.0.0.1:9999/graphql",
        "http://127.0.0.1:4001/graphql",
      ]);
    }),
  );

  it.effect("does not retain credentials or query fragments in a successful connection", () =>
    Effect.gen(function* () {
      const connection = yield* withClient(
        reactorLayer(() => json(SYSTEM_OK)),
        (client) =>
          client.probe([
            {
              url: "http://user:secret@127.0.0.1:4001/?token=nope#fragment",
              source: "override",
            },
          ]),
      );
      expect(connection.url).toBe("http://127.0.0.1:4001");
    }),
  );

  it.effect("distinguishes a listener that is not a reactor from nothing listening", () =>
    Effect.gen(function* () {
      const notAReactor = yield* withClient(
        reactorLayer(() => new Response("OK", { status: 200 })),
        (client) => client.probe([{ url: "http://127.0.0.1:4001", source: "default" }]),
      ).pipe(Effect.flip);
      expect(notAReactor.failure).toBe("not_a_reactor");
      expect(notAReactor.attempted).toEqual(["http://127.0.0.1:4001"]);

      const unreachable = yield* withClient(
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.fail(
              new HttpClientError.HttpClientError({
                reason: new HttpClientError.TransportError({
                  request,
                  cause: new Error("ECONNREFUSED"),
                }),
              }),
            ),
          ),
        ),
        (client) => client.probe([{ url: "http://127.0.0.1:4001", source: "default" }]),
      ).pipe(Effect.flip);
      expect(unreachable.failure).toBe("unreachable");
      expect(unreachable.attempted).toEqual(["http://127.0.0.1:4001"]);
    }),
  );

  it.effect("reports an unparseable override URL as invalid_url", () =>
    Effect.gen(function* () {
      const error = yield* withClient(
        reactorLayer(() => json(SYSTEM_OK)),
        (client) => client.probe([{ url: "definitely not a url", source: "override" }]),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("invalid_url");
      expect(error.url).toBe("Invalid URL");
      expect(error.attempted).toEqual(["Invalid URL"]);
    }),
  );

  it.effect("treats a GraphQL error envelope as a listener that is not a reactor", () =>
    Effect.gen(function* () {
      const error = yield* withClient(
        reactorLayer(() => json({ errors: [{ message: "Unknown field system" }] })),
        (client) => client.probe([{ url: "http://127.0.0.1:4001", source: "default" }]),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("not_a_reactor");
    }),
  );

  it.effect("reports a listener timeout instead of relabeling it as unreachable", () =>
    withClient(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.never),
      ),
      (client) =>
        Effect.gen(function* () {
          const fiber = yield* client
            .probe([{ url: "http://127.0.0.1:4001", source: "default" }])
            .pipe(Effect.flip, Effect.forkChild);
          yield* TestClock.adjust("3 seconds");
          const error = yield* Fiber.join(fiber);
          expect(error.failure).toBe("timeout");
          expect(error.url).toBe("http://127.0.0.1:4001");
        }),
    ).pipe(Effect.provide(TestClock.layer())),
  );
});

describe("PowerhouseReactorClient.listDrives", () => {
  it.effect("merges both drive container types and follows cursors", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const drives = yield* withClient(
        reactorLayer((request) => {
          const isReactorDrive = request.body.includes("powerhouse/reactor-drive");
          if (isReactorDrive) {
            return json({ data: { findDocuments: { items: [document("r1")], cursor: null } } });
          }
          const isSecondPage = request.body.includes('"cursor":"page-2"');
          return json({
            data: {
              findDocuments: {
                items: [document(isSecondPage ? "d2" : "d1")],
                cursor: isSecondPage ? null : "page-2",
              },
            },
          });
        }, recorded),
        (client) => client.listDrives("http://127.0.0.1:4001"),
      );
      expect(drives.drives.map((drive) => drive.id)).toEqual(["d1", "d2", "r1"]);
      expect(drives.truncated).toBe(false);
      expect(recorded).toHaveLength(3);
    }),
  );

  it.effect("does not repeat a drive returned under both types", () =>
    Effect.gen(function* () {
      const drives = yield* withClient(
        reactorLayer(() =>
          json({ data: { findDocuments: { items: [document("d1")], cursor: null } } }),
        ),
        (client) => client.listDrives("http://127.0.0.1:4001"),
      );
      expect(drives.drives.map((drive) => drive.id)).toEqual(["d1"]);
      expect(drives.truncated).toBe(false);
    }),
  );

  it.effect("stops walking a reactor that never stops handing out cursors", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const drives = yield* withClient(
        reactorLayer(
          () =>
            json({
              data: { findDocuments: { items: [document("d1")], cursor: "always-more" } },
            }),
          recorded,
        ),
        (client) => client.listDrives("http://127.0.0.1:4001"),
      );
      // The repeated cursor stops both chains after the second page, and the
      // repeated id is only reported once.
      expect(recorded).toHaveLength(4);
      expect(drives.drives).toHaveLength(1);
      expect(drives.truncated).toBe(true);
    }),
  );
});

describe("PowerhouseReactorClient.listDocuments", () => {
  it.effect("passes the parent id through and returns the next cursor", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const page = yield* withClient(
        reactorLayer(
          () =>
            json({
              data: {
                findDocuments: {
                  items: [document("child-1", { documentType: "powerhouse/todo" })],
                  cursor: "next",
                },
              },
            }),
          recorded,
        ),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: { parentId: "drive-1" },
            limit: 25,
          }),
      );
      expect(page.documents[0]).toMatchObject({ id: "child-1", documentType: "powerhouse/todo" });
      expect(page.nextCursor).toBe("next");
      expect(recorded[0]?.body).toContain('"parentId":"drive-1"');
      expect(recorded[0]?.body).toContain('"limit":25');
    }),
  );

  it.effect("forwards every Switchboard filter and enforces identifiers on older resolvers", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const page = yield* withClient(
        reactorLayer(
          () =>
            json({
              data: {
                findDocuments: {
                  // Current Switchboard resolvers ignore `identifiers`, so the
                  // stand-in deliberately returns an extra parent child.
                  items: [
                    document("child-1", { documentType: "powerhouse/todo" }),
                    document("child-2", {
                      slug: "second-todo",
                      documentType: "powerhouse/todo",
                    }),
                  ],
                  cursor: null,
                },
              },
            }),
          recorded,
        ),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: {
              type: "powerhouse/todo",
              parentId: "drive-1",
              identifiers: ["second-todo"],
            },
            view: { branch: "staging", scopes: ["global", "local"] },
          }),
      );
      expect(page.documents.map((entry) => entry.id)).toEqual(["child-2"]);
      expect(recorded[0]?.body).toContain('"type":"powerhouse/todo"');
      expect(recorded[0]?.body).toContain('"parentId":"drive-1"');
      expect(recorded[0]?.body).toContain('"identifiers":["second-todo"]');
      expect(recorded[0]?.body).toContain('"branch":"staging"');
      expect(recorded[0]?.body).toContain('"scopes":["global","local"]');
    }),
  );

  it.effect("resolves identifier-only searches without fetching document state", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const page = yield* withClient(
        reactorLayer((request) => {
          const body = JSON.parse(request.body) as {
            variables: { identifier?: string | undefined };
          };
          const identifier = body.variables.identifier;
          if (identifier === "missing") return json({ data: { document: null } });
          return json({
            data: {
              document: {
                document: document(identifier ?? "unknown", {
                  slug: identifier,
                  documentType: "powerhouse/todo",
                }),
              },
            },
          });
        }, recorded),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: {
              type: "powerhouse/todo",
              identifiers: ["todo-a", "missing", "todo-a", "todo-b"],
            },
            view: { branch: "preview", scopes: ["global"] },
          }),
      );
      expect(page.documents.map((entry) => entry.id)).toEqual(["todo-a", "todo-b"]);
      expect(recorded).toHaveLength(3);
      expect(recorded.every((entry) => !entry.body.includes("preferredEditor"))).toBe(true);
      expect(recorded.every((entry) => entry.body.includes('"branch":"preview"'))).toBe(true);
    }),
  );

  it.effect("rejects an empty search before contacting the reactor", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const error = yield* withClient(
        reactorLayer(
          () => json({ data: { findDocuments: { items: [], cursor: null } } }),
          recorded,
        ),
        (client) =>
          client.listDocuments({ url: "http://127.0.0.1:4001", search: {} }).pipe(Effect.flip),
      );
      expect(error.failure).toBe("graphql_error");
      expect(recorded).toHaveLength(0);
    }),
  );

  it.effect("clamps an oversized page limit to the listing bound", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      yield* withClient(
        reactorLayer(
          () => json({ data: { findDocuments: { items: [], cursor: null } } }),
          recorded,
        ),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: { parentId: "drive-1" },
            limit: 5_000,
          }),
      );
      expect(recorded[0]?.body).toContain('"limit":500');
    }),
  );

  it.effect("asks for the whole listing when the caller names no limit", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const page = yield* withClient(
        reactorLayer(
          () => json({ data: { findDocuments: { items: [document("child-1")], cursor: null } } }),
          recorded,
        ),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: { parentId: "drive-1" },
          }),
      );
      expect(recorded[0]?.body).toContain('"limit":500');
      expect(page.truncated).toBe(false);
    }),
  );

  it.effect("reports truncation when a full listing offers no cursor to follow", () =>
    Effect.gen(function* () {
      const page = yield* withClient(
        reactorLayer(() =>
          json({
            data: {
              findDocuments: {
                items: [document("one"), document("two")],
                // findDocuments never issues a cursor, even having capped the result.
                cursor: null,
              },
            },
          }),
        ),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: { parentId: "drive-1" },
            limit: 2,
          }),
      );
      expect(page.documents).toHaveLength(2);
      expect(page.truncated).toBe(true);
    }),
  );

  it.effect("is not truncated when a full page hands back a cursor", () =>
    Effect.gen(function* () {
      const page = yield* withClient(
        reactorLayer(() =>
          json({
            data: {
              findDocuments: { items: [document("one"), document("two")], cursor: "next" },
            },
          }),
        ),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: { parentId: "drive-1" },
            limit: 2,
          }),
      );
      expect(page.nextCursor).toBe("next");
      expect(page.truncated).toBe(false);
    }),
  );

  it.effect("ends pagination when a reactor repeats the requested cursor", () =>
    Effect.gen(function* () {
      const page = yield* withClient(
        reactorLayer(() =>
          json({ data: { findDocuments: { items: [document("child-1")], cursor: "same" } } }),
        ),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: { parentId: "drive-1" },
            cursor: "same",
          }),
      );
      expect(page.nextCursor).toBeNull();
    }),
  );

  it.effect("rejects a reactor page larger than the requested limit", () =>
    Effect.gen(function* () {
      const error = yield* withClient(
        reactorLayer(() =>
          json({
            data: {
              findDocuments: { items: [document("one"), document("two")], cursor: null },
            },
          }),
        ),
        (client) =>
          client.listDocuments({
            url: "http://127.0.0.1:4001",
            search: { parentId: "drive-1" },
            limit: 1,
          }),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("decode_failed");
    }),
  );
});

describe("PowerhouseReactorClient.getDocument", () => {
  const documentPayload = (state: unknown) => ({
    data: {
      document: {
        document: {
          ...document("doc-1", { documentType: "powerhouse/todo" }),
          preferredEditor: "todo-editor",
          state,
          revisionsList: [{ scope: "global", revision: 7 }],
        },
        childIds: ["child-1"],
      },
    },
  });

  it.effect("returns state, revisions, and children", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const result = yield* withClient(
        reactorLayer(() => json(documentPayload({ items: [1, 2, 3] })), recorded),
        (client) =>
          client.getDocument({
            url: "http://127.0.0.1:4001",
            documentId: "doc-1",
            view: { branch: "preview", scopes: ["global"] },
          }),
      );
      expect(result.state).toEqual({ items: [1, 2, 3] });
      expect(result.stateTruncated).toBe(false);
      expect(result.revisions).toEqual([{ scope: "global", revision: 7 }]);
      expect(result.revisionsTruncated).toBe(false);
      expect(result.childIds).toEqual(["child-1"]);
      expect(result.childIdsTruncated).toBe(false);
      expect(result.preferredEditor).toBe("todo-editor");
      expect(recorded[0]?.body).toContain('"view":{"branch":"preview","scopes":["global"]}');
    }),
  );

  it.effect("drops a state too large to put on the client websocket", () =>
    Effect.gen(function* () {
      const result = yield* withClient(
        reactorLayer(() => json(documentPayload({ blob: "x".repeat(600 * 1024) }))),
        (client) => client.getDocument({ url: "http://127.0.0.1:4001", documentId: "doc-1" }),
      );
      expect(result.stateTruncated).toBe(true);
      expect(result.state).toBeNull();
    }),
  );

  it.effect("measures the state guard in UTF-8 bytes", () =>
    Effect.gen(function* () {
      const result = yield* withClient(
        reactorLayer(() => json(documentPayload({ blob: "🙂".repeat(150 * 1024) }))),
        (client) => client.getDocument({ url: "http://127.0.0.1:4001", documentId: "doc-1" }),
      );
      expect(result.stateTruncated).toBe(true);
      expect(result.state).toBeNull();
    }),
  );

  it.effect("reports an unknown document rather than returning an empty one", () =>
    Effect.gen(function* () {
      const error = yield* withClient(
        reactorLayer(() => json({ data: { document: null } })),
        (client) => client.getDocument({ url: "http://127.0.0.1:4001", documentId: "nope" }),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("graphql_error");
    }),
  );
});

describe("PowerhouseReactorClient.getOperations", () => {
  it.effect("lifts action fields out of the nested action object", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const result = yield* withClient(
        reactorLayer(
          () =>
            json({
              data: {
                documentOperations: {
                  items: [
                    {
                      index: 3,
                      timestampUtcMs: "1767225600000",
                      hash: "deadbeef",
                      skip: 0,
                      error: null,
                      action: {
                        type: "ADD_TODO",
                        input: { text: "write the panel" },
                        scope: "global",
                        context: { signer: { user: { address: "0xabc" }, app: null } },
                      },
                    },
                  ],
                  cursor: "next-ops",
                },
              },
            }),
          recorded,
        ),
        (client) =>
          client.getOperations({
            url: "http://127.0.0.1:4001",
            documentId: "doc-1",
            view: { branch: "preview", scopes: ["global"] },
          }),
      );
      expect(result.operations[0]).toEqual({
        index: 3,
        timestampUtcMs: "1767225600000",
        hash: "deadbeef",
        skip: 0,
        error: null,
        actionType: "ADD_TODO",
        actionInput: { text: "write the panel" },
        actionInputTruncated: false,
        scope: "global",
        signer: "0xabc",
      });
      expect(result.nextCursor).toBe("next-ops");
      expect(recorded[0]?.body).toContain(
        '"filter":{"documentId":"doc-1","branch":"preview","scopes":["global"]}',
      );
    }),
  );

  it.effect("falls back to the app name when no user signed", () =>
    Effect.gen(function* () {
      const result = yield* withClient(
        reactorLayer(() =>
          json({
            data: {
              documentOperations: {
                items: [
                  {
                    index: 0,
                    timestampUtcMs: "1",
                    hash: "h",
                    skip: 0,
                    action: {
                      type: "NOOP",
                      input: {},
                      scope: "global",
                      context: { signer: { user: null, app: { name: "connect" } } },
                    },
                  },
                ],
                cursor: null,
              },
            },
          }),
        ),
        (client) => client.getOperations({ url: "http://127.0.0.1:4001", documentId: "doc-1" }),
      );
      expect(result.operations[0]?.signer).toBe("connect");
      expect(result.nextCursor).toBeNull();
    }),
  );

  it.effect("ends operation pagination when the reactor repeats the requested cursor", () =>
    Effect.gen(function* () {
      const result = yield* withClient(
        reactorLayer(() => json({ data: { documentOperations: { items: [], cursor: "same" } } })),
        (client) =>
          client.getOperations({
            url: "http://127.0.0.1:4001",
            documentId: "doc-1",
            cursor: "same",
          }),
      );
      expect(result.nextCursor).toBeNull();
    }),
  );

  it.effect("tolerates an operation with no action at all", () =>
    Effect.gen(function* () {
      const result = yield* withClient(
        reactorLayer(() =>
          json({
            data: {
              documentOperations: {
                items: [{ index: 1, timestampUtcMs: "1", hash: "h", skip: 0 }],
                cursor: null,
              },
            },
          }),
        ),
        (client) => client.getOperations({ url: "http://127.0.0.1:4001", documentId: "doc-1" }),
      );
      expect(result.operations[0]).toMatchObject({
        index: 1,
        actionType: null,
        actionInput: null,
        actionInputTruncated: false,
        signer: null,
      });
    }),
  );

  it.effect("drops an operation input too large for the client websocket", () =>
    Effect.gen(function* () {
      const result = yield* withClient(
        reactorLayer(() =>
          json({
            data: {
              documentOperations: {
                items: [
                  {
                    index: 1,
                    action: {
                      type: "IMPORT",
                      input: { text: "x".repeat(300 * 1024) },
                      scope: "global",
                    },
                  },
                ],
                cursor: null,
              },
            },
          }),
        ),
        (client) => client.getOperations({ url: "http://127.0.0.1:4001", documentId: "doc-1" }),
      );
      expect(result.operations[0]?.actionInput).toBeNull();
      expect(result.operations[0]?.actionInputTruncated).toBe(true);
    }),
  );

  it.effect("bounds retained operation inputs across the whole page", () =>
    Effect.gen(function* () {
      const items = [0, 1, 2].map((index) => ({
        index,
        action: {
          type: "IMPORT",
          input: { text: "x".repeat(200 * 1024) },
          scope: "global",
        },
      }));
      const result = yield* withClient(
        reactorLayer(() => json({ data: { documentOperations: { items, cursor: null } } })),
        (client) => client.getOperations({ url: "http://127.0.0.1:4001", documentId: "doc-1" }),
      );
      expect(result.operations.map((operation) => operation.actionInputTruncated)).toEqual([
        false,
        false,
        true,
      ]);
    }),
  );
});

describe("PowerhouseReactorClient.executeGraphql", () => {
  it.effect(
    "forwards operation data and authentication headers without hiding GraphQL errors",
    () =>
      Effect.gen(function* () {
        const recorded: Array<RecordedRequest> = [];
        const result = yield* withClient(
          reactorLayer(
            () => json({ data: { updateDocument: null }, errors: [{ message: "Rejected" }] }),
            recorded,
          ),
          (client) =>
            client.executeGraphql({
              url: "http://127.0.0.1:4001",
              query: "mutation Rename($name: String!) { updateDocument(name: $name) }",
              operationName: "Rename",
              variablesJson: JSON.stringify({ name: "Roadmap" }),
              headers: {
                Authorization: "Bearer renown-token",
                "X-Powerhouse-Client": "Switchboard",
              },
            }),
        );

        expect(result).toEqual({
          status: 200,
          response: { data: { updateDocument: null }, errors: [{ message: "Rejected" }] },
        });
        expect(decodeUnknownJson(recorded[0]?.body ?? "{}")).toEqual({
          query: "mutation Rename($name: String!) { updateDocument(name: $name) }",
          operationName: "Rename",
          variables: { name: "Roadmap" },
        });
        expect(recorded[0]?.headers.authorization).toBe("Bearer renown-token");
        expect(recorded[0]?.headers["x-powerhouse-client"]).toBe("Switchboard");
      }),
  );

  it.effect("retains control of transport headers", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      yield* withClient(
        reactorLayer(() => json({ data: { system: {} } }), recorded),
        (client) =>
          client.executeGraphql({
            url: "http://127.0.0.1:4001",
            query: "{ system { version } }",
            headers: {
              Accept: "text/html",
              Host: "elsewhere.example",
              "Content-Type": "text/plain",
              Cookie: "session=renown",
            },
          }),
      );

      expect(recorded[0]?.headers.accept).toBe(
        "application/graphql-response+json, application/json",
      );
      expect(recorded[0]?.headers.host).toBeUndefined();
      expect(recorded[0]?.headers["content-type"]).toBe("application/json");
      expect(recorded[0]?.headers.cookie).toBe("session=renown");
    }),
  );

  it.effect("rejects malformed variables before contacting the reactor", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const error = yield* withClient(
        reactorLayer(() => json({ data: {} }), recorded),
        (client) =>
          client.executeGraphql({
            url: "http://127.0.0.1:4001",
            query: "{ system { version } }",
            variablesJson: "{broken",
          }),
      ).pipe(Effect.flip);

      expect(error.failure).toBe("invalid_request");
      expect(recorded).toEqual([]);
    }),
  );
});

describe("PowerhouseReactorClient failures", () => {
  it.effect("classifies a non-2xx response as http_error with its status", () =>
    Effect.gen(function* () {
      const error = yield* withClient(
        reactorLayer(() => new Response("nope", { status: 503 })),
        (client) => client.listDrives("http://127.0.0.1:4001"),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("http_error");
      expect(error.status).toBe(503);
    }),
  );

  it.effect("does not echo URL credentials or query fragments in failures", () =>
    Effect.gen(function* () {
      const error = yield* withClient(
        reactorLayer(() => new Response("nope", { status: 503 })),
        (client) => client.listDrives("http://user:secret@127.0.0.1:4001/?token=nope#fragment"),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("http_error");
      expect(error.url).toBe("http://127.0.0.1:4001");
    }),
  );

  it.effect("surfaces GraphQL error messages", () =>
    Effect.gen(function* () {
      const error = yield* withClient(
        reactorLayer(() => json({ errors: [{ message: "Unauthorized" }] })),
        (client) => client.listDrives("http://127.0.0.1:4001"),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("graphql_error");
      expect(error.graphqlMessages).toEqual(["Unauthorized"]);
    }),
  );

  it.effect("classifies an unreadable body as decode_failed", () =>
    Effect.gen(function* () {
      const error = yield* withClient(
        reactorLayer(() => new Response("<html>not graphql</html>", { status: 200 })),
        (client) => client.listDrives("http://127.0.0.1:4001"),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("decode_failed");
    }),
  );

  it.effect("rejects a non-http URL before making any request", () =>
    Effect.gen(function* () {
      const recorded: Array<RecordedRequest> = [];
      const error = yield* withClient(
        reactorLayer(() => json(SYSTEM_OK), recorded),
        (client) => client.listDrives("file:///etc/passwd"),
      ).pipe(Effect.flip);
      expect(error.failure).toBe("invalid_url");
      expect(recorded).toEqual([]);
    }),
  );
});
