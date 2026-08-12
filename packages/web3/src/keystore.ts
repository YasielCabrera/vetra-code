/**
 * On-disk persistence for preview wallet keys.
 *
 * Plaintext, mode 0600, and labelled as a test wallet inside the file itself.
 * That is a deliberate choice, not an oversight: these keys sign for a browser
 * preview that loads untrusted web content and can auto-approve, so the honest
 * move is to make the blast radius obvious rather than dress it up as a vault.
 *
 * @module Web3Keystore
 */
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { PreviewWalletKeystoreError, WEB3_KEYSTORE_WARNING, Web3KeystoreFile } from "./schema.ts";

const KEYSTORE_FILE_MODE = 0o600;
const KEYSTORE_DIRECTORY_MODE = 0o700;

const KeystoreJson = Schema.fromJsonString(Web3KeystoreFile);
const decodeKeystoreJson = Schema.decodeEffect(KeystoreJson);
const encodeKeystoreJson = Schema.encodeEffect(KeystoreJson);

export const EMPTY_KEYSTORE: Web3KeystoreFile = {
  schemaVersion: 1,
  warning: WEB3_KEYSTORE_WARNING,
  mnemonic: null,
  privateKeys: [],
  accounts: [],
  selectedAddress: null,
  connectedOrigins: [],
};

/**
 * A missing file is an empty wallet, not an error — that is the state before
 * the user first enables the wallet. A file that exists but cannot be decoded
 * *is* surfaced, because silently replacing someone's imported key with an
 * empty wallet would be data loss.
 */
export const readKeystore = Effect.fn("Web3Keystore.read")(function* (keystorePath: string) {
  const fileSystem = yield* FileSystem.FileSystem;

  const raw = yield* fileSystem.readFileString(keystorePath).pipe(
    Effect.map(Option.some),
    Effect.catchTags({
      PlatformError: (cause) =>
        cause.reason._tag === "NotFound"
          ? Effect.succeed(Option.none<string>())
          : Effect.fail(
              new PreviewWalletKeystoreError({
                operation: "read",
                path: keystorePath,
                detail: String(cause),
              }),
            ),
    }),
  );

  if (Option.isNone(raw)) return EMPTY_KEYSTORE;

  return yield* decodeKeystoreJson(raw.value).pipe(
    Effect.mapError(
      (cause) =>
        new PreviewWalletKeystoreError({
          operation: "read",
          path: keystorePath,
          detail: String(cause),
        }),
    ),
  );
});

/** Staged write: temp file created at 0600, then renamed over the target. */
export const writeKeystore = Effect.fn("Web3Keystore.write")(function* (input: {
  readonly keystorePath: string;
  readonly keystore: Web3KeystoreFile;
}) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;

  const failure = (detail: unknown) =>
    new PreviewWalletKeystoreError({
      operation: "write",
      path: input.keystorePath,
      detail: String(detail),
    });

  const encoded = yield* encodeKeystoreJson({
    ...input.keystore,
    warning: WEB3_KEYSTORE_WARNING,
  }).pipe(Effect.mapError(failure));

  const suffix = yield* crypto.randomUUIDv4.pipe(
    Effect.map((uuid) => uuid.replace(/-/g, "")),
    Effect.mapError(failure),
  );
  const temporaryPath = `${input.keystorePath}.${suffix}.tmp`;

  yield* fileSystem
    .makeDirectory(path.dirname(input.keystorePath), {
      recursive: true,
      mode: KEYSTORE_DIRECTORY_MODE,
    })
    .pipe(Effect.mapError(failure));

  yield* fileSystem
    .writeFileString(temporaryPath, `${encoded}\n`, { mode: KEYSTORE_FILE_MODE })
    .pipe(Effect.mapError(failure));

  yield* fileSystem.rename(temporaryPath, input.keystorePath).pipe(Effect.mapError(failure));
});

/**
 * Keystore path for a preview browser partition. Partitions are already
 * `persist:<product>-preview-<sha>`, so the hash suffix is reused verbatim to
 * keep one wallet per preview session without inventing a second identity.
 */
export function keystoreFileName(partition: string): string {
  // Dots are replaced too, not just separators: a partition of `..` would
  // otherwise normalise to the literal `..`, and `<dir>/../json` is not a file
  // we want to write. The `.json` suffix is appended, so nothing needs them.
  const normalized = partition.replace(/^persist:/, "").replace(/[^A-Za-z0-9_-]/g, "-");
  return `${normalized}.json`;
}
