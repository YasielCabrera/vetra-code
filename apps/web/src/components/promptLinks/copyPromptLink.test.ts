// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { promptLinkFor } from "./copyPromptLink";

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
