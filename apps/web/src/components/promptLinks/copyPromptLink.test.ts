// @vitest-environment jsdom

import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ComposerContextId } from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { parseNewThreadLink } from "@t3tools/shared/promptLinks";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { useComposerDraftStore } from "~/composerDraftStore";

import { composerPromptLink, promptLinkFor } from "./copyPromptLink";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("prompt link destinations", () => {
  it("uses the current web origin when no hosted app is configured", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "");
    vi.stubGlobal("window", { location: { origin: "https://machine.example" } });

    expect(promptLinkFor("Fix this")).toBe("https://machine.example/new?prompt=Fix+this");
  });

  it("uses the installed desktop app when no hosted app is configured", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "");
    vi.stubGlobal("window", { desktopBridge: {}, location: { origin: "null" } });

    expect(promptLinkFor("Fix this")).toBe("vetra://new?prompt=Fix+this");
  });

  it("uses an explicitly configured hosted app on desktop", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://hosted.example");
    vi.stubGlobal("window", { desktopBridge: {}, location: { origin: "null" } });

    expect(
      promptLinkFor("Fix this", {
        repository: { owner: "owner", name: "repo" },
        provider: "codex",
        model: "gpt-5",
      }),
    ).toBe(
      "https://hosted.example/new?prompt=Fix+this&repo=owner%2Frepo&provider=codex&model=gpt-5",
    );
  });
});

describe("composerPromptLink", () => {
  it("shares a draft's context chips as their labels, as a sent message's link does", () => {
    const target = scopeThreadRef(EnvironmentId.make("env-1"), ThreadId.make("thread-1"));
    const image = formatComposerContextReference({
      kind: "image",
      contextId: "image_abc" as ComposerContextId,
      label: "screenshot.png",
    });
    useComposerDraftStore.getState().setPrompt(target, `Why does ${image} look wrong?`);

    const link = composerPromptLink({
      target,
      project: undefined,
      providers: [],
      threadModelSelection: null,
      threadStarted: false,
      withContext: false,
    });

    expect(link).not.toBeNull();
    const parsed = parseNewThreadLink(new URL(link!).search);
    expect(parsed).toMatchObject({
      ok: true,
      value: { prompt: { text: "Why does screenshot.png look wrong?" } },
    });
  });
});
