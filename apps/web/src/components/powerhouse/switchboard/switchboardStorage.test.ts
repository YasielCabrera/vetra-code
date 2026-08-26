import { describe, expect, it } from "vite-plus/test";

import { clearSwitchboardPanelStorage, createSwitchboardStorage } from "./switchboardStorage";

class TestStorage {
  readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("Switchboard storage", () => {
  it("isolates GraphiQL tabs by repeatable panel and selected project", () => {
    const backing = new TestStorage();
    const first = createSwitchboardStorage("powerhouse-switchboard:first", "project-a", backing);
    const second = createSwitchboardStorage("powerhouse-switchboard:second", "project-a", backing);
    const otherProject = createSwitchboardStorage(
      "powerhouse-switchboard:first",
      "project-b",
      backing,
    );

    first.setItem("graphiql:tabState", "first tabs");
    second.setItem("graphiql:tabState", "second tabs");
    otherProject.setItem("graphiql:tabState", "other project tabs");

    expect(first.getItem("graphiql:tabState")).toBe("first tabs");
    expect(second.getItem("graphiql:tabState")).toBe("second tabs");
    expect(otherProject.getItem("graphiql:tabState")).toBe("other project tabs");
  });

  it("clears only the closed panel across all of its project namespaces", () => {
    const backing = new TestStorage();
    const firstA = createSwitchboardStorage("switchboard:first", "project-a", backing);
    const firstB = createSwitchboardStorage("switchboard:first", "project-b", backing);
    const second = createSwitchboardStorage("switchboard:second", "project-a", backing);
    firstA.setItem("graphiql:query", "a");
    firstB.setItem("graphiql:query", "b");
    second.setItem("graphiql:query", "keep");

    clearSwitchboardPanelStorage("switchboard:first", backing);

    expect(firstA.getItem("graphiql:query")).toBeNull();
    expect(firstB.getItem("graphiql:query")).toBeNull();
    expect(second.getItem("graphiql:query")).toBe("keep");
  });
});
