// @effect-diagnostics nodeBuiltinImport:off -- Native close events are simulated without launching a desktop app.

import * as NodeEvents from "node:events";

import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";

import type * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronTheme from "../electron/ElectronTheme.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLifecycle from "./DesktopLifecycle.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";
import * as DesktopState from "./DesktopState.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";

function layerElectronApp(
  appListeners: Map<string, (...args: readonly unknown[]) => void>,
  quit: Effect.Effect<void> = Effect.void,
) {
  const registerListener = (eventName: string, listener: (...args: readonly unknown[]) => void) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        appListeners.set(eventName, listener);
      }),
      () =>
        Effect.sync(() => {
          appListeners.delete(eventName);
        }),
    ).pipe(Effect.asVoid);

  return Layer.succeed(ElectronApp.ElectronApp, {
    metadata: Effect.die("unexpected metadata read"),
    name: Effect.succeed("Vetra Code"),
    systemLocale: Effect.succeed("en-US"),
    whenReady: Effect.void,
    quit,
    exit: () => Effect.void,
    relaunch: () => Effect.void,
    setPath: () => Effect.void,
    setName: () => Effect.void,
    setAboutPanelOptions: () => Effect.void,
    setAppUserModelId: () => Effect.void,
    getAppMetrics: Effect.succeed([]),
    setAsDefaultProtocolClient: () => Effect.succeed(true),
    setDesktopName: () => Effect.void,
    setDockIcon: () => Effect.void,
    appendCommandLineSwitch: () => Effect.void,
    removeCommandLineSwitch: () => Effect.void,
    onBeforeQuitForUpdate: (listener) => registerListener("before-quit-for-update", listener),
    on: (eventName, listener) =>
      registerListener(eventName, listener as unknown as (...args: readonly unknown[]) => void),
  } satisfies ElectronApp.ElectronApp["Service"]);
}

const layerElectronTheme = Layer.succeed(ElectronTheme.ElectronTheme, {
  shouldUseDarkColors: Effect.succeed(false),
  setSource: () => Effect.void,
  onUpdated: () => Effect.void,
});

function layerElectronWindow(
  destroyAll: Effect.Effect<void> = Effect.void,
  main: Option.Option<Electron.BrowserWindow> = Option.none(),
) {
  return Layer.succeed(ElectronWindow.ElectronWindow, {
    create: () => Effect.die("unexpected window creation"),
    main: Effect.succeed(main),
    currentMainOrFirst: Effect.die("unexpected current window read"),
    focusedMainOrFirst: Effect.die("unexpected focused window read"),
    setMain: () => Effect.void,
    clearMain: () => Effect.void,
    prepareReveal: () => Effect.succeed(false),
    reveal: () => Effect.void,
    sendAll: () => Effect.void,
    destroyAll,
    syncAllAppearance: () => Effect.void,
  });
}

function makeClosableWindow(input: {
  readonly onClose: () => void;
  readonly onReveal?: () => void;
}) {
  const events = new NodeEvents.EventEmitter();
  const webContents = new NodeEvents.EventEmitter();
  const window = Object.assign(events, {
    id: 1,
    isDestroyed: () => false,
    close: input.onClose,
    opacity: 0,
    setOpacity(opacity: number) {
      this.opacity = opacity;
    },
    getOpacity() {
      return this.opacity;
    },
    show: () => undefined,
    focus: input.onReveal ?? (() => undefined),
    webContents,
  }) as unknown as Electron.BrowserWindow;
  return { window, events, webContents };
}

function makeEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function layerDesktopWindow(
  input: {
    readonly activate?: Effect.Effect<void>;
    readonly flushMainWindowBounds?: Effect.Effect<void>;
  } = {},
) {
  return Layer.succeed(DesktopWindow.DesktopWindow, {
    createMain: Effect.die("unexpected window creation"),
    ensureMain: Effect.die("unexpected window creation"),
    revealOrCreateMain: Effect.die("unexpected window creation"),
    activate: input.activate ?? Effect.void,
    createMainIfBackendReady: Effect.void,
    showConnectingSplash: Effect.void,
    handleBackendReady: () => Effect.void,
    handleBackendNotReady: Effect.void,
    flushMainWindowBounds: input.flushMainWindowBounds ?? Effect.void,
    prepareCaptureReveal: Effect.void,
    dispatchMenuAction: () => Effect.void,
    dispatchSnapShotEvent: () => Effect.void,
    zoomMain: () => Effect.void,
    syncAppearance: Effect.void,
  });
}

describe("DesktopLifecycle", () => {
  it.effect.each(["darwin", "win32", "linux"] satisfies ReadonlyArray<NodeJS.Platform>)(
    "lets the updater's quit event proceed on %s",
    (platform) => {
      const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
      let windowsDestroyed = false;
      const layerEnvironment = Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        platform,
        isDevelopment: false,
      } as DesktopEnvironment.DesktopEnvironment["Service"]);

      const layer = DesktopLifecycle.layer.pipe(
        Layer.provideMerge(layerElectronApp(appListeners)),
        Layer.provideMerge(layerElectronTheme),
        Layer.provideMerge(
          layerElectronWindow(
            Effect.sync(() => {
              windowsDestroyed = true;
            }),
          ),
        ),
        Layer.provideMerge(layerDesktopWindow()),
        Layer.provideMerge(layerEnvironment),
        Layer.provideMerge(DesktopShutdown.layer),
        Layer.provideMerge(DesktopState.layer),
      );

      return Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
          yield* lifecycle.register;

          appListeners.get("before-quit-for-update")?.();
          yield* Effect.yieldNow;

          let prevented = false;
          const event = {
            preventDefault: () => {
              prevented = true;
            },
          } as Electron.Event;
          appListeners.get("before-quit")?.(event);

          assert.isFalse(
            prevented,
            "cancelling this event prevents the updater from completing its relaunch",
          );
          assert.isTrue(windowsDestroyed);

          const state = yield* DesktopState.DesktopState;
          assert.isTrue(yield* Ref.get(state.quitting));
        }),
      ).pipe(Effect.provide(layer));
    },
  );

  it.effect("destroys windows before waiting for backend shutdown", () =>
    Effect.gen(function* () {
      const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
      const shutdownRequested = yield* Deferred.make<void>();
      const allowShutdown = yield* Deferred.make<void>();
      const quitRequested = yield* Deferred.make<void>();
      const events: string[] = [];

      const quit = Effect.sync(() => {
        events.push("quit");
      }).pipe(Effect.andThen(Deferred.succeed(quitRequested, undefined)), Effect.asVoid);
      const destroyAll = Effect.sync(() => {
        events.push("destroy");
      });
      const flushMainWindowBounds = Effect.sync(() => {
        events.push("flush");
      });

      const layerDesktopShutdown = Layer.succeed(DesktopShutdown.DesktopShutdown, {
        request: Effect.sync(() => {
          events.push("request");
        }).pipe(Effect.andThen(Deferred.succeed(shutdownRequested, undefined)), Effect.asVoid),
        awaitRequest: Deferred.await(shutdownRequested),
        markComplete: Deferred.succeed(allowShutdown, undefined).pipe(Effect.asVoid),
        awaitComplete: Deferred.await(allowShutdown),
        isComplete: Deferred.isDone(allowShutdown),
      });

      const layerEnvironment = Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        platform: "darwin",
        isDevelopment: false,
      } as DesktopEnvironment.DesktopEnvironment["Service"]);

      const layer = DesktopLifecycle.layer.pipe(
        Layer.provideMerge(layerElectronApp(appListeners, quit)),
        Layer.provideMerge(layerElectronTheme),
        Layer.provideMerge(layerElectronWindow(destroyAll)),
        Layer.provideMerge(layerDesktopWindow({ flushMainWindowBounds })),
        Layer.provideMerge(layerEnvironment),
        Layer.provideMerge(layerDesktopShutdown),
        Layer.provideMerge(DesktopState.layer),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
          yield* lifecycle.register;

          const event = { preventDefault: () => undefined } as Electron.Event;
          appListeners.get("before-quit")?.(event);

          yield* Deferred.await(shutdownRequested);
          const eventsBeforeCleanup = [...events];
          yield* Deferred.succeed(allowShutdown, undefined);
          yield* Deferred.await(quitRequested);

          assert.deepEqual(eventsBeforeCleanup, ["flush", "destroy", "request"]);
          assert.deepEqual(events, ["flush", "destroy", "request", "quit"]);
        }),
      ).pipe(Effect.provide(layer));
    }),
  );

  it.effect.each([false, true])(
    "Stay cancels Quit and preserves window/backend usability when bounds flush fails: %s",
    (flushFails) =>
      Effect.gen(function* () {
        const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
        const closeRequested = Promise.withResolvers<void>();
        const activationReceived = yield* Deferred.make<void>();
        const shutdownRequested = yield* Deferred.make<void>();
        let closeRequests = 0;
        let destroyed = false;
        let quitCount = 0;
        const revealed = Promise.withResolvers<void>();
        const { window, events, webContents } = makeClosableWindow({
          onClose: () => {
            assert.equal(window.getOpacity(), 1);
            closeRequests += 1;
            closeRequested.resolve();
          },
          onReveal: () => {
            revealed.resolve();
          },
        });
        const layer = DesktopLifecycle.layer.pipe(
          Layer.provideMerge(
            layerElectronApp(
              appListeners,
              Effect.sync(() => {
                quitCount += 1;
              }),
            ),
          ),
          Layer.provideMerge(layerElectronTheme),
          Layer.provideMerge(
            layerElectronWindow(
              Effect.sync(() => {
                destroyed = true;
              }),
              Option.some(window),
            ),
          ),
          Layer.provideMerge(
            layerDesktopWindow({
              activate: Deferred.succeed(activationReceived, undefined).pipe(Effect.asVoid),
              flushMainWindowBounds: flushFails
                ? Effect.die("native bounds inspection failed")
                : Effect.void,
            }),
          ),
          Layer.provideMerge(
            Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
              platform: "darwin",
              isDevelopment: false,
            } as DesktopEnvironment.DesktopEnvironment["Service"]),
          ),
          Layer.provideMerge(
            Layer.succeed(DesktopShutdown.DesktopShutdown, {
              request: Deferred.succeed(shutdownRequested, undefined).pipe(Effect.asVoid),
              awaitRequest: Deferred.await(shutdownRequested),
              markComplete: Effect.void,
              awaitComplete: Effect.void,
              isComplete: Effect.succeed(false),
            }),
          ),
          Layer.provideMerge(DesktopState.layer),
        );

        yield* Effect.scoped(
          Effect.gen(function* () {
            const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
            const state = yield* DesktopState.DesktopState;
            yield* Ref.set(state.backendReady, true);
            yield* lifecycle.register;
            const quitEvent = makeEvent();
            appListeners.get("before-quit")?.(quitEvent);
            yield* Effect.promise(() => closeRequested.promise);
            assert.isFalse(yield* Deferred.isDone(shutdownRequested));

            // Stay keeps will-prevent-unload's default behavior: preserve the window.
            webContents.emit("will-prevent-unload", makeEvent());
            yield* Effect.promise(() => revealed.promise);
            appListeners.get("activate")?.();
            yield* Deferred.await(activationReceived);

            assert.isTrue(quitEvent.defaultPrevented);
            assert.isFalse(yield* Ref.get(state.quitting));
            assert.isTrue(yield* Ref.get(state.backendReady));
            assert.isFalse(yield* Deferred.isDone(shutdownRequested));
            assert.isFalse(destroyed);
            assert.equal(quitCount, 0);
            assert.equal(events.listenerCount("closed"), 0);

            // A subsequent Quit must open a fresh close decision after Stay.
            const retryQuit = makeEvent();
            appListeners.get("before-quit")?.(retryQuit);
            assert.isTrue(retryQuit.defaultPrevented);
            assert.equal(closeRequests, 2);
            webContents.emit("will-prevent-unload", makeEvent());
          }),
        ).pipe(Effect.provide(layer));
      }),
  );

  it.effect("Leave closes the renderer before cleanup and coalesces repeated Quit events", () =>
    Effect.gen(function* () {
      const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
      const closeRequested = Promise.withResolvers<void>();
      const shutdownRequested = yield* Deferred.make<void>();
      const allowShutdown = yield* Deferred.make<void>();
      const quitRequested = yield* Deferred.make<void>();
      const events: string[] = [];
      let finalQuitPrevented = true;
      const {
        window,
        events: windowEvents,
        webContents,
      } = makeClosableWindow({
        onClose: () => {
          events.push("close");
          closeRequested.resolve();
        },
      });
      webContents.on("will-prevent-unload", (event: ReturnType<typeof makeEvent>) => {
        events.push("leave");
        event.preventDefault();
      });
      // A native close can emit this before the temporary close observer resumes.
      windowEvents.on("closed", () => appListeners.get("window-all-closed")?.());
      const layer = DesktopLifecycle.layer.pipe(
        Layer.provideMerge(
          layerElectronApp(
            appListeners,
            Effect.sync(() => {
              events.push("quit");
              const finalQuitEvent = makeEvent();
              appListeners.get("before-quit")?.(finalQuitEvent);
              finalQuitPrevented = finalQuitEvent.defaultPrevented;
            }).pipe(Effect.andThen(Deferred.succeed(quitRequested, undefined)), Effect.asVoid),
          ),
        ),
        Layer.provideMerge(layerElectronTheme),
        Layer.provideMerge(
          layerElectronWindow(
            Effect.sync(() => {
              events.push("destroy");
            }),
            Option.some(window),
          ),
        ),
        Layer.provideMerge(
          layerDesktopWindow({
            flushMainWindowBounds: Effect.sync(() => {
              events.push("flush");
            }),
          }),
        ),
        Layer.provideMerge(
          Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
            platform: "linux",
            isDevelopment: false,
          } as DesktopEnvironment.DesktopEnvironment["Service"]),
        ),
        Layer.provideMerge(
          Layer.succeed(DesktopShutdown.DesktopShutdown, {
            request: Effect.sync(() => {
              events.push("request");
            }).pipe(Effect.andThen(Deferred.succeed(shutdownRequested, undefined)), Effect.asVoid),
            awaitRequest: Deferred.await(shutdownRequested),
            markComplete: Deferred.succeed(allowShutdown, undefined).pipe(Effect.asVoid),
            awaitComplete: Deferred.await(allowShutdown),
            isComplete: Deferred.isDone(allowShutdown),
          }),
        ),
        Layer.provideMerge(DesktopState.layer),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
          const state = yield* DesktopState.DesktopState;
          yield* lifecycle.register;
          const firstQuit = makeEvent();
          const secondQuit = makeEvent();
          appListeners.get("before-quit")?.(firstQuit);
          appListeners.get("before-quit")?.(secondQuit);
          yield* Effect.promise(() => closeRequested.promise);
          assert.deepEqual(events, ["flush", "close"]);
          assert.isFalse(yield* Ref.get(state.quitting));

          webContents.emit("will-prevent-unload", makeEvent());
          assert.isFalse(yield* Deferred.isDone(shutdownRequested));
          events.push("closed");
          windowEvents.emit("closed");
          yield* Deferred.await(shutdownRequested);
          const repeatedQuit = makeEvent();
          appListeners.get("before-quit")?.(repeatedQuit);
          assert.isTrue(firstQuit.defaultPrevented);
          assert.isTrue(secondQuit.defaultPrevented);
          assert.isTrue(repeatedQuit.defaultPrevented);
          assert.isTrue(yield* Ref.get(state.quitting));
          assert.deepEqual(events, ["flush", "close", "leave", "closed", "destroy", "request"]);
          yield* Deferred.succeed(allowShutdown, undefined);
          yield* Deferred.await(quitRequested);

          assert.isFalse(finalQuitPrevented);
          assert.deepEqual(events, [
            "flush",
            "close",
            "leave",
            "closed",
            "destroy",
            "request",
            "quit",
          ]);
        }),
      ).pipe(Effect.provide(layer));
    }),
  );

  it.effect("ignores app activation while quitting", () =>
    Effect.gen(function* () {
      const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
      let activationCount = 0;
      const activate = Effect.sync(() => {
        activationCount += 1;
      });
      const layerEnvironment = Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        platform: "darwin",
        isDevelopment: false,
      } as DesktopEnvironment.DesktopEnvironment["Service"]);
      const layer = DesktopLifecycle.layer.pipe(
        Layer.provideMerge(layerElectronApp(appListeners)),
        Layer.provideMerge(layerElectronTheme),
        Layer.provideMerge(layerElectronWindow()),
        Layer.provideMerge(layerDesktopWindow({ activate })),
        Layer.provideMerge(layerEnvironment),
        Layer.provideMerge(DesktopShutdown.layer),
        Layer.provideMerge(DesktopState.layer),
      );

      yield* Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
          const state = yield* DesktopState.DesktopState;
          yield* lifecycle.register;
          yield* Ref.set(state.quitting, true);

          appListeners.get("activate")?.();

          assert.equal(activationCount, 0);
        }),
      ).pipe(Effect.provide(layer));
    }),
  );

  it.effect.each([false, true])(
    "preserves forced final teardown when shutdown is underway and bounds flush fails: %s",
    (flushFails) =>
      Effect.gen(function* () {
        const appListeners = new Map<string, (...args: readonly unknown[]) => void>();
        const quitRequested = yield* Deferred.make<void>();
        const events: string[] = [];
        const { window } = makeClosableWindow({
          onClose: () => {
            throw new Error("forced shutdown must not open another renderer decision");
          },
        });
        const layer = DesktopLifecycle.layer.pipe(
          Layer.provideMerge(
            layerElectronApp(
              appListeners,
              Effect.sync(() => {
                events.push("quit");
              }).pipe(Effect.andThen(Deferred.succeed(quitRequested, undefined)), Effect.asVoid),
            ),
          ),
          Layer.provideMerge(layerElectronTheme),
          Layer.provideMerge(
            layerElectronWindow(
              Effect.sync(() => {
                events.push("destroy");
              }),
              Option.some(window),
            ),
          ),
          Layer.provideMerge(
            layerDesktopWindow({
              flushMainWindowBounds: flushFails
                ? Effect.die("native bounds inspection failed")
                : Effect.void,
            }),
          ),
          Layer.provideMerge(
            Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
              platform: "darwin",
              isDevelopment: false,
            } as DesktopEnvironment.DesktopEnvironment["Service"]),
          ),
          Layer.provideMerge(DesktopShutdown.layer),
          Layer.provideMerge(DesktopState.layer),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
            const state = yield* DesktopState.DesktopState;
            const shutdown = yield* DesktopShutdown.DesktopShutdown;
            yield* lifecycle.register;
            yield* Ref.set(state.quitting, true);
            yield* shutdown.request;
            yield* shutdown.markComplete;
            appListeners.get("before-quit")?.(makeEvent());
            yield* Deferred.await(quitRequested);
            assert.deepEqual(events, ["destroy", "quit"]);
          }),
        ).pipe(Effect.provide(layer));
      }),
  );
});
