import {
  ProjectId,
  ThreadId,
  TicketId,
  type TicketActivity,
  type TicketActor,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  foldTicketActivity,
  groupTicketActivity,
  type TicketActivityFold,
} from "./ticketActivity.logic";

const TICKET = TicketId.make("ticket-1");
const START = Date.parse("2026-10-03T14:00:00.000Z");
const USER = { type: "user" } as const;
const AUTOMATION = { type: "automation" } as const;
const agent = (thread: string): TicketActor => ({ type: "agent", threadId: ThreadId.make(thread) });

type Entry = TicketActivity["entry"];
const created: Entry = { type: "created" };
const comment: Entry = { type: "comment", body: "Looks good" };
const edit: Entry = { type: "edited", fields: ["body"] };
const linkProject: Entry = {
  type: "linked",
  target: { kind: "project", projectId: ProjectId.make("project-a") },
};
const unlinkProject: Entry = { type: "unlinked", kind: "project", targetKey: "project-a" };
const linkThread: Entry = {
  type: "linked",
  target: { kind: "thread", threadId: ThreadId.make("thread-a") },
};

const PROJECT_LINKS = { type: "link", key: "link:project", kind: "project" } as const;
const EDITS = { type: "edit", key: "edit" } as const;

function timeline(
  ...items: ReadonlyArray<readonly [seconds: number, actor: TicketActor, entry: Entry]>
): TicketActivity[] {
  return items.map(([seconds, actor, entry], index) => ({
    id: index + 1,
    ticketId: TICKET,
    actor,
    createdAt: new Date(START + seconds * 1000).toISOString(),
    entry,
  }));
}

/** `count` lone edits by one user, ten minutes apart, starting `from` seconds after START. */
function spacedEdits(count: number, from: number) {
  return Array.from({ length: count }, (_, step) => [from + step * 600, USER, edit] as const);
}

describe("groupTicketActivity", () => {
  it("collapses a burst of project link changes into one group", () => {
    const burst = Array.from(
      { length: 12 },
      (_, step) =>
        [21 * 60 + step * 17, USER, step % 2 === 0 ? unlinkProject : linkProject] as const,
    );
    expect(groupTicketActivity(timeline([0, agent("thread-a"), created], ...burst))).toEqual([
      { type: "entry", index: 0 },
      { type: "group", id: 2, family: PROJECT_LINKS, start: 1, end: 13 },
    ]);
  });

  it("splits when more than five minutes pass between entries", () => {
    const activity = timeline(
      [0, USER, linkProject],
      [60, USER, unlinkProject],
      [60 + 6 * 60, USER, linkProject],
      [60 + 7 * 60, USER, unlinkProject],
    );
    expect(groupTicketActivity(activity)).toEqual([
      { type: "group", id: 1, family: PROJECT_LINKS, start: 0, end: 2 },
      { type: "group", id: 3, family: PROJECT_LINKS, start: 2, end: 4 },
    ]);
  });

  it("splits on a different actor, including an agent in another thread", () => {
    const activity = timeline(
      [0, USER, edit],
      [10, USER, edit],
      [20, AUTOMATION, edit],
      [30, agent("thread-a"), edit],
      [40, agent("thread-a"), edit],
      [50, agent("thread-b"), edit],
    );
    expect(groupTicketActivity(activity)).toEqual([
      { type: "group", id: 1, family: EDITS, start: 0, end: 2 },
      { type: "entry", index: 2 },
      { type: "group", id: 4, family: EDITS, start: 3, end: 5 },
      { type: "entry", index: 5 },
    ]);
  });

  it("ends a group at any entry of another family", () => {
    const activity = timeline(
      [0, USER, linkProject],
      [10, USER, unlinkProject],
      [20, USER, edit],
      [30, USER, linkProject],
    );
    expect(groupTicketActivity(activity)).toEqual([
      { type: "group", id: 1, family: PROJECT_LINKS, start: 0, end: 2 },
      { type: "entry", index: 2 },
      { type: "entry", index: 3 },
    ]);
  });

  it("never groups creation or comments", () => {
    const activity = timeline(
      [0, USER, created],
      [5, USER, created],
      [10, USER, comment],
      [15, USER, comment],
    );
    expect(groupTicketActivity(activity)).toEqual([
      { type: "entry", index: 0 },
      { type: "entry", index: 1 },
      { type: "entry", index: 2 },
      { type: "entry", index: 3 },
    ]);
  });

  it("keeps project and thread links apart", () => {
    const activity = timeline(
      [0, USER, linkProject],
      [10, USER, linkThread],
      [20, USER, linkThread],
    );
    expect(groupTicketActivity(activity)).toEqual([
      { type: "entry", index: 0 },
      {
        type: "group",
        id: 2,
        family: { type: "link", key: "link:thread", kind: "thread" },
        start: 1,
        end: 3,
      },
    ]);
  });

  it("starts a new group once a slow drip spans thirty minutes", () => {
    const drip = Array.from({ length: 10 }, (_, step) => [step * 270, USER, edit] as const);
    expect(groupTicketActivity(timeline(...drip))).toEqual([
      { type: "group", id: 1, family: EDITS, start: 0, end: 7 },
      { type: "group", id: 8, family: EDITS, start: 7, end: 10 },
    ]);
  });
});

function foldSizes(fold: TicketActivityFold) {
  return {
    lead: fold.lead.length,
    earlier: fold.earlier.length,
    recent: fold.recent.length,
    hiddenActivityCount: fold.hiddenActivityCount,
    hiddenCommentCount: fold.hiddenCommentCount,
  };
}

describe("foldTicketActivity", () => {
  it("leaves a timeline alone while fewer than four rows would hide", () => {
    const activity = timeline([0, USER, created], ...spacedEdits(11, 600));
    expect(foldSizes(foldTicketActivity(groupTicketActivity(activity), activity))).toEqual({
      lead: 1,
      earlier: 0,
      recent: 11,
      hiddenActivityCount: 0,
      hiddenCommentCount: 0,
    });
  });

  it("folds four rows as soon as that many would hide", () => {
    const activity = timeline([0, USER, created], ...spacedEdits(12, 600));
    expect(foldSizes(foldTicketActivity(groupTicketActivity(activity), activity))).toEqual({
      lead: 1,
      earlier: 4,
      recent: 8,
      hiddenActivityCount: 4,
      hiddenCommentCount: 0,
    });
  });

  it("keeps the first and newest rows and counts the hidden activity inside groups", () => {
    const activity = timeline(
      [0, agent("thread-a"), created],
      [600, USER, linkProject],
      [610, USER, unlinkProject],
      [620, USER, linkProject],
      [1200, USER, comment],
      ...spacedEdits(13, 1800),
    );
    const fold = foldTicketActivity(groupTicketActivity(activity), activity);
    expect(fold.lead).toEqual([{ type: "entry", index: 0 }]);
    expect(fold.earlier).toEqual([
      { type: "group", id: 2, family: PROJECT_LINKS, start: 1, end: 4 },
      { type: "entry", index: 4 },
      { type: "entry", index: 5 },
      { type: "entry", index: 6 },
      { type: "entry", index: 7 },
      { type: "entry", index: 8 },
      { type: "entry", index: 9 },
    ]);
    expect(fold.recent.map((row) => (row.type === "entry" ? row.index : null))).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(fold.hiddenActivityCount).toBe(9);
    expect(fold.hiddenCommentCount).toBe(1);
  });
});
