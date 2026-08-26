import { describe, expect, it } from "vite-plus/test";

import { parseSourceControlAttachmentUrl } from "./sourceControlAttachments.ts";

describe("parseSourceControlAttachmentUrl", () => {
  it.each([
    "https://github.com/user-attachments/assets/45b6dcb9-2bb8-4f91-8ad6-b8af19d03883",
    "  https://github.com/user-attachments/assets/45b6dcb9-2bb8-4f91-8ad6-b8af19d03883  ",
  ])("recognises %s as an upload the environment must fetch", (value) => {
    expect(parseSourceControlAttachmentUrl(value)).toBe(
      "https://github.com/user-attachments/assets/45b6dcb9-2bb8-4f91-8ad6-b8af19d03883",
    );
  });

  it.each([
    // Anything a browser can already load stays a plain image source.
    "https://user-images.githubusercontent.com/1/screenshot.png",
    "https://example.com/image.png",
    // A host or path that only looks like one must never borrow the GitHub credential.
    "https://github.com.evil.example/user-attachments/assets/abc",
    "https://evil.example/user-attachments/assets/abc",
    "http://github.com/user-attachments/assets/abc",
    "https://github.com/user-attachments/assets/abc/../../owner/repo",
    "https://github.com/user-attachments/assets/",
    "https://github.com/owner/repo/blob/main/image.png",
  ])("rejects %s", (value) => {
    expect(parseSourceControlAttachmentUrl(value)).toBeNull();
  });
});
