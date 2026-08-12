import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { EMPTY_KEYSTORE, keystoreFileName, readKeystore, writeKeystore } from "./keystore.ts";
import { WEB3_KEYSTORE_WARNING, type Web3Address, type Web3KeystoreFile } from "./schema.ts";

const withTempDir = <A, E>(
  use: (
    directory: string,
  ) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path | Crypto.Crypto>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "vetra-web3-keystore-" });
    return yield* use(directory);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const SAMPLE: Web3KeystoreFile = {
  ...EMPTY_KEYSTORE,
  mnemonic: "test test test test test test test test test test test junk",
  accounts: [
    {
      address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Web3Address,
      label: "Preview account 1",
      source: "generated",
      derivationIndex: 0,
    },
  ],
  selectedAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Web3Address,
  connectedOrigins: ["http://localhost:5173"],
};

describe("keystoreFileName", () => {
  it("derives a filename from a preview partition without inventing a second identity", () => {
    expect(keystoreFileName("persist:vetra-code-preview-abc123")).toBe(
      "vetra-code-preview-abc123.json",
    );
  });

  it("strips characters that are not safe in a path segment, dots included", () => {
    expect(keystoreFileName("persist:weird/../name")).toBe("weird----name.json");
  });

  it("cannot produce a traversal segment from a pathological partition", () => {
    expect(keystoreFileName("persist:..")).toBe("--.json");
    expect(keystoreFileName("..")).toBe("--.json");
    expect(keystoreFileName("persist:../../etc/passwd")).toBe("------etc-passwd.json");
  });
});

describe("keystore round-trip", () => {
  it.effect("treats a missing file as an empty wallet rather than an error", () =>
    withTempDir((directory) =>
      Effect.gen(function* () {
        const keystore = yield* readKeystore(`${directory}/absent.json`);
        expect(keystore).toEqual(EMPTY_KEYSTORE);
      }),
    ),
  );

  it.effect("writes then reads back the same wallet", () =>
    withTempDir((directory) =>
      Effect.gen(function* () {
        const keystorePath = `${directory}/nested/wallet.json`;
        yield* writeKeystore({ keystorePath, keystore: SAMPLE });

        const loaded = yield* readKeystore(keystorePath);
        expect(loaded.mnemonic).toBe(SAMPLE.mnemonic);
        expect(loaded.accounts).toEqual(SAMPLE.accounts);
        expect(loaded.selectedAddress).toBe(SAMPLE.selectedAddress);
        expect(loaded.connectedOrigins).toEqual(SAMPLE.connectedOrigins);
      }),
    ),
  );

  it.effect("creates the file with mode 0600 so it is not group or world readable", () =>
    withTempDir((directory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const keystorePath = `${directory}/wallet.json`;
        yield* writeKeystore({ keystorePath, keystore: SAMPLE });

        const info = yield* fileSystem.stat(keystorePath);
        // Compare the permission bits only; the file-type bits differ per platform.
        expect((info.mode ?? 0) & 0o777).toBe(0o600);
      }),
    ),
  );

  it.effect("always stamps the current test-wallet warning into the file", () =>
    withTempDir((directory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const keystorePath = `${directory}/wallet.json`;
        // Even if a caller hands us a stale or blank warning.
        yield* writeKeystore({ keystorePath, keystore: { ...SAMPLE, warning: "" } });

        const raw = yield* fileSystem.readFileString(keystorePath);
        expect(raw).toContain(WEB3_KEYSTORE_WARNING);
        expect((yield* readKeystore(keystorePath)).warning).toBe(WEB3_KEYSTORE_WARNING);
      }),
    ),
  );

  it.effect("leaves no temporary files behind", () =>
    withTempDir((directory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const keystorePath = `${directory}/wallet.json`;
        yield* writeKeystore({ keystorePath, keystore: SAMPLE });

        const entries = yield* fileSystem.readDirectory(directory);
        expect(entries).toEqual(["wallet.json"]);
      }),
    ),
  );

  it.effect("overwrites an existing wallet atomically", () =>
    withTempDir((directory) =>
      Effect.gen(function* () {
        const keystorePath = `${directory}/wallet.json`;
        yield* writeKeystore({ keystorePath, keystore: SAMPLE });
        yield* writeKeystore({
          keystorePath,
          keystore: { ...SAMPLE, connectedOrigins: ["https://app.example.test"] },
        });

        const loaded = yield* readKeystore(keystorePath);
        expect(loaded.connectedOrigins).toEqual(["https://app.example.test"]);
      }),
    ),
  );

  it.effect("surfaces a corrupt file instead of silently replacing an imported key", () =>
    withTempDir((directory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const keystorePath = `${directory}/wallet.json`;
        yield* fileSystem.writeFileString(keystorePath, "{ this is not json");

        const result = yield* readKeystore(keystorePath).pipe(Effect.result);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure._tag).toBe("PreviewWalletKeystoreError");
          expect(result.failure.operation).toBe("read");
        }
      }),
    ),
  );

  it.effect("fills defaults for a file written by an older build", () =>
    withTempDir((directory) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const keystorePath = `${directory}/wallet.json`;
        yield* fileSystem.writeFileString(keystorePath, '{"mnemonic":"abc def"}');

        const loaded = yield* readKeystore(keystorePath);
        expect(loaded.mnemonic).toBe("abc def");
        expect(loaded.accounts).toEqual([]);
        expect(loaded.privateKeys).toEqual([]);
        expect(loaded.selectedAddress).toBeNull();
        expect(loaded.schemaVersion).toBe(1);
      }),
    ),
  );
});
