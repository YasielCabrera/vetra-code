import { assert, it } from "@effect/vitest";

import { formatCliCommand } from "./invocation.ts";

it("formats package runner commands from their cache entry paths", () => {
  for (const [entryPath, expected] of [
    [
      "/home/theo/.npm/_npx/abc123/node_modules/@vetra-code/server/dist/bin.mjs",
      "npx @vetra-code/server serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\npm-cache\\_npx\\abc\\node_modules\\@vetra-code\\server\\dist\\bin.mjs",
      "npx @vetra-code/server serve",
    ],
    [
      "/home/theo/.cache/pnpm/dlx/abc/node_modules/@vetra-code/server/dist/bin.mjs",
      "pnpm dlx @vetra-code/server serve",
    ],
    [
      "/home/theo/.local/share/pnpm/.pnpm/dlx/abc/node_modules/@vetra-code/server/dist/bin.mjs",
      "pnpm dlx @vetra-code/server serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\pnpm-cache\\dlx\\abc\\node_modules\\@vetra-code\\server\\dist\\bin.mjs",
      "pnpm dlx @vetra-code/server serve",
    ],
    [
      "/home/theo/.bun/install/cache/@vetra-code/server@0.0.31/dist/bin.mjs",
      "bunx @vetra-code/server serve",
    ],
    [
      "/tmp/bunx-1000-@vetra-code/server@latest/node_modules/@vetra-code/server/dist/bin.mjs",
      "bunx @vetra-code/server serve",
    ],
    [
      "C:\\Users\\theo\\AppData\\Local\\Temp\\bunx-0-@vetra-code/server@latest\\node_modules\\@vetra-code\\server\\dist\\bin.mjs",
      "bunx @vetra-code/server serve",
    ],
  ] as const) {
    assert.equal(formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }), expected);
  }
});

it("treats stable installs as direct invocations", () => {
  for (const entryPath of [
    "/usr/local/lib/node_modules/@vetra-code/server/dist/bin.mjs",
    "/home/theo/Code/work/vetra-code/apps/server/dist/bin.mjs",
    "/home/theo/.vetra-code/runtime/0.0.31/node_modules/@vetra-code/server/dist/bin.mjs",
    "",
  ]) {
    assert.equal(
      formatCliCommand({ subcommand: "serve", entryPath, version: "0.0.31" }),
      "vetra serve",
    );
  }
});

it("re-suggests the nightly channel only for nightly builds", () => {
  for (const [version, expected] of [
    ["0.0.31-nightly.20260729", "npx @vetra-code/server@nightly serve"],
    ["0.0.31", "npx @vetra-code/server serve"],
  ] as const) {
    assert.equal(
      formatCliCommand({
        subcommand: "serve",
        entryPath: "/home/theo/.npm/_npx/abc123/node_modules/@vetra-code/server/dist/bin.mjs",
        version,
      }),
      expected,
    );
  }
});

it("formats serve suggestions to match the launching command", () => {
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/home/theo/.npm/_npx/abc/node_modules/@vetra-code/server/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "npx @vetra-code/server@nightly serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath:
        "/tmp/bunx-1000-@vetra-code/server@latest/node_modules/@vetra-code/server/dist/bin.mjs",
      version: "0.0.31",
    }),
    "bunx @vetra-code/server serve",
  );
  assert.equal(
    formatCliCommand({
      subcommand: "serve",
      entryPath: "/usr/local/lib/node_modules/@vetra-code/server/dist/bin.mjs",
      version: "0.0.31-nightly.20260729",
    }),
    "vetra serve",
  );
});
