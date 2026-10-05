import * as NodeCrypto from "node:crypto";

import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

class AttachmentFileSizeError extends Schema.TaggedError<AttachmentFileSizeError>()(
  "AttachmentFileSizeError",
  { expectedBytes: Schema.Number, receivedBytes: Schema.Number },
) {
  override get message(): string {
    return `Body was ${this.receivedBytes} bytes, expected ${this.expectedBytes}.`;
  }
}

export const writeAttachmentFile = Effect.fn("writeAttachmentFile")(function* <E, R>(input: {
  readonly destinationPath: string;
  readonly expectedBytes: number;
  readonly stream: Stream.Stream<Uint8Array, E, R>;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const partPath = `${input.destinationPath}.${NodeCrypto.randomUUID()}.part`;
  let receivedBytes = 0;
  yield* Effect.gen(function* () {
    yield* fileSystem.makeDirectory(path.dirname(input.destinationPath), { recursive: true });
    yield* Stream.run(
      input.stream.pipe(
        Stream.takeWhile((chunk) => {
          receivedBytes += chunk.byteLength;
          return receivedBytes <= input.expectedBytes;
        }),
      ),
      fileSystem.sink(partPath),
    );
    if (receivedBytes !== input.expectedBytes) {
      return yield* new AttachmentFileSizeError({
        expectedBytes: input.expectedBytes,
        receivedBytes,
      });
    }
    yield* fileSystem.rename(partPath, input.destinationPath).pipe(Effect.uninterruptible);
  }).pipe(Effect.ensuring(fileSystem.remove(partPath, { force: true }).pipe(Effect.ignore)));
});
