import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, describe, expect, it, vi } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { ChildProcessSpawner } from "effect/unstable/process";
import { FetchHttpClient } from "effect/unstable/http";

import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as GitHubCli from "./GitHubCli.ts";
import * as SourceControlAttachmentResolver from "./SourceControlAttachmentResolver.ts";

const ATTACHMENT_URL =
  "https://github.com/user-attachments/assets/45b6dcb9-2bb8-4f91-8ad6-b8af19d03883";
const SIGNED_URL = "https://storage.example/45b6dcb9.png?signature=abc";

const processOutput = (stdout: string): VcsProcess.VcsProcessOutput => ({
  exitCode: ChildProcessSpawner.ExitCode(0),
  stdout,
  stderr: "",
  stdoutTruncated: false,
  stderrTruncated: false,
});

const mockRun = vi.fn<VcsProcess.VcsProcess["Service"]["run"]>();
const mockFetch = vi.fn<(...args: Parameters<typeof globalThis.fetch>) => Promise<Response>>();
const preconnect: typeof globalThis.fetch.preconnect = () => {};

const layer = SourceControlAttachmentResolver.layer.pipe(
  Layer.provide(GitHubCli.layer),
  Layer.provide(Layer.mock(VcsProcess.VcsProcess)({ run: mockRun })),
  Layer.provide(FetchHttpClient.layer),
  // `preconnect` rounds the mock out to the platform `fetch` shape; nothing here calls it.
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, Object.assign(mockFetch, { preconnect }))),
  Layer.provide(
    ServerConfig.ServerConfig.layerTest(process.cwd(), {
      prefix: "vetra-source-control-attachment-test-",
    }).pipe(Layer.provide(NodeServices.layer)),
  ),
);

afterEach(() => {
  mockRun.mockReset();
  mockFetch.mockReset();
});

describe("SourceControlAttachmentResolver", () => {
  it.effect("hands back the signed URL GitHub redirects a credentialed request to", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("gho_token\n")));
      mockFetch.mockResolvedValueOnce(
        new Response("redirecting", {
          status: 302,
          headers: { location: SIGNED_URL },
        }),
      );

      const resolver = yield* SourceControlAttachmentResolver.SourceControlAttachmentResolver;

      expect(yield* resolver.resolveDownloadUrl(ATTACHMENT_URL)).toBe(SIGNED_URL);
      expect(mockRun.mock.calls[0]?.[0].args).toEqual([
        "auth",
        "token",
        "--hostname",
        "github.com",
      ]);
      const [requestUrl, init] = mockFetch.mock.calls[0] ?? [];
      expect(String(requestUrl)).toBe(ATTACHMENT_URL);
      // Following the redirect here would carry the credential to the storage host.
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("authorization")).toBe("token gho_token");
    }).pipe(Effect.provide(layer)),
  );

  it.effect("asks GitHub for nothing when the URL is not an attachment", () =>
    Effect.gen(function* () {
      const resolver = yield* SourceControlAttachmentResolver.SourceControlAttachmentResolver;

      expect(
        yield* resolver.resolveDownloadUrl("https://evil.example/user-attachments/assets/abc"),
      ).toBeNull();
      expect(mockRun).not.toHaveBeenCalled();
      expect(mockFetch).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer)),
  );

  it.effect("stays quiet when the environment has no GitHub login", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("")));

      const resolver = yield* SourceControlAttachmentResolver.SourceControlAttachmentResolver;

      expect(yield* resolver.resolveDownloadUrl(ATTACHMENT_URL)).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    }).pipe(Effect.provide(layer)),
  );

  it.effect("refuses a redirect that would downgrade the viewer to plain HTTP", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("gho_token")));
      mockFetch.mockResolvedValueOnce(
        new Response("redirecting", {
          status: 302,
          headers: { location: "http://storage.example/45b6dcb9.png" },
        }),
      );

      const resolver = yield* SourceControlAttachmentResolver.SourceControlAttachmentResolver;

      expect(yield* resolver.resolveDownloadUrl(ATTACHMENT_URL)).toBeNull();
    }).pipe(Effect.provide(layer)),
  );

  it.effect("treats an answer that is not a redirect as an unavailable image", () =>
    Effect.gen(function* () {
      mockRun.mockReturnValueOnce(Effect.succeed(processOutput("gho_token")));
      mockFetch.mockResolvedValueOnce(new Response("Not Found", { status: 404 }));

      const resolver = yield* SourceControlAttachmentResolver.SourceControlAttachmentResolver;

      expect(yield* resolver.resolveDownloadUrl(ATTACHMENT_URL)).toBeNull();
    }).pipe(Effect.provide(layer)),
  );
});
