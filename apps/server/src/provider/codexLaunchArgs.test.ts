import * as NodeAssert from "node:assert/strict";

import { describe, it } from "vite-plus/test";

import {
  codexAppServerArgs,
  codexExecLaunchArgs,
  codexSubscriptionUsageAppServerArgs,
  resolveCodexLaunchArgs,
} from "./codexLaunchArgs.ts";

describe("resolveCodexLaunchArgs", () => {
  it("uses VETRA_CODEX_LAUNCH_ARGS before configured settings", () => {
    NodeAssert.equal(
      resolveCodexLaunchArgs(" --strict-config ", { VETRA_CODEX_LAUNCH_ARGS: "--enable foo" }),
      "--enable foo",
    );
  });

  it("uses configured settings when VETRA_CODEX_LAUNCH_ARGS is empty", () => {
    NodeAssert.equal(
      resolveCodexLaunchArgs(" --strict-config ", { VETRA_CODEX_LAUNCH_ARGS: "   " }),
      "--strict-config",
    );
  });

  it("ignores whitespace-only environment values", () => {
    NodeAssert.equal(resolveCodexLaunchArgs("", { VETRA_CODEX_LAUNCH_ARGS: "   " }), "");
  });
});

describe("codexAppServerArgs", () => {
  it("preserves escaped TOML quotes in config values", () => {
    NodeAssert.deepStrictEqual(
      codexAppServerArgs(String.raw`--config model=\"gpt-6.1-sol\" --strict-config`),
      ["app-server", "--config", 'model="gpt-6.1-sol"', "--strict-config"],
    );
  });

  it("returns the app-server command for empty launch args", () => {
    NodeAssert.deepStrictEqual(codexAppServerArgs(""), ["app-server"]);
  });

  it("appends parsed launch args after app-server", () => {
    NodeAssert.deepStrictEqual(codexAppServerArgs("--strict-config --enable foo"), [
      "app-server",
      "--strict-config",
      "--enable",
      "foo",
    ]);
  });
});

describe("codexSubscriptionUsageAppServerArgs", () => {
  it("uses the non-interactive approval policy supported by current Codex CLIs", () => {
    NodeAssert.deepStrictEqual(codexSubscriptionUsageAppServerArgs("--strict-config"), [
      "-s",
      "read-only",
      "-a",
      "never",
      "app-server",
      "--strict-config",
    ]);
  });
});

describe("codexExecLaunchArgs", () => {
  it("preserves escaped TOML quotes in config values", () => {
    NodeAssert.deepStrictEqual(
      codexExecLaunchArgs(String.raw`--config model=\"gpt-6.1-sol\" --strict-config`),
      ["--config", 'model="gpt-6.1-sol"', "--strict-config"],
    );
  });

  it("keeps shared codex flags and omits app-server-only flags", () => {
    NodeAssert.deepStrictEqual(
      codexExecLaunchArgs('--strict-config --enable foo --listen off --config model="gpt 5"'),
      ["--strict-config", "--enable", "foo", "--config", "model=gpt 5"],
    );
  });

  it("does not pair value-taking flags with adjacent flags", () => {
    NodeAssert.deepStrictEqual(codexExecLaunchArgs("--config --strict-config --enable --disable"), [
      "--strict-config",
    ]);
  });
});
