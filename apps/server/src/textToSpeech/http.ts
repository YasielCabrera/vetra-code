import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";

import { TEXT_TO_SPEECH_ROUTE_PREFIX, TextToSpeech } from "./TextToSpeech.ts";

/**
 * Streams little-endian 16-bit mono PCM as each sentence is synthesized. The single-use
 * token, minted over the authenticated WebSocket, is the credential, so a plain `fetch`
 * works on every connection mode. Audio stays off the WebSocket that carries thread state.
 */
export const textToSpeechRouteLayer = HttpRouter.add(
  "GET",
  `${TEXT_TO_SPEECH_ROUTE_PREFIX}/*`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const url = HttpServerRequest.toURL(request);
    if (Option.isNone(url)) return HttpServerResponse.text("Bad Request", { status: 400 });
    const token = url.value.pathname.slice(`${TEXT_TO_SPEECH_ROUTE_PREFIX}/`.length);
    return yield* (yield* TextToSpeech).takeSpeech(token).pipe(
      Effect.map((speech) =>
        speech
          ? HttpServerResponse.stream(
              speech.pipe(
                Stream.tapError((cause) =>
                  Effect.logWarning("Text-to-speech stream failed.", { cause }),
                ),
              ),
              {
                headers: {
                  "Content-Type": "application/octet-stream",
                  "Cache-Control": "private, no-store",
                  "X-Content-Type-Options": "nosniff",
                },
              },
            )
          : HttpServerResponse.text("Not Found", { status: 404 }),
      ),
      // The body carries the detail the client shows the user.
      Effect.catchTag("TextToSpeechError", (error) =>
        Effect.logWarning("Text-to-speech failed to start.", { cause: error }).pipe(
          Effect.as(HttpServerResponse.text(error.detail, { status: 500 })),
        ),
      ),
    );
  }),
);
