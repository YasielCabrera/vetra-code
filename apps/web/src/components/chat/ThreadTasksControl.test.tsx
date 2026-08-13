import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import type { TaskControlState } from "~/session-logic";
import { ThreadTasksControl } from "./ThreadTasksControl";

const IN_PROGRESS: TaskControlState = {
  completed: 2,
  total: 5,
  allDone: false,
  steps: [
    { step: "Inspect code", status: "completed" },
    { step: "Write tests", status: "inProgress" },
    { step: "Open a PR", status: "pending" },
    { step: "Review diffs", status: "pending" },
    { step: "Ship it", status: "pending" },
  ],
};

const ALL_DONE: TaskControlState = {
  completed: 2,
  total: 2,
  allDone: true,
  steps: [
    { step: "Inspect code", status: "completed" },
    { step: "Write tests", status: "completed" },
  ],
};

function buttonTag(html: string, ariaLabel: string) {
  return html.match(new RegExp(`<button[^>]*aria-label="${ariaLabel}"[^>]*>`))?.[0];
}

describe("ThreadTasksControl", () => {
  it("shows completed of total on an unfinished checklist", () => {
    const html = renderToStaticMarkup(<ThreadTasksControl state={IN_PROGRESS} />);

    expect(buttonTag(html, "Tasks 2 of 5")).toBeDefined();
    expect(html).toContain("data-thread-tasks-control");
    expect(html).toContain("2/5");
    expect(html).not.toContain("All tasks completed");
  });

  it("shows a checkmark when every step is completed", () => {
    const html = renderToStaticMarkup(<ThreadTasksControl state={ALL_DONE} />);

    expect(buttonTag(html, "All tasks completed")).toBeDefined();
    expect(html).toContain("data-thread-tasks-control");
    expect(html).toContain("text-success");
    expect(html).not.toContain("2/2");
  });
});
