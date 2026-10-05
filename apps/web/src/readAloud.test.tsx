// @vitest-environment jsdom

import { setupSpeechTest, speechTest, TestAudioContext } from "./readAloud.test-support";
import { EnvironmentId, MessageId, TicketPlanId } from "@t3tools/contracts";
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { DocumentReadAloudButton } from "./components/tickets/DocumentReadAloudButton";
import { ReadAloudButton } from "./components/ReadAloudButton";
import {
  documentSpeechKey,
  messageSpeechKey,
  stopSpeech,
  stopThreadSpeech,
  toggleSpeech,
  useReadAloud,
  useSpeechPlayback,
  useStopSpeechOnLeave,
} from "./readAloud";
import { markdownSpeechText, renderedSpeechText } from "./readAloudText";

vi.mock("./env", () => ({ isElectron: false }));
vi.mock("./components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));

const environmentId = EnvironmentId.make("remote");
let root: Root;
let container: HTMLDivElement;

function Playback() {
  const playback = useSpeechPlayback();
  return <output>{playback === null ? "idle" : `${playback.key} ${playback.phase}`}</output>;
}
function Control({ readText }: { readText: () => string }) {
  return (
    <ReadAloudButton readAloud={useReadAloud(environmentId)} speechKey="test" readText={readText} />
  );
}
async function click(label: string, index = 0) {
  const button = container.querySelectorAll<HTMLButtonElement>(`button[aria-label="${label}"]`)[
    index
  ];
  if (!button) throw new Error(`Missing ${label}`);
  await act(async () => button.click());
}
function documentControl(
  key: string,
  body: () => string,
  renderedBody: () => string | null,
  ref = createRef<HTMLDivElement>(),
) {
  return (
    <DocumentReadAloudButton
      key={key}
      environmentId={environmentId}
      speechKey={key}
      bodyRef={ref}
      readBody={body}
      readRenderedBody={renderedBody}
    />
  );
}

function OwnedDocument({
  speechKey,
  control = true,
}: {
  speechKey: string | null;
  control?: boolean;
}) {
  useStopSpeechOnLeave(speechKey);
  return speechKey !== null && control
    ? documentControl(
        speechKey,
        () => speechKey,
        () => null,
      )
    : null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setupSpeechTest();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
    stopSpeech();
  });
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("read aloud controls", () => {
  it("prepares lazily and cancels loading without preparing again", async () => {
    let resolve = (_value: Awaited<ReturnType<typeof speechTest.speak>>) => {};
    speechTest.speak.mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    const readText = vi.fn(() => "Read the current body.");
    await act(async () =>
      root.render(
        <>
          <Control readText={readText} />
          <Playback />
        </>,
      ),
    );
    expect(container.textContent).toBe("idle");
    expect(readText).toHaveBeenCalledTimes(0);
    await click("Read aloud");
    expect(container.textContent).toBe("test loading");
    await click("Stop reading");
    expect(container.textContent).toBe("idle");
    expect(readText).toHaveBeenCalledTimes(1);
    expect(speechTest.speak).toHaveBeenCalledWith({
      environmentId: "remote",
      input: { text: "Read the current body." },
    });
    await act(async () =>
      resolve({ _tag: "Success", value: { url: "/stale", sampleRate: 24000 } }),
    );
    expect(fetch).toHaveBeenCalledTimes(0);
  });

  it("plays, pauses, resumes and stops the actual global player", async () => {
    await act(async () =>
      root.render(
        <>
          <Control readText={() => "Body"} />
          <Playback />
        </>,
      ),
    );
    await click("Read aloud");
    expect(container.textContent).toBe("test playing");
    expect(fetch).toHaveBeenCalledWith(
      "https://remote.example/audio/test.pcm",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await click("Pause reading");
    expect(container.textContent).toBe("test paused");
    await click("Resume reading");
    expect(container.textContent).toBe("test playing");
    await click("Stop reading");
    expect(container.textContent).toBe("idle");
    expect(TestAudioContext.current.sources.at(-1)?.stop).toHaveBeenCalledTimes(1);
  });

  it("keeps playback when a reusable control leaves the rendered timeline", async () => {
    await act(async () =>
      root.render(
        <>
          <Control readText={() => "A reply"} />
          <Playback />
        </>,
      ),
    );
    await click("Read aloud");
    expect(container.textContent).toBe("test playing");
    await act(async () => root.render(<Playback />));
    expect(container.textContent).toBe("test playing");
    await act(async () => stopSpeech());
    expect(container.textContent).toBe("idle");
  });

  it("keeps document speech through older thread cleanup and stale preparation", async () => {
    await act(async () => root.render(<Playback />));
    let finish = (_value: { url: string; sampleRate: number }) => {};
    const prepare = new Promise<{ url: string; sampleRate: number }>((resolve) => {
      finish = resolve;
    });
    const messageKey = messageSpeechKey("remote:thread-a", MessageId.make("message-1"));
    await act(async () => {
      void toggleSpeech(messageKey, () => prepare);
    });
    expect(container.textContent).toBe("message:remote%3Athread-a:message-1 loading");
    const planKey = documentSpeechKey(environmentId, "plan", TicketPlanId.make("plan-1"));
    await act(async () => {
      void toggleSpeech(planKey, async () => ({ url: "/plan", sampleRate: 24000 }));
    });
    await act(async () => {
      stopThreadSpeech("remote:thread-a");
      finish({ url: "/old-message", sampleRate: 24000 });
    });
    expect(container.textContent).toBe("plan:remote:plan-1 playing");
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => stopSpeech(messageKey));
    expect(container.textContent).toBe("plan:remote:plan-1 playing");
    await act(async () => stopSpeech());
    expect(container.textContent).toBe("idle");
  });

  it("cleans only the exact departing thread scope", async () => {
    await act(async () => root.render(<Playback />));
    await act(async () => {
      void toggleSpeech(
        messageSpeechKey("remote:thread-ab", MessageId.make("message-2")),
        async () => ({ url: "/new", sampleRate: 24000 }),
      );
    });
    await act(async () => stopThreadSpeech("remote:thread-a"));
    expect(container.textContent).toBe("message:remote%3Athread-ab:message-2 playing");
    await act(async () => stopThreadSpeech("remote:thread-ab"));
    expect(container.textContent).toBe("idle");
  });

  it("reports synthesis failure and returns to idle", async () => {
    const { toastManager } = await import("./components/ui/toast");
    speechTest.speak.mockRejectedValueOnce(new Error("Model unavailable"));
    await act(async () =>
      root.render(
        <>
          <Control readText={() => "Body"} />
          <Playback />
        </>,
      ),
    );
    await click("Read aloud");
    expect(container.textContent).toBe("idle");
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "error",
      title: "Could not read aloud",
      description: "Model unavailable",
    });
  });
});

describe("document read aloud", () => {
  it("reads only rendered prose and does not mutate the body", async () => {
    const bodyRef = createRef<HTMLDivElement>();
    await act(async () =>
      root.render(
        <>
          <h1>Outside title</h1>
          {documentControl(
            "doc",
            () => "source",
            () => "source",
            bodyRef,
          )}
          <div ref={bodyRef}>
            <p>Read prose.</p>
            <pre>Secret code</pre>
            <button>Comment</button>
            <hr />
            <p>Next paragraph.</p>
          </div>
          <Playback />
        </>,
      ),
    );
    await click("Read aloud");
    expect(speechTest.speak).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { text: "Read prose.\nNext paragraph." },
    });
    expect(container.querySelector("pre")?.textContent).toBe("Secret code");
  });

  it("prefers immediate draft changes to stale rendered markup", async () => {
    let currentBody = "Old body";
    const bodyRef = createRef<HTMLDivElement>();
    await act(async () =>
      root.render(
        <>
          {documentControl(
            "doc",
            () => currentBody,
            () => "Old body",
            bodyRef,
          )}
          <div ref={bodyRef}>
            <p>Old body</p>
          </div>
          <Playback />
        </>,
      ),
    );
    currentBody = "# New draft\nEdited **immediately**.";
    await click("Read aloud");
    expect(speechTest.speak).toHaveBeenLastCalledWith({
      environmentId: "remote",
      input: { text: "New draft\nEdited immediately." },
    });
  });

  it("keeps reading while the control remounts and stops when its document is left", async () => {
    const renderDocument = (control: boolean) => (
      <>
        <OwnedDocument speechKey="plan:remote:b" control={control} />
        <Playback />
      </>
    );
    await act(async () => root.render(renderDocument(true)));
    await click("Read aloud");
    expect(container.textContent).toBe("plan:remote:b playing");
    await act(async () => root.render(renderDocument(false)));
    expect(container.textContent).toBe("plan:remote:b playing");
    await act(async () => root.render(renderDocument(true)));
    expect(container.querySelector('button[aria-label="Pause reading"]')).not.toBeNull();
    await act(async () => root.render(<Playback />));
    expect(container.textContent).toBe("idle");
  });

  it("stops on document departure without stopping a newer document", async () => {
    const a = <OwnedDocument key="a" speechKey="ticket:remote:a" />;
    const b = <OwnedDocument key="b" speechKey="plan:remote:b" />;
    await act(async () =>
      root.render(
        <>
          {a}
          {b}
          <Playback />
        </>,
      ),
    );
    await click("Read aloud", 0);
    expect(container.textContent).toBe("ticket:remote:a playing");
    await click("Read aloud", 0);
    expect(container.textContent).toBe("plan:remote:b playing");
    await act(async () =>
      root.render(
        <>
          {b}
          <Playback />
        </>,
      ),
    );
    expect(container.textContent).toBe("plan:remote:b playing");
    await act(async () => root.render(<Playback />));
    expect(container.textContent).toBe("idle");
  });

  it("stops the old identity when the owner moves to another document or none", async () => {
    const renderDocument = (speechKey: string | null) => (
      <>
        <OwnedDocument speechKey={speechKey} />
        <Playback />
      </>
    );
    await act(async () => root.render(renderDocument("ticket:remote:a")));
    await click("Read aloud");
    expect(container.textContent).toBe("ticket:remote:a playing");
    await act(async () => root.render(renderDocument("ticket:remote:b")));
    expect(container.textContent).toBe("idle");
    await click("Read aloud");
    expect(container.textContent).toBe("ticket:remote:b playing");
    await act(async () => root.render(renderDocument(null)));
    expect(container.textContent).toBe("idle");
  });

  it("stops its own run when settings make the control unavailable", async () => {
    await act(async () =>
      root.render(
        <>
          {documentControl(
            "doc",
            () => "Body",
            () => null,
          )}
          <Playback />
        </>,
      ),
    );
    await click("Read aloud");
    expect(container.textContent).toBe("doc playing");
    speechTest.enabled = false;
    await act(async () =>
      root.render(
        <>
          {documentControl(
            "doc",
            () => "Body",
            () => null,
          )}
          <Playback />
        </>,
      ),
    );
    expect(container.textContent).toBe("idle");
    expect(container.querySelector("button")).toBeNull();
  });

  it("does not speak empty or code-only documents", async () => {
    const { toastManager } = await import("./components/ui/toast");
    await act(async () =>
      root.render(
        <>
          {documentControl(
            "doc",
            () => "```ts\ncode\n```",
            () => null,
          )}
          <Playback />
        </>,
      ),
    );
    await click("Read aloud");
    expect(container.textContent).toBe("idle");
    expect(toastManager.add).toHaveBeenCalledWith({
      type: "info",
      title: "There is nothing to read aloud",
    });
    expect(markdownSpeechText("## Heading\n- [Link](https://example.com) **words**")).toBe(
      "Heading\nLink words",
    );
    const body = document.createElement("div");
    body.innerHTML = "<pre>code</pre><button>Copy</button>";
    expect(renderedSpeechText(body)).toBe("");
  });
});
