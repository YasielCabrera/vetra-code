// Scenarios: e2e tests that run against the real dev stack. See docs/operations/scenarios.md.
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { web } from "@e2e-dev/web";
import type { E2EConfig } from "e2e";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

// e2e loads this module for its values, so the paths and the host are resolved once, here.
const resolved = await Effect.gen(function* () {
  const path = yield* Path.Path;
  const env = yield* HostProcess.Environment;
  const scripts = yield* path.fromFileUrl(new URL(".", import.meta.url));
  const home = path.resolve(scripts, "../.vetra-code/scenarios");
  return {
    node: yield* HostProcess.ExecutablePath,
    scripts,
    /** The checkout whose app runs. `prove-scenario.ts` points it at a base or head worktree. */
    appDir: path.resolve(scripts, env.VETRA_SCENARIO_APP_DIR ?? ".."),
    home,
    startApp: path.join(scripts, "scenarios/start-app.ts"),
  };
}).pipe(Effect.provide(NodeServices.layer), Effect.runPromise);

export const APP_DIR = resolved.appDir;
/** Vetra homes only scenarios use, recreated on every run. `.vetra-code` is gitignored. */
export const VETRA_HOME = resolved.home;
const startApp = resolved.startApp;
/**
 * The one address e2e opens the web app at and the app is told to bind. Never `localhost`: the
 * runner and the app can resolve that name to different addresses.
 */
const LOOPBACK = "127.0.0.1";

export default {
  tests: "scenarios/**/*.e2e.ts",
  targets: [
    {
      name: "web",
      engine: web({ viewport: { width: 1280, height: 800 } }),
      app: {
        url: `http://${LOOPBACK}:0`,
        // Vite answers before the server does; this path is proxied to the server.
        readyUrl: `http://${LOOPBACK}:{port}/.well-known/vetra/environment`,
        command: {
          executable: resolved.node,
          args: [startApp, "web", VETRA_HOME, LOOPBACK, "{port}"],
          cwd: APP_DIR,
          startupTimeout: 300_000,
          log: ".e2e/app.log",
        },
      },
    },
  ],
  // One server holds every test's state, and a dev stack is heavy.
  workers: 1,
  timeout: 300_000,
  assertionTimeout: 15_000,
  video: "on",
  trace: "on",
  reporters: ["list", "markdown"],
} satisfies E2EConfig;
