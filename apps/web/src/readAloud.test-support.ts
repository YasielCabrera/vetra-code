import { vi } from "vite-plus/test";

const speechTest = vi.hoisted(() => ({
  enabled: true,
  speak: vi.fn(async (_input: unknown) => ({
    _tag: "Success",
    value: { url: "/audio/test.pcm", sampleRate: 24000 },
  })),
}));

vi.mock("./hooks/useSettings", () => ({
  useEnvironmentSettings: () => ({ enabled: speechTest.enabled, model: "test" }),
}));
vi.mock("./state/query", () => ({
  useEnvironmentQuery: () => ({ data: [{ model: "test", phase: "installed" }] }),
}));
vi.mock("./state/environments", () => ({
  useEnvironmentHttpBaseUrl: (environmentId: string) => `https://${environmentId}.example`,
}));
vi.mock("./state/server", () => ({
  serverEnvironment: { textToSpeechModels: () => ({}), speakText: {} },
}));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => speechTest.speak }));

export class TestAudioContext {
  static current: TestAudioContext;
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => {});
  suspend = vi.fn(async () => {});
  sources: Array<EventTarget & { stop: ReturnType<typeof vi.fn> }> = [];
  constructor() {
    TestAudioContext.current = this;
  }
  createBuffer(_channels: number, length: number, rate: number) {
    return { duration: length / rate, getChannelData: () => new Float32Array(length) };
  }
  createBufferSource(): EventTarget & { stop: ReturnType<typeof vi.fn> } {
    const source = Object.assign(new EventTarget(), {
      buffer: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    });
    this.sources.push(source);
    return source;
  }
}

export function setupSpeechTest() {
  speechTest.enabled = true;
  speechTest.speak.mockReset().mockResolvedValue({
    _tag: "Success",
    value: { url: "/audio/test.pcm", sampleRate: 24000 },
  });
  vi.stubGlobal("AudioContext", TestAudioContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array([0, 0, 0, 0]));
          init.signal?.addEventListener("abort", () => controller.close(), { once: true });
        },
      });
      return { ok: true, body };
    }),
  );
}

export { speechTest };
