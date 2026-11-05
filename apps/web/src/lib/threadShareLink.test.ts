import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { promptLinkAppPath } from "@t3tools/shared/promptLinks";
import { describe, expect, it, vi } from "vite-plus/test";

import { shareableThreadLink, shareableThreadMarkdown } from "./threadShareLink";

const ref = { environmentId: EnvironmentId.make("env 1"), threadId: ThreadId.make("thread.a") };

describe("shareableThreadLink", () => {
  it("opens a desktop copy in the desktop app", () => {
    using _window = stubWindow({ desktopBridge: {}, location: { origin: "vetra://app" } });
    const link = shareableThreadLink(ref);
    expect(link).toBe("vetra://threads/env%201/thread.a");
    expect(promptLinkAppPath(link)).toBe("/env%201/thread.a");
  });

  it("opens a browser copy on the server that browser reached", () => {
    using _window = stubWindow({ location: { origin: "https://box.example.ts.net" } });
    expect(shareableThreadMarkdown(ref, "Fix [it]")).toBe(
      "[Fix it](https://box.example.ts.net/threads/env%201/thread%2Ea)",
    );
  });
});

function stubWindow(value: object): Disposable {
  vi.stubGlobal("window", value);
  return { [Symbol.dispose]: () => vi.unstubAllGlobals() };
}
