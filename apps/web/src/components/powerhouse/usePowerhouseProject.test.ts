import type { PowerhouseProjectLocation } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveSelectedProject } from "./usePowerhouseProject";

const project = (path: string): PowerhouseProjectLocation => ({
  path,
  name: path.split("/").at(-1) ?? path,
  documentModelsDir: "./document-models",
  reactorPort: null,
  configValid: true,
});

describe("resolveSelectedProject", () => {
  it("returns nothing when the workspace has no Powerhouse project", () => {
    expect(resolveSelectedProject([], null)).toBeNull();
    expect(resolveSelectedProject([], "apps/connect")).toBeNull();
  });

  it("uses the only project when the workspace has one", () => {
    expect(resolveSelectedProject([project("apps/connect")], null)?.path).toBe("apps/connect");
  });

  it("honors the remembered choice", () => {
    const projects = [project("apps/connect"), project("apps/studio")];
    expect(resolveSelectedProject(projects, "apps/studio")?.path).toBe("apps/studio");
  });

  it("falls back to the first when the remembered project is gone", () => {
    const projects = [project("apps/connect"), project("apps/studio")];
    expect(resolveSelectedProject(projects, "apps/deleted")?.path).toBe("apps/connect");
  });

  it("treats the workspace root as a selectable project", () => {
    expect(resolveSelectedProject([project("")], "")?.path).toBe("");
  });
});
