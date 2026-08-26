import type { PowerhouseDocumentModel } from "@vetra-code/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  describeConnection,
  describeLoadedCount,
  displayModelExtension,
  describeModelFailure,
  describeReactorFailure,
  displayReactorUrl,
  documentDisplayName,
  formatOperationTimestamp,
  isUsableReactorUrl,
  latestSpecificationIndex,
  normalizeReactorUrl,
  resolveSpecificationIndex,
  specificationLabel,
} from "./PowerhousePanel.logic";

const specification = (version: number | null) => ({
  version,
  changeLog: [],
  globalSchema: "",
  localSchema: "",
  modules: [],
});

const model = (versions: ReadonlyArray<number | null>): PowerhouseDocumentModel => ({
  directoryName: "todo",
  id: "powerhouse/todo",
  name: "Todo",
  extension: "todo",
  description: "",
  author: null,
  specifications: versions.map(specification),
});

describe("specification selection", () => {
  it("picks the highest version rather than the first entry", () => {
    expect(latestSpecificationIndex(model([1, 3, 2]).specifications)).toBe(1);
  });

  it("falls back to the last entry when nothing carries a version", () => {
    expect(latestSpecificationIndex(model([null, null]).specifications)).toBe(1);
  });

  it("returns null for a model with no specifications", () => {
    expect(latestSpecificationIndex([])).toBeNull();
  });

  it("honors a valid stored selection", () => {
    expect(resolveSpecificationIndex(model([1, 2, 3]), 0)).toBe(0);
  });

  it.each([-1, 3, 99])("falls back to the newest for out-of-range index %s", (index) => {
    expect(resolveSpecificationIndex(model([1, 2, 3]), index)).toBe(2);
  });

  it("labels an unversioned specification by position", () => {
    expect(specificationLabel(specification(2), 0)).toBe("Version 2");
    expect(specificationLabel(specification(null), 1)).toBe("Revision 2");
  });
});

describe("model extension", () => {
  it.each([
    ["rtoc", ".rtoc"],
    [".rtoc", ".rtoc"],
    ["  .rtoc  ", ".rtoc"],
    ["", ""],
  ])("displays %j as %j", (input, expected) => {
    expect(displayModelExtension(input)).toBe(expected);
  });
});

describe("describeModelFailure", () => {
  it("names the file the author has to open", () => {
    expect(describeModelFailure({ directoryName: "todo", reason: "invalid_json" })).toBe(
      "todo/todo.json: invalid JSON",
    );
    expect(describeModelFailure({ directoryName: "todo", reason: "missing_json" })).toBe(
      "todo/todo.json: no matching JSON file",
    );
  });
});

describe("describeReactorFailure", () => {
  it("names every address it tried when nothing was listening", () => {
    const copy = describeReactorFailure({
      failure: "unreachable",
      attempted: ["http://127.0.0.1:4001", "http://127.0.0.1:4000"],
    });
    expect(copy.title).toBe("No reactor is running");
    expect(copy.detail).toContain("127.0.0.1:4001");
    expect(copy.detail).toContain("127.0.0.1:4000");
    expect(copy.detail).toContain("ph reactor");
  });

  it("distinguishes a wrong listener from no listener", () => {
    expect(
      describeReactorFailure({ failure: "not_a_reactor", attempted: ["http://127.0.0.1:4001"] })
        .title,
    ).toBe("That is not a reactor");
  });

  it("passes GraphQL messages through", () => {
    expect(
      describeReactorFailure({ failure: "graphql_error", graphqlMessages: ["Unauthorized"] })
        .detail,
    ).toBe("Unauthorized");
  });

  it("says which status an HTTP failure returned", () => {
    expect(
      describeReactorFailure({
        failure: "http_error",
        url: "http://127.0.0.1:4001",
        status: 503,
      }).detail,
    ).toContain("503");
  });

  it("gives malformed Switchboard payloads an actionable message", () => {
    expect(describeReactorFailure({ failure: "invalid_request" })).toEqual({
      title: "That request cannot be sent",
      detail: "Check the operation, variables, and request headers, then try again.",
    });
  });

  it("falls back to a generic address when nothing was recorded", () => {
    expect(describeReactorFailure({ failure: "timeout" }).detail).toContain(
      "the configured address",
    );
  });
});

describe("reactor URLs", () => {
  it.each([
    ["http://127.0.0.1:4001", "127.0.0.1:4001"],
    ["https://reactor.example.com", "reactor.example.com"],
    ["https://reactor.example.com/team/alpha", "reactor.example.com/team/alpha"],
    ["not a url", "not a url"],
  ])("displays %s as %s", (input, expected) => {
    expect(displayReactorUrl(input)).toBe(expected);
  });

  it.each(["http://127.0.0.1:4001", "https://x.example", " http://x:1 "])("accepts %s", (input) => {
    expect(isUsableReactorUrl(input)).toBe(true);
  });

  it.each(["", "127.0.0.1:4001", "ftp://x", "file:///etc/passwd", "javascript:alert(1)"])(
    "rejects %s",
    (input) => {
      expect(isUsableReactorUrl(input)).toBe(false);
    },
  );

  it("removes credentials and inert URL fragments before persistence", () => {
    expect(
      normalizeReactorUrl(" http://user:secret@127.0.0.1:4001/team/?token=nope#fragment "),
    ).toBe("http://127.0.0.1:4001/team");
  });

  it("shows the version beside the address when the reactor reported one", () => {
    expect(
      describeConnection({
        url: "http://127.0.0.1:4001",
        source: "config",
        system: { version: "6.2.2", gitHash: null, gitUrl: null },
      }),
    ).toBe("127.0.0.1:4001 · v6.2.2");
    expect(
      describeConnection({
        url: "http://127.0.0.1:4001",
        source: "config",
        system: { version: null, gitHash: null, gitUrl: null },
      }),
    ).toBe("127.0.0.1:4001");
  });
});

describe("list presentation", () => {
  it("counts what is loaded, never a total the reactor cannot supply", () => {
    expect(describeLoadedCount(1, "document")).toBe("1 document loaded");
    expect(describeLoadedCount(12, "operation")).toBe("12 operations loaded");
  });

  it("formats an epoch-millis string and leaves anything else alone", () => {
    expect(formatOperationTimestamp(null)).toBe("");
    expect(formatOperationTimestamp("not a number")).toBe("not a number");
    expect(formatOperationTimestamp("1e100")).toBe("1e100");
    expect(formatOperationTimestamp("0")).toBe(
      new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(0),
      ),
    );
  });

  it("falls back from name to slug to id", () => {
    expect(documentDisplayName({ name: "Invoices", slug: "inv", id: "d1" })).toBe("Invoices");
    expect(documentDisplayName({ name: "  ", slug: "inv", id: "d1" })).toBe("inv");
    expect(documentDisplayName({ name: null, slug: null, id: "d1" })).toBe("d1");
  });
});
