import { assert, describe, it } from "vite-plus/test";

import {
  hasSpecificPierreIconForFileName,
  resolvePierreIconForEntry,
  syntheticFileNameForLanguageId,
  VETRA_PIERRE_FOLDER_ICON_CSS,
  VETRA_PIERRE_ICONS,
} from "./pierre-icons";
import {
  DEFAULT_PIERRE_FOLDER_ICON_ID,
  PIERRE_FOLDER_ICONS,
  resolvePierreFolderIcon,
} from "./pierre-folder-icons";

describe("Pierre file icons", () => {
  it("uses Pierre exact filename and complete-set extension mappings", () => {
    assert.equal(resolvePierreIconForEntry("Dockerfile", "file")?.token, "docker");
    assert.equal(resolvePierreIconForEntry("src/Button.tsx", "file")?.token, "react");
    assert.equal(resolvePierreIconForEntry("vite.config.ts", "file")?.token, "vite");
  });

  it("uses built-in Pierre icons where available", () => {
    assert.equal(resolvePierreIconForEntry("package.json", "file")?.name, "file-tree-builtin-npm");
    assert.equal(
      resolvePierreIconForEntry("config/tsconfig.json", "file")?.name,
      "file-tree-builtin-typescript",
    );
    assert.equal(resolvePierreIconForEntry("CLAUDE.md", "file")?.name, "file-tree-builtin-claude");
    assert.equal(
      resolvePierreIconForEntry("README.md", "file")?.name,
      "file-tree-builtin-markdown",
    );
  });

  it("extends Pierre with Vetra-specific exact filename icons", () => {
    assert.equal(resolvePierreIconForEntry("AGENTS.md", "file")?.name, "vetra-file-icon-agents");
    assert.equal(resolvePierreIconForEntry("pnpm-lock.yaml", "file")?.name, "vetra-file-icon-pnpm");
    assert.equal(
      resolvePierreIconForEntry("pnpm-workspace.yaml", "file")?.name,
      "vetra-file-icon-pnpm",
    );
  });

  it("ships every custom icon referenced by the extended resolver", () => {
    const customIconNames = new Set(
      Object.values(VETRA_PIERRE_ICONS.byFileName).filter((name) => name.startsWith("vetra-")),
    );
    for (const iconName of customIconNames) {
      assert.include(VETRA_PIERRE_ICONS.spriteSheet, `id="${iconName}"`);
    }
    for (const icon of PIERRE_FOLDER_ICONS) {
      assert.include(VETRA_PIERRE_ICONS.spriteSheet, `id="${icon.id}"`);
    }
  });

  it("uses the Pierre default icon for unknown file types", () => {
    assert.equal(resolvePierreIconForEntry("artifact.unknown-ext", "file")?.token, "default");
    assert.isFalse(hasSpecificPierreIconForFileName("artifact.unknown-ext"));
  });

  it("resolves directory icons from the folder-name map", () => {
    assert.equal(resolvePierreIconForEntry("apps", "directory")?.name, "vetra-folder-icon-app");
    assert.equal(
      resolvePierreIconForEntry("packages/", "directory")?.name,
      "vetra-folder-icon-package",
    );
    assert.equal(
      resolvePierreIconForEntry(".github", "directory")?.name,
      "vetra-folder-icon-github",
    );
    assert.equal(
      resolvePierreIconForEntry(".cursor", "directory")?.name,
      "vetra-folder-icon-vscode",
    );
    assert.equal(
      resolvePierreIconForEntry("k8s", "directory")?.name,
      "vetra-folder-icon-kubernetes",
    );
    assert.equal(
      resolvePierreIconForEntry("packages/client-runtime", "directory")?.name,
      DEFAULT_PIERRE_FOLDER_ICON_ID,
    );
    assert.equal(resolvePierreFolderIcon("SRC").id, "vetra-folder-icon-src");
  });

  it("injects folder icons into Pierre file trees via CSS", () => {
    assert.include(
      VETRA_PIERRE_FOLDER_ICON_CSS,
      "[data-item-type='folder'] > [data-item-section='icon']::after",
    );
    assert.include(VETRA_PIERRE_FOLDER_ICON_CSS, "[data-item-path='apps/' i]");
    assert.include(VETRA_PIERRE_FOLDER_ICON_CSS, "[data-item-path$='/node_modules/' i]");
  });

  it("normalizes common markdown fence language aliases", () => {
    assert.equal(syntheticFileNameForLanguageId("typescript"), "file.ts");
    assert.equal(syntheticFileNameForLanguageId("dockerfile"), "Dockerfile");
    assert.equal(syntheticFileNameForLanguageId("shellscript"), "file.sh");
    assert.equal(syntheticFileNameForLanguageId("python"), "file.py");
  });

  it("gives a dockerfile fence the Docker icon", () => {
    assert.isTrue(hasSpecificPierreIconForFileName(syntheticFileNameForLanguageId("dockerfile")));
  });
});
