import { sign as signApplication, type SignOptions } from "@electron/osx-sign";
import { expect, it, vi } from "vite-plus/test";

import sign from "./sign-macos.ts";

vi.mock("@electron/osx-sign", () => ({ sign: vi.fn() }));

it("batches codesign calls without changing existing signing options", async () => {
  const options = {
    app: "/tmp/Vetra Code.app",
    identity: "Developer ID Application: T3 Tools, Inc.",
    keychain: "/tmp/vetra-code.keychain",
    provisioningProfile: "/tmp/vetra-code.provisionprofile",
    optionsForFile: () => ({
      entitlements: "/tmp/vetra-code.entitlements.plist",
      hardenedRuntime: true,
    }),
  } satisfies SignOptions;

  await sign(options);

  expect(signApplication).toHaveBeenCalledExactlyOnceWith({
    ...options,
    batchCodesignCalls: true,
  });
});
