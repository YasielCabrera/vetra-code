import { ProjectId } from "@vetra-code/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  derivePendingProjectFolderName,
  derivePendingProjectTitle,
  resolvePendingProjectLocation,
} from "./pendingProject";

const PROJECT_ID = ProjectId.make("A7F3-1234-5678");

describe("pendingProject", () => {
  it("derives a readable title and stable unique folder from the first prompt", () => {
    expect(derivePendingProjectTitle("  Build   a customer portal  ")).toBe(
      "Build a customer portal",
    );
    expect(derivePendingProjectFolderName("Build a customer portal", PROJECT_ID)).toBe(
      "build-a-customer-portal-a7f312",
    );
  });

  it("uses a custom folder stem while retaining the project id suffix", () => {
    expect(derivePendingProjectFolderName("ignored", PROJECT_ID, "Client Portal")).toBe(
      "client-portal-a7f312",
    );
  });

  it("joins the selected parent directory without leaking a trailing separator", () => {
    expect(
      resolvePendingProjectLocation({
        parentDirectory: "~/Vetra Code Projects/",
        customFolderName: "Client Portal",
        prompt: "Build a customer portal",
        projectId: PROJECT_ID,
      }),
    ).toEqual({
      title: "Build a customer portal",
      folderName: "client-portal-a7f312",
      workspaceRoot: "~/Vetra Code Projects/client-portal-a7f312",
    });
  });
});
