import { parseSourceControlAttachmentUrl } from "@t3tools/shared/sourceControlAttachments";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import { FetchHttpClient, HttpClient } from "effect/http";

import * as GitHubCredentials from "@t3tools/source-control-github/server/GitHubCredentials";

const ATTACHMENT_REDIRECT_TIMEOUT = Duration.seconds(15);

/**
 * Turns an attachment embedded in an issue or pull request body into a URL a browser can load.
 *
 * GitHub answers `github.com/user-attachments/assets/…` with a redirect to a short-lived signed
 * storage URL, but only for a request carrying a GitHub credential — which the environment has
 * and no browser does. Handing the browser that redirect keeps the bytes off the WebSocket and
 * out of the server: the image comes straight from the storage host, exactly as it does on
 * github.com.
 */
export class SourceControlAttachmentResolver extends Context.Service<
  SourceControlAttachmentResolver,
  {
    /** The signed URL to send the viewer to, or null when it cannot be resolved. */
    readonly resolveDownloadUrl: (url: string) => Effect.Effect<string | null>;
  }
>()("t3/sourceControl/SourceControlAttachmentResolver") {}

/** Only a redirect to a TLS origin is worth sending a viewer to. */
function signedStorageUrl(location: string | undefined): string | null {
  if (location === undefined) return null;
  try {
    return new URL(location).protocol === "https:" ? location : null;
  } catch {
    return null;
  }
}

export const make = Effect.gen(function* () {
  const credentials = yield* GitHubCredentials.GitHubCredentials;
  const httpClient = yield* HttpClient.HttpClient;

  // Credentials exist only for hosts the user signed in to, so an unknown host fails here
  // without a single byte leaving the machine.
  const readToken = (host: string) =>
    credentials.get(host).pipe(
      Effect.map((credential) => Redacted.value(credential.token)),
      Effect.tapError((cause) =>
        Effect.logDebug("No GitHub credential for a source control attachment.", { host, cause }),
      ),
      Effect.orElseSucceed(() => null),
    );

  return SourceControlAttachmentResolver.of({
    resolveDownloadUrl: Effect.fn("SourceControlAttachmentResolver.resolveDownloadUrl")(
      function* (url) {
        const attachmentUrl = parseSourceControlAttachmentUrl(url);
        if (attachmentUrl === null) return null;

        const token = yield* readToken(new URL(attachmentUrl).host);
        if (token === null) return null;

        return yield* httpClient
          .get(attachmentUrl, {
            headers: { authorization: `token ${token}`, accept: "*/*" },
          })
          .pipe(
            // The redirect is the answer, so it is never followed here: the storage URL carries
            // its own signature and must not also carry the environment's GitHub credential.
            Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
            Effect.flatMap((response) =>
              // The 3xx body is a stub GitHub sends for browsers. Reading it releases the socket.
              response.text.pipe(
                Effect.as(
                  response.status >= 300 && response.status < 400
                    ? signedStorageUrl(response.headers["location"])
                    : null,
                ),
              ),
            ),
            Effect.timeout(ATTACHMENT_REDIRECT_TIMEOUT),
            Effect.tapError((cause) =>
              Effect.logWarning("Failed to resolve a source control attachment.", {
                url: attachmentUrl,
                cause,
              }),
            ),
            Effect.orElseSucceed(() => null),
          );
      },
    ),
  });
});

export const layer = Layer.effect(SourceControlAttachmentResolver, make);
