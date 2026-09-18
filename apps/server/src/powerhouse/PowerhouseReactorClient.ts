/**
 * PowerhouseReactorClient - server-side GraphQL client for a Powerhouse reactor.
 *
 * Explorer uses its bounded fixed queries; Switchboard uses the general
 * execution method. Both run here because the reactor listens on the machine
 * that hosts the Vetra server, which on a remote, relay, or tunnel connection
 * is not the machine the browser is on.
 *
 * @module PowerhouseReactorClient
 */
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpBody, HttpClient } from "effect/unstable/http";

import {
  type PowerhouseGraphqlHeaders,
  type PowerhouseReactorConnection,
  PowerhouseReactorDocument,
  PowerhouseReactorDocumentRevision,
  type PowerhouseReactorDocumentSearchFilter,
  PowerhouseReactorDocumentSummary,
  type PowerhouseReactorDocumentViewFilter,
  PowerhouseReactorError,
  PowerhouseReactorExecuteGraphqlResult,
  type PowerhouseReactorGetOperationsResult,
  PowerhouseReactorOperation,
  type PowerhouseReactorListDrivesResult,
  PowerhouseReactorCursor,
  PowerhouseReactorIdentifier,
  type PowerhouseReactorListDocumentsResult,
  PowerhouseReactorSystemInfo,
} from "@t3tools/contracts";

import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";

/** Documents of these types are drives; the reactor has no drive-listing query. */
const DRIVE_DOCUMENT_TYPES = ["powerhouse/document-drive", "powerhouse/reactor-drive"] as const;

const REQUEST_TIMEOUT = Duration.seconds(10);
const SWITCHBOARD_REQUEST_TIMEOUT = Duration.seconds(30);
/** A probe races the panel's first paint, so it gives up well before a data call would. */
const PROBE_TIMEOUT = Duration.seconds(3);
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
/**
 * Document state is unbounded JSON and every byte crosses the client
 * websocket. Past this the panel says the state was too large instead.
 */
const MAX_STATE_BYTES = 512 * 1024;
const MAX_OPERATION_INPUT_BYTES = 256 * 1024;
const MAX_OPERATION_PAGE_INPUT_BYTES = 512 * 1024;
const MAX_PAGE_LIMIT = 100;
const MAX_DOCUMENT_REVISIONS = 100;
const MAX_CHILD_IDS = 500;
/** Drives are few; this only bounds a reactor that never stops handing out cursors. */
const MAX_DRIVE_PAGES = 10;
/**
 * Documents returned for one search. `findDocuments` honours `limit` but never
 * issues a cursor, so this is the whole listing rather than a page of one, and
 * a larger matching set reports itself truncated.
 */
const MAX_DOCUMENTS = 500;
const MAX_DRIVES = 500;
const UTF8_ENCODER = new TextEncoder();

export interface PowerhouseReactorCandidate {
  readonly url: string;
  readonly source: PowerhouseReactorConnection["source"];
}

/** Service tag for reactor access. General execution is operate-scoped at the RPC boundary. */
export class PowerhouseReactorClient extends Context.Service<
  PowerhouseReactorClient,
  {
    /**
     * Try each candidate in order and return the first that answers with a
     * reactor's system fingerprint. Fails with `not_a_reactor` when something
     * answered but did not identify, and `unreachable` when nothing answered.
     */
    readonly probe: (
      candidates: ReadonlyArray<PowerhouseReactorCandidate>,
    ) => Effect.Effect<PowerhouseReactorConnection, PowerhouseReactorError>;
    readonly listDrives: (
      url: string,
    ) => Effect.Effect<PowerhouseReactorListDrivesResult, PowerhouseReactorError>;
    readonly listDocuments: (input: {
      readonly url: string;
      readonly search: PowerhouseReactorDocumentSearchFilter;
      readonly view?: PowerhouseReactorDocumentViewFilter | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }) => Effect.Effect<PowerhouseReactorListDocumentsResult, PowerhouseReactorError>;
    readonly getDocument: (input: {
      readonly url: string;
      readonly documentId: string;
      readonly view?: PowerhouseReactorDocumentViewFilter | undefined;
    }) => Effect.Effect<PowerhouseReactorDocument, PowerhouseReactorError>;
    readonly getOperations: (input: {
      readonly url: string;
      readonly documentId: string;
      readonly view?: PowerhouseReactorDocumentViewFilter | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }) => Effect.Effect<PowerhouseReactorGetOperationsResult, PowerhouseReactorError>;
    readonly executeGraphql: (input: {
      readonly url: string;
      readonly query: string;
      readonly operationName?: string | undefined;
      readonly variablesJson?: string | undefined;
      readonly headers?: PowerhouseGraphqlHeaders | undefined;
    }) => Effect.Effect<PowerhouseReactorExecuteGraphqlResult, PowerhouseReactorError>;
  }
>()("t3/powerhouse/PowerhouseReactorClient") {}

/** Safe, canonical base URL retained in connection results and later requests. */
export function normalizeReactorBaseUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const serialized = parsed.toString();
  return parsed.pathname === "/" ? serialized.slice(0, -1) : serialized;
}

/**
 * Normalize a caller-supplied base URL into the reactor's GraphQL endpoint.
 *
 * Only http and https are accepted, and credentials are dropped rather than
 * forwarded. A trailing `/graphql` in the input is tolerated so a URL copied
 * out of a browser address bar works.
 */
export function resolveGraphqlEndpoint(url: string): string | null {
  const baseUrl = normalizeReactorBaseUrl(url);
  if (baseUrl === null) return null;
  const parsed = new URL(baseUrl);
  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = basePath.endsWith("/graphql") ? basePath : `${basePath}/graphql`;
  return parsed.toString();
}

// GraphQL response shapes. Kept permissive on purpose: the reactor ships
// independently of Vetra Code, so unread fields must not break decoding.
const GraphqlError = Schema.Struct({
  message: Schema.optional(PowerhouseReactorOperation.fields.error),
});

const graphqlEnvelope = <A extends Schema.Top>(data: A) =>
  Schema.Struct({
    data: Schema.optional(Schema.NullOr(data)),
    errors: Schema.optional(Schema.Array(GraphqlError)),
  });

const RawSystemInfo = Schema.Struct({
  version: Schema.optional(PowerhouseReactorSystemInfo.fields.version),
  gitHash: Schema.optional(PowerhouseReactorSystemInfo.fields.gitHash),
  gitUrl: Schema.optional(PowerhouseReactorSystemInfo.fields.gitUrl),
});

const RawSystemQuery = Schema.Struct({ system: RawSystemInfo });

const RawDocument = Schema.Struct({
  id: PowerhouseReactorIdentifier,
  slug: Schema.optional(PowerhouseReactorDocumentSummary.fields.slug),
  name: Schema.optional(PowerhouseReactorDocumentSummary.fields.name),
  documentType: Schema.optional(
    Schema.NullOr(PowerhouseReactorDocumentSummary.fields.documentType),
  ),
  createdAtUtcIso: Schema.optional(PowerhouseReactorDocumentSummary.fields.createdAtUtcIso),
  lastModifiedAtUtcIso: Schema.optional(
    PowerhouseReactorDocumentSummary.fields.lastModifiedAtUtcIso,
  ),
});

const RawDocumentPage = Schema.Struct({
  items: Schema.Array(RawDocument),
  cursor: Schema.optional(Schema.NullOr(PowerhouseReactorCursor)),
});

const RawFindDocumentsQuery = Schema.Struct({ findDocuments: RawDocumentPage });

const RawDocumentSummaryQuery = Schema.Struct({
  document: Schema.NullOr(Schema.Struct({ document: RawDocument })),
});

const RawDocumentDetail = Schema.Struct({
  ...RawDocument.fields,
  preferredEditor: Schema.optional(PowerhouseReactorDocument.fields.preferredEditor),
  state: Schema.optional(Schema.Unknown),
  revisionsList: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          scope: Schema.optional(Schema.NullOr(PowerhouseReactorDocumentRevision.fields.scope)),
          revision: Schema.optional(Schema.NullOr(Schema.Int)),
        }),
      ),
    ),
  ),
});

const RawDocumentQuery = Schema.Struct({
  document: Schema.NullOr(
    Schema.Struct({
      document: RawDocumentDetail,
      childIds: Schema.optional(Schema.NullOr(Schema.Array(PowerhouseReactorIdentifier))),
    }),
  ),
});

const RawOperation = Schema.Struct({
  index: Schema.optional(Schema.NullOr(Schema.Int)),
  timestampUtcMs: Schema.optional(PowerhouseReactorOperation.fields.timestampUtcMs),
  hash: Schema.optional(PowerhouseReactorOperation.fields.hash),
  skip: Schema.optional(Schema.NullOr(Schema.Int)),
  error: Schema.optional(PowerhouseReactorOperation.fields.error),
  action: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        type: Schema.optional(PowerhouseReactorOperation.fields.actionType),
        input: Schema.optional(Schema.Unknown),
        scope: Schema.optional(PowerhouseReactorOperation.fields.scope),
        context: Schema.optional(
          Schema.NullOr(
            Schema.Struct({
              signer: Schema.optional(
                Schema.NullOr(
                  Schema.Struct({
                    user: Schema.optional(
                      Schema.NullOr(
                        Schema.Struct({
                          address: Schema.optional(PowerhouseReactorOperation.fields.signer),
                        }),
                      ),
                    ),
                    app: Schema.optional(
                      Schema.NullOr(
                        Schema.Struct({
                          name: Schema.optional(PowerhouseReactorOperation.fields.signer),
                        }),
                      ),
                    ),
                  }),
                ),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
});

const RawOperationsQuery = Schema.Struct({
  documentOperations: Schema.Struct({
    items: Schema.Array(RawOperation),
    cursor: Schema.optional(Schema.NullOr(PowerhouseReactorCursor)),
  }),
});

const SYSTEM_QUERY = "query VetraPowerhouseSystem { system { version gitHash gitUrl } }";

const DOCUMENT_SUMMARY_FIELDS = "id slug name documentType createdAtUtcIso lastModifiedAtUtcIso";

const FIND_DOCUMENTS_QUERY = `query VetraPowerhouseFindDocuments($search: SearchFilterInput, $view: ViewFilterInput, $paging: PagingInput) {
  findDocuments(search: $search, view: $view, paging: $paging) {
    items { ${DOCUMENT_SUMMARY_FIELDS} }
    cursor
  }
}`;

const DOCUMENT_SUMMARY_QUERY = `query VetraPowerhouseDocumentSummary($identifier: String!, $view: ViewFilterInput) {
  document(identifier: $identifier, view: $view) {
    document { ${DOCUMENT_SUMMARY_FIELDS} }
  }
}`;

const DOCUMENT_QUERY = `query VetraPowerhouseDocument($identifier: String!, $view: ViewFilterInput) {
  document(identifier: $identifier, view: $view) {
    document {
      ${DOCUMENT_SUMMARY_FIELDS}
      preferredEditor
      state
      revisionsList { scope revision }
    }
    childIds
  }
}`;

const OPERATIONS_QUERY = `query VetraPowerhouseOperations($filter: OperationsFilterInput!, $paging: PagingInput) {
  documentOperations(filter: $filter, paging: $paging) {
    items {
      index timestampUtcMs hash skip error
      action { type input scope context { signer { user { address } app { name } } } }
    }
    cursor
  }
}`;

/** UTF-8 byte length on the wire, used only to decide whether a payload is too big to send. */
function serializedByteSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 0 : UTF8_ENCODER.encode(serialized).byteLength;
}

const clampLimit = (limit: number | undefined) =>
  limit === undefined ? MAX_PAGE_LIMIT : Math.max(1, Math.min(MAX_PAGE_LIMIT, limit));

const clampDocumentLimit = (limit: number | undefined) =>
  limit === undefined ? MAX_DOCUMENTS : Math.max(1, Math.min(MAX_DOCUMENTS, limit));

const toSummary = (raw: typeof RawDocument.Type): PowerhouseReactorDocumentSummary => ({
  id: raw.id,
  slug: raw.slug ?? null,
  name: raw.name ?? null,
  documentType: raw.documentType ?? "",
  createdAtUtcIso: raw.createdAtUtcIso ?? null,
  lastModifiedAtUtcIso: raw.lastModifiedAtUtcIso ?? null,
});

const NON_FORWARDABLE_GRAPHQL_HEADERS = new Set([
  "accept",
  "connection",
  "content-length",
  "content-type",
  "host",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Keep authentication headers while retaining control of the HTTP transport itself. */
function forwardGraphqlHeaders(
  headers: PowerhouseGraphqlHeaders | undefined,
): Record<string, string> {
  const forwarded: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers ?? {})) {
    const name = rawName.trim().toLowerCase();
    if (NON_FORWARDABLE_GRAPHQL_HEADERS.has(name)) continue;
    forwarded[name] = value;
  }
  return forwarded;
}

const GraphqlVariablesJson = Schema.fromJsonString(Schema.Unknown);
const GraphqlResponseJson = Schema.fromJsonString(
  PowerhouseReactorExecuteGraphqlResult.fields.response,
);
const decodeGraphqlVariablesJson = Schema.decodeEffect(GraphqlVariablesJson);
const decodeGraphqlResponseJson = Schema.decodeEffect(GraphqlResponseJson);

export const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;

  /**
   * Post one GraphQL document and collect its bounded response body.
   * `timeout` covers the body as well as the connection: a reactor can send
   * headers and then stall on a large document.
   */
  const postGraphql = (input: {
    readonly url: string;
    readonly query: string;
    readonly operationName?: string | undefined;
    readonly variables?: unknown;
    readonly headers?: PowerhouseGraphqlHeaders | undefined;
    readonly timeout: Duration.Duration;
  }): Effect.Effect<
    { readonly safeUrl: string; readonly status: number; readonly text: string },
    PowerhouseReactorError
  > =>
    Effect.gen(function* () {
      const safeUrl = normalizeReactorBaseUrl(input.url);
      const endpoint = resolveGraphqlEndpoint(input.url);
      if (endpoint === null || safeUrl === null) {
        // Do not reflect an invalid value: it may contain credentials even
        // though it was rejected before a request was made.
        return yield* new PowerhouseReactorError({ failure: "invalid_url" });
      }
      const response = yield* httpClient
        .post(endpoint, {
          headers: {
            ...forwardGraphqlHeaders(input.headers),
            accept: "application/graphql-response+json, application/json",
          },
          body: HttpBody.jsonUnsafe({
            query: input.query,
            ...(input.operationName === undefined ? {} : { operationName: input.operationName }),
            ...(input.variables === undefined ? {} : { variables: input.variables }),
          }),
        })
        .pipe(
          Effect.mapError(
            (cause) => new PowerhouseReactorError({ failure: "unreachable", url: safeUrl, cause }),
          ),
        );
      // Read the body before branching on status: an error response carries the
      // reason, and a reactor answering a huge document must not be buffered
      // without a ceiling.
      const collected = yield* collectUint8StreamText({
        stream: response.stream,
        maxBytes: MAX_RESPONSE_BYTES,
      }).pipe(
        Effect.mapError(
          (cause) => new PowerhouseReactorError({ failure: "decode_failed", url: safeUrl, cause }),
        ),
      );
      if (collected.truncated || collected.invalidUtf8) {
        return yield* new PowerhouseReactorError({ failure: "decode_failed", url: safeUrl });
      }
      return { safeUrl, status: response.status, text: collected.text };
    }).pipe(
      Effect.timeoutOrElse({
        duration: input.timeout,
        orElse: () => {
          const timeoutUrl = normalizeReactorBaseUrl(input.url);
          return Effect.fail(
            new PowerhouseReactorError({
              failure: "timeout",
              ...(timeoutUrl === null ? {} : { url: timeoutUrl }),
            }),
          );
        },
      }),
    );

  /** Run a fixed inspector query and decode its successful data payload. */
  const gql = <A extends Schema.Codec<unknown, unknown, never, never>>(input: {
    readonly url: string;
    readonly query: string;
    readonly variables: Record<string, unknown>;
    readonly schema: A;
    readonly timeout: Duration.Duration;
  }): Effect.Effect<A["Type"], PowerhouseReactorError> =>
    Effect.gen(function* () {
      const result = yield* postGraphql(input);
      if (result.status < 200 || result.status >= 300) {
        return yield* new PowerhouseReactorError({
          failure: "http_error",
          url: result.safeUrl,
          status: result.status,
        });
      }
      const envelope = yield* Schema.decodeEffect(
        Schema.fromJsonString(graphqlEnvelope(input.schema)),
      )(result.text).pipe(
        Effect.mapError(
          (cause) =>
            new PowerhouseReactorError({
              failure: "decode_failed",
              url: result.safeUrl,
              cause,
            }),
        ),
      );
      const errors = envelope.errors ?? [];
      if (errors.length > 0) {
        return yield* new PowerhouseReactorError({
          failure: "graphql_error",
          url: result.safeUrl,
          graphqlMessages: errors.slice(0, 10).map((error) => error.message ?? "Unknown error"),
        });
      }
      if (envelope.data === undefined || envelope.data === null) {
        return yield* new PowerhouseReactorError({
          failure: "decode_failed",
          url: result.safeUrl,
        });
      }
      return envelope.data;
    });

  const probeCandidate = (
    candidate: PowerhouseReactorCandidate,
  ): Effect.Effect<PowerhouseReactorSystemInfo, PowerhouseReactorError> =>
    gql({
      url: candidate.url,
      query: SYSTEM_QUERY,
      variables: {},
      schema: RawSystemQuery,
      timeout: PROBE_TIMEOUT,
    }).pipe(
      Effect.map((data) => ({
        version: data.system.version ?? null,
        gitHash: data.system.gitHash ?? null,
        gitUrl: data.system.gitUrl ?? null,
      })),
    );

  const probe: PowerhouseReactorClient["Service"]["probe"] = Effect.fn(
    "PowerhouseReactorClient.probe",
  )(function* (candidates) {
    const attempted: Array<string> = [];
    // Anything that answered at all, even wrongly, changes "nothing is running"
    // into "that is not a reactor" — a different thing to tell the user.
    let listenerUrl: string | undefined;
    let timeoutUrl: string | undefined;
    let invalidUrlOnly = candidates.length > 0;
    for (const candidate of candidates) {
      const attemptedUrl = normalizeReactorBaseUrl(candidate.url) ?? "Invalid URL";
      attempted.push(attemptedUrl);
      const result = yield* Effect.result(probeCandidate(candidate));
      if (result._tag === "Success") {
        return {
          url: attemptedUrl,
          source: candidate.source,
          system: result.success,
        };
      }
      const failure = result.failure.failure;
      if (failure !== "invalid_url") {
        invalidUrlOnly = false;
      }
      if (failure === "http_error" || failure === "graphql_error" || failure === "decode_failed") {
        listenerUrl ??= attemptedUrl;
      }
      if (failure === "timeout") {
        timeoutUrl ??= attemptedUrl;
      }
    }
    if (invalidUrlOnly) {
      return yield* new PowerhouseReactorError({
        failure: "invalid_url",
        ...(attempted[0] ? { url: attempted[0] } : {}),
        attempted,
      });
    }
    if (listenerUrl !== undefined) {
      return yield* new PowerhouseReactorError({
        failure: "not_a_reactor",
        url: listenerUrl,
        attempted,
      });
    }
    if (timeoutUrl !== undefined) {
      return yield* new PowerhouseReactorError({
        failure: "timeout",
        url: timeoutUrl,
        attempted,
      });
    }
    return yield* new PowerhouseReactorError({
      failure: "unreachable",
      ...(attempted[0] ? { url: attempted[0] } : {}),
      attempted,
    });
  });

  const findDocuments = (input: {
    readonly url: string;
    readonly search: PowerhouseReactorDocumentSearchFilter;
    readonly view?: PowerhouseReactorDocumentViewFilter | undefined;
    readonly cursor?: string | undefined;
    readonly limit: number;
  }) =>
    gql({
      url: input.url,
      query: FIND_DOCUMENTS_QUERY,
      variables: {
        search: input.search,
        ...(input.view === undefined ? {} : { view: input.view }),
        paging: {
          limit: input.limit,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        },
      },
      schema: RawFindDocumentsQuery,
      timeout: REQUEST_TIMEOUT,
    }).pipe(
      Effect.flatMap((data) => {
        if (data.findDocuments.items.length > input.limit) {
          return new PowerhouseReactorError({
            failure: "decode_failed",
            url: input.url,
            cause: new Error("Reactor returned more documents than requested."),
          });
        }
        const nextCursor = data.findDocuments.cursor ?? null;
        const cursorRepeated = nextCursor !== null && nextCursor === input.cursor;
        return Effect.succeed({
          documents: data.findDocuments.items.map(toSummary),
          // A broken reactor can hand back the cursor it was just given. Treat
          // that as the end instead of leaving the UI's Load more button stuck.
          nextCursor: cursorRepeated ? null : nextCursor,
          cursorRepeated,
        });
      }),
    );

  /**
   * Resolve one exact identifier without fetching its unbounded state. The
   * current Switchboard schema advertises `SearchFilterInput.identifiers`, but
   * its resolver drops that field, so identifier-only searches use the stable
   * `document(identifier:)` lookup until the resolver catches up.
   */
  const findDocumentSummary = Effect.fn("PowerhouseReactorClient.findDocumentSummary")(
    function* (input: {
      readonly url: string;
      readonly identifier: string;
      readonly view?: PowerhouseReactorDocumentViewFilter | undefined;
    }) {
      const data = yield* gql({
        url: input.url,
        query: DOCUMENT_SUMMARY_QUERY,
        variables: {
          identifier: input.identifier,
          ...(input.view === undefined ? {} : { view: input.view }),
        },
        schema: RawDocumentSummaryQuery,
        timeout: REQUEST_TIMEOUT,
      });
      return data.document === null ? null : toSummary(data.document.document);
    },
  );

  const findDrivesByType = Effect.fn("PowerhouseReactorClient.findDrivesByType")(function* (
    url: string,
    documentType: (typeof DRIVE_DOCUMENT_TYPES)[number],
  ) {
    const drives: Array<PowerhouseReactorDocumentSummary> = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_DRIVE_PAGES; page += 1) {
      const result = yield* findDocuments({
        url,
        search: { type: documentType },
        ...(cursor === undefined ? {} : { cursor }),
        limit: MAX_PAGE_LIMIT,
      });
      drives.push(...result.documents);
      if (result.cursorRepeated) {
        return { drives: drives.slice(0, MAX_DRIVES), truncated: true };
      }
      if (drives.length >= MAX_DRIVES) {
        return {
          drives: drives.slice(0, MAX_DRIVES),
          truncated: drives.length > MAX_DRIVES || result.nextCursor !== null,
        };
      }
      if (result.nextCursor === null) return { drives, truncated: false };
      cursor = result.nextCursor;
    }
    return { drives, truncated: true };
  });

  const listDrives: PowerhouseReactorClient["Service"]["listDrives"] = Effect.fn(
    "PowerhouseReactorClient.listDrives",
  )(function* (url) {
    // The reactor has no drives query. Each drive type paginates independently,
    // so fetch the two chains in parallel and then merge them deterministically.
    const byType = yield* Effect.forEach(
      DRIVE_DOCUMENT_TYPES,
      (documentType) => findDrivesByType(url, documentType),
      { concurrency: "unbounded" },
    );
    const seen = new Set<string>();
    const drives: Array<PowerhouseReactorDocumentSummary> = [];
    let truncated = byType.some((result) => result.truncated);
    outer: for (const result of byType) {
      for (const document of result.drives) {
        if (seen.has(document.id)) continue;
        if (drives.length >= MAX_DRIVES) {
          truncated = true;
          break outer;
        }
        seen.add(document.id);
        drives.push(document);
      }
    }
    return { drives, truncated };
  });

  const listDocuments: PowerhouseReactorClient["Service"]["listDocuments"] = Effect.fn(
    "PowerhouseReactorClient.listDocuments",
  )(function* (input) {
    const limit = clampDocumentLimit(input.limit);
    const identifiers = [...new Set(input.search.identifiers ?? [])];
    const type = input.search.type;
    const parentId = input.search.parentId;

    if (identifiers.length > 0) {
      if (parentId !== undefined) {
        // Supplying identifiers is harmless on resolvers that ignore them and
        // lets a future resolver narrow before returning. Post-filtering keeps
        // today's resolver honest. Pull the bounded parent listing so a match
        // is not lost merely because the caller asked for a small page.
        const page = yield* findDocuments({
          url: input.url,
          search: {
            ...(type === undefined ? {} : { type }),
            parentId,
            identifiers,
          },
          ...(input.view === undefined ? {} : { view: input.view }),
          limit: MAX_DOCUMENTS,
        });
        const requested = new Set(identifiers);
        const matching = page.documents.filter(
          (document) =>
            (type === undefined || document.documentType === type) &&
            (requested.has(document.id) || requested.has(document.slug ?? "")),
        );
        return {
          documents: matching.slice(0, limit),
          nextCursor: null,
          truncated:
            matching.length > limit ||
            page.nextCursor !== null ||
            page.documents.length >= MAX_DOCUMENTS,
        };
      }

      const found = yield* Effect.forEach(
        identifiers,
        (identifier) =>
          findDocumentSummary({
            url: input.url,
            identifier,
            ...(input.view === undefined ? {} : { view: input.view }),
          }),
        { concurrency: 8 },
      );
      const matching: Array<PowerhouseReactorDocumentSummary> = [];
      const seen = new Set<string>();
      for (const document of found) {
        if (document === null || seen.has(document.id)) continue;
        if (type !== undefined && document.documentType !== type) continue;
        seen.add(document.id);
        matching.push(document);
      }
      return {
        documents: matching.slice(0, limit),
        nextCursor: null,
        truncated: matching.length > limit,
      };
    }

    if (type === undefined && parentId === undefined) {
      return yield* new PowerhouseReactorError({
        failure: "graphql_error",
        url: input.url,
        graphqlMessages: ["Document search needs a type, parent identifier, or identifier."],
      });
    }

    const page = yield* findDocuments({
      url: input.url,
      search: {
        ...(type === undefined ? {} : { type }),
        ...(parentId === undefined ? {} : { parentId }),
      },
      ...(input.view === undefined ? {} : { view: input.view }),
      ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
      limit,
    });
    return {
      documents: page.documents,
      nextCursor: page.nextCursor,
      // A full page with no cursor to follow means the reactor may have given
      // us only the first part of the matching set. Say so rather than
      // presenting a bounded search as complete.
      truncated: page.documents.length >= limit && page.nextCursor === null,
    };
  });

  const getDocument: PowerhouseReactorClient["Service"]["getDocument"] = Effect.fn(
    "PowerhouseReactorClient.getDocument",
  )(function* (input) {
    const data = yield* gql({
      url: input.url,
      query: DOCUMENT_QUERY,
      variables: {
        identifier: input.documentId,
        ...(input.view === undefined ? {} : { view: input.view }),
      },
      schema: RawDocumentQuery,
      timeout: REQUEST_TIMEOUT,
    });
    if (data.document === null) {
      return yield* new PowerhouseReactorError({
        failure: "graphql_error",
        url: input.url,
        graphqlMessages: ["No document with that identifier."],
      });
    }
    const raw = data.document.document;
    const rawState = raw.state ?? null;
    const stateTruncated = rawState !== null && serializedByteSize(rawState) > MAX_STATE_BYTES;
    const allRevisions = (raw.revisionsList ?? []).flatMap((revision) =>
      revision.revision === undefined || revision.revision === null
        ? []
        : [{ scope: revision.scope ?? "", revision: revision.revision }],
    );
    const allChildIds = [...new Set(data.document.childIds ?? [])];
    return {
      ...toSummary(raw),
      preferredEditor: raw.preferredEditor ?? null,
      state: stateTruncated ? null : rawState,
      stateTruncated,
      revisions: allRevisions.slice(0, MAX_DOCUMENT_REVISIONS),
      revisionsTruncated: allRevisions.length > MAX_DOCUMENT_REVISIONS,
      childIds: allChildIds.slice(0, MAX_CHILD_IDS),
      childIdsTruncated: allChildIds.length > MAX_CHILD_IDS,
    };
  });

  const getOperations: PowerhouseReactorClient["Service"]["getOperations"] = Effect.fn(
    "PowerhouseReactorClient.getOperations",
  )(function* (input) {
    const limit = clampLimit(input.limit);
    const data = yield* gql({
      url: input.url,
      query: OPERATIONS_QUERY,
      variables: {
        filter: {
          documentId: input.documentId,
          ...(input.view?.branch === undefined ? {} : { branch: input.view.branch }),
          ...(input.view?.scopes === undefined ? {} : { scopes: input.view.scopes }),
        },
        paging: {
          limit,
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        },
      },
      schema: RawOperationsQuery,
      timeout: REQUEST_TIMEOUT,
    });
    if (data.documentOperations.items.length > limit) {
      return yield* new PowerhouseReactorError({
        failure: "decode_failed",
        url: input.url,
        cause: new Error("Reactor returned more operations than requested."),
      });
    }
    let retainedInputBytes = 0;
    const operations = data.documentOperations.items.map((raw) => {
      const action = raw.action ?? null;
      const signer = action?.context?.signer ?? null;
      const actionInput = action?.input ?? null;
      const actionInputBytes = actionInput === null ? 0 : serializedByteSize(actionInput);
      const actionInputTruncated =
        actionInput !== null &&
        (actionInputBytes > MAX_OPERATION_INPUT_BYTES ||
          retainedInputBytes + actionInputBytes > MAX_OPERATION_PAGE_INPUT_BYTES);
      if (!actionInputTruncated) retainedInputBytes += actionInputBytes;
      return {
        index: raw.index ?? 0,
        timestampUtcMs: raw.timestampUtcMs ?? null,
        hash: raw.hash ?? null,
        skip: raw.skip ?? null,
        error: raw.error ?? null,
        actionType: action?.type ?? null,
        actionInput: actionInputTruncated ? null : actionInput,
        actionInputTruncated,
        scope: action?.scope ?? null,
        signer: signer?.user?.address ?? signer?.app?.name ?? null,
      };
    });
    const nextCursor = data.documentOperations.cursor ?? null;
    return {
      operations,
      // A repeated cursor cannot advance the log. End pagination instead of
      // leaving a Load more control that can never fetch another page.
      nextCursor: nextCursor === input.cursor ? null : nextCursor,
    };
  });

  const executeGraphql: PowerhouseReactorClient["Service"]["executeGraphql"] = Effect.fn(
    "PowerhouseReactorClient.executeGraphql",
  )(function* (input) {
    const variables =
      input.variablesJson === undefined
        ? undefined
        : yield* decodeGraphqlVariablesJson(input.variablesJson).pipe(
            Effect.mapError(
              (cause) =>
                new PowerhouseReactorError({
                  failure: "invalid_request",
                  cause,
                }),
            ),
          );
    const result = yield* postGraphql({
      url: input.url,
      query: input.query,
      ...(input.operationName === undefined ? {} : { operationName: input.operationName }),
      ...(variables === undefined ? {} : { variables }),
      ...(input.headers === undefined ? {} : { headers: input.headers }),
      timeout: SWITCHBOARD_REQUEST_TIMEOUT,
    });
    const decoded = yield* Effect.result(decodeGraphqlResponseJson(result.text));
    if (decoded._tag === "Failure") {
      return yield* new PowerhouseReactorError({
        failure: result.status < 200 || result.status >= 300 ? "http_error" : "decode_failed",
        url: result.safeUrl,
        ...(result.status < 200 || result.status >= 300 ? { status: result.status } : {}),
        cause: decoded.failure,
      });
    }
    return { status: result.status, response: decoded.success };
  });

  return PowerhouseReactorClient.of({
    probe,
    listDrives,
    listDocuments,
    getDocument,
    getOperations,
    executeGraphql,
  });
});

export const layer = Layer.effect(PowerhouseReactorClient, make);
