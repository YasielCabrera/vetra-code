import { describe, expect, it } from "vite-plus/test";

import { findLineOccurrences, findSegmentMatches } from "./findScope.logic";

describe("findSegmentMatches", () => {
  it("matches case-insensitively inside a single segment", () => {
    expect(findSegmentMatches(["companyId: PHID", "CompanyName"], "company")).toEqual({
      matches: [
        { start: { segment: 0, offset: 0 }, end: { segment: 0, offset: 7 } },
        { start: { segment: 1, offset: 0 }, end: { segment: 1, offset: 7 } },
      ],
      truncated: false,
    });
  });

  it("spans a match across the segments a highlighter split it into", () => {
    expect(findSegmentMatches(["companyId", ":", " ", "PHID"], "Id: PH").matches).toEqual([
      { start: { segment: 0, offset: 7 }, end: { segment: 3, offset: 2 } },
    ]);
  });

  it("anchors matches on segment boundaries to the segment holding their text", () => {
    expect(findSegmentMatches(["ab", "", "cd"], "cd").matches).toEqual([
      { start: { segment: 2, offset: 0 }, end: { segment: 2, offset: 2 } },
    ]);
    expect(findSegmentMatches(["ab", "cd"], "ab").matches).toEqual([
      { start: { segment: 0, offset: 0 }, end: { segment: 0, offset: 2 } },
    ]);
  });

  it("treats the query as literal text", () => {
    expect(findSegmentMatches(["a.b axb (a.b)"], "a.b").matches).toHaveLength(2);
  });

  it("stops at the limit and reports that more exist", () => {
    const result = findSegmentMatches(["aaaa"], "a", 3);
    expect(result.matches).toHaveLength(3);
    expect(result.truncated).toBe(true);
    expect(findSegmentMatches(["aaa"], "a", 3).truncated).toBe(false);
  });

  it("finds nothing for an empty query", () => {
    expect(findSegmentMatches(["abc"], "")).toEqual({ matches: [], truncated: false });
  });
});

describe("findLineOccurrences", () => {
  it("counts matches per line so the nth rendered match can be located", () => {
    expect(findLineOccurrences(["foo foo", "bar", "Foo"], "foo")).toEqual({
      matches: [
        { line: 0, occurrence: 0 },
        { line: 0, occurrence: 1 },
        { line: 2, occurrence: 0 },
      ],
      truncated: false,
    });
  });

  it("stops at the limit across lines", () => {
    const result = findLineOccurrences(["aa", "aa"], "a", 3);
    expect(result.matches).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});
