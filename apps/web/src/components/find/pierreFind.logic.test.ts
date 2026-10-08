import { describe, expect, it } from "vite-plus/test";

import { fileFindLines } from "./pierreFind.logic";

describe("fileFindLines", () => {
  it("splits on every line ending Pierre counts", () => {
    expect(fileFindLines("a\r\nb\rc\nd")).toEqual(["a", "b", "c", "d"]);
  });
});
