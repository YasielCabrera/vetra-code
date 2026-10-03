import { describe, expect, it } from "vite-plus/test";

import { isFractionalIndexKey, keyBetween } from "./fractionalIndex.ts";

describe("keyBetween", () => {
  it("generates the reference keys", () => {
    expect(keyBetween(null, null)).toBe("a0");
    expect(keyBetween("a0", null)).toBe("a1");
    expect(keyBetween("az", null)).toBe("b00");
    expect(keyBetween(null, "a0")).toBe("Zz");
    expect(keyBetween("a0", "a1")).toBe("a0V");
    expect(keyBetween("a0V", "a1")).toBe("a0l");
    expect(keyBetween("Zz", "a0")).toBe("ZzV");
    expect(keyBetween("a1", "a2")).toBe("a1V");
  });

  it("keeps appended keys ordered and short", () => {
    const keys: string[] = [];
    for (let index = 0; index < 1000; index += 1) {
      keys.push(keyBetween(keys.at(-1) ?? null, null));
    }
    expect([...keys].sort()).toEqual(keys);
    expect(new Set(keys).size).toBe(1000);
    expect(keys.at(-1)).toBe("bF7");
  });

  it("orders repeated inserts between the same neighbours", () => {
    const low = keyBetween(null, null);
    let high = keyBetween(low, null);
    const inserted = [high];
    for (let index = 0; index < 50; index += 1) {
      high = keyBetween(low, high);
      inserted.unshift(high);
    }
    expect([low, ...inserted]).toEqual([low, ...inserted].sort());
    expect(new Set(inserted).size).toBe(51);
  });

  it("rejects malformed or inverted bounds", () => {
    expect(() => keyBetween("a1", "a0")).toThrow("out of order");
    expect(() => keyBetween("a0", "a0")).toThrow("out of order");
    expect(() => keyBetween("a00", null)).toThrow("Invalid");
  });
});

describe("isFractionalIndexKey", () => {
  it("accepts generated keys and rejects malformed ones", () => {
    expect(["a0", "Zz", "a0V", "b00"].map(isFractionalIndexKey)).toEqual([true, true, true, true]);
    expect(["", "a", "a00", "a0!", "!0", `A${"0".repeat(26)}`].map(isFractionalIndexKey)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
