import { assert, describe, it } from "vite-plus/test";

import { resolvePierreIconForEntry } from "./pierre-icons";
import { VETRA_PIERRE_FOLDER_ICON_CSS } from "./pierre-icons";
import { VETRA_PIERRE_ICONS } from "./pierre-icons";

import {
  DEFAULT_PIERRE_FOLDER_ICON_ID,
  PIERRE_FOLDER_ICONS,
  resolvePierreFolderIcon,
} from "./pierre-folder-icons";
import { hasSpecificPierreIconForFileName } from "./pierre-icons";

describe("Pierre file icons", () => {
  it.each(["photo.heic", "photo.heif", "PHOTO.HEIC", "folder/photo.HEIF"])(
    "uses the image icon for %s",
    (name) => {
      assert.equal(resolvePierreIconForEntry(name, "file")?.token, "image");
      assert.isTrue(hasSpecificPierreIconForFileName(name));
    },
  );
  it("uses detected types for extensionless files while keeping known filename icons", () => {
    assert.equal(
      resolvePierreIconForEntry("custom-script", "file", "text/x-python")?.token,
      "python",
    );
    assert.equal(resolvePierreIconForEntry("image", "file", "image/png")?.token, "image");
    assert.equal(
      resolvePierreIconForEntry("Dockerfile", "file", "text/x-shellscript")?.token,
      "docker",
    );
    assert.equal(
      resolvePierreIconForEntry("folder.png", "directory", "image/png")?.name,
      DEFAULT_PIERRE_FOLDER_ICON_ID,
    );
    assert.equal(
      resolvePierreIconForEntry("unknown", "file", "application/octet-stream")?.token,
      "default",
    );
  });

  it.each([
    ["pdf", "pdf"],
    ["doc", "word"],
    ["docx", "word"],
    ["odt", "word"],
    ["rtf", "word"],
    ["xls", "spreadsheet"],
    ["xlsx", "spreadsheet"],
    ["ods", "spreadsheet"],
    ["csv", "spreadsheet"],
    ["tsv", "spreadsheet"],
    ["ppt", "slides"],
    ["pptx", "slides"],
    ["odp", "slides"],
    ["epub", "epub"],
  ])("uses the document family icon for %s", (extension, family) => {
    for (const path of [`report.${extension}`, `folder/REPORT.${extension.toUpperCase()}`]) {
      assert.equal(resolvePierreIconForEntry(path, "file")?.name, `vetra-file-icon-${family}`);
      assert.isTrue(hasSpecificPierreIconForFileName(path));
    }
  });

  it("ships every custom icon referenced by the extended resolver", () => {
    const customIconNames = new Set(
      [
        ...Object.values(VETRA_PIERRE_ICONS.byFileName),
        ...Object.values(VETRA_PIERRE_ICONS.byFileExtension),
      ].filter((name) => name.startsWith("vetra-")),
    );
    for (const iconName of customIconNames) {
      assert.include(VETRA_PIERRE_ICONS.spriteSheet, `id="${iconName}"`);
    }
    for (const icon of PIERRE_FOLDER_ICONS) {
      assert.include(VETRA_PIERRE_ICONS.spriteSheet, `id="${icon.id}"`);
    }
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
});
