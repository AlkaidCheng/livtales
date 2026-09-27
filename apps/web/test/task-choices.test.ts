import type { TaskResponse } from "@livtales/schemas";
import { describe, expect, it } from "vitest";

import {
  chooseEventTasks,
  defaultEventTaskChoices,
  defaultTaskPageChoices,
  readEventTaskChoices,
  readTaskPageChoices,
  standingChoices,
} from "../lib/task-choices";

function task(id: string, fields: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id,
    objectType: "task",
    workspaceId: "workspace",
    permissionScopeId: "event",
    displayName: id,
    status: "todo",
    dueOn: null,
    dueAt: null,
    durationMinutes: null,
    repeatRule: null,
    repeatUntil: null,
    completedAt: null,
    parentTaskId: null,
    assigneeId: null,
    location: null,
    description: null,
    labelIds: [],
    rank: id,
    sectionId: null,
    version: 1,
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    deletedAt: null,
    ...fields,
  } as TaskResponse;
}

const tasks = [
  task("a-venue", { dueOn: "2030-09-25", assigneeId: "mei" }),
  task("b-menu", { labelIds: ["food"], assigneeId: "leo" }),
  task("c-cake", { dueAt: "2030-10-08T03:00:00.000Z", labelIds: ["food"] }),
  task("d-invitations", { status: "done", assigneeId: "leo" }),
  task("e-band", { status: "cancelled" }),
];
const on = { me: "mei", today: "2030-10-01" };
const names = (list: readonly TaskResponse[]) => list.map((item) => item.id);

describe("reading kept task choices", () => {
  it("falls back to each default for what it does not recognize", () => {
    expect(readEventTaskChoices({})).toEqual(defaultEventTaskChoices);
    expect(
      readEventTaskChoices({
        show: "done",
        sort: "sideways",
        assignee: "me",
        label: 3,
        timed: "yes",
        overdue: true,
      }),
    ).toEqual({
      ...defaultEventTaskChoices,
      show: "done",
      assignee: "me",
      overdue: true,
    });
    expect(
      readTaskPageChoices({ show: "all", from: "any", fromName: 7 }),
    ).toEqual({ ...defaultTaskPageChoices, show: "all", from: "any" });
  });
});

describe("standingChoices", () => {
  const names = new Map([["mira", "Mira"]]);
  const labels = new Map([["food", "Food"]]);

  it("keeps what is still named, and a choice whose names are loading", () => {
    const kept = {
      ...defaultEventTaskChoices,
      assignee: "mira",
      label: "food",
    };
    expect(
      standingChoices(kept, { me: "me-person", people: names, labels }),
    ).toEqual(kept);
    const gone = {
      ...defaultEventTaskChoices,
      assignee: "ghost",
      label: "old",
    };
    expect(
      standingChoices(gone, {
        me: undefined,
        people: undefined,
        labels: undefined,
      }),
    ).toEqual(gone);
  });

  it("falls back to any for a person or label gone, and for You without a person", () => {
    expect(
      standingChoices(
        { ...defaultEventTaskChoices, assignee: "ghost", label: "old" },
        { me: "me-person", people: names, labels },
      ),
    ).toMatchObject({ assignee: "", label: "" });
    expect(
      standingChoices(
        { ...defaultEventTaskChoices, assignee: "me", label: "none" },
        { me: undefined, people: names, labels },
      ),
    ).toMatchObject({ assignee: "", label: "none" });
  });
});

describe("chooseEventTasks", () => {
  it("shows the open tasks and counts the finished ones the filters keep", () => {
    const { shown, finished } = chooseEventTasks(
      tasks,
      defaultEventTaskChoices,
      on,
    );
    expect(names(shown)).toEqual(["a-venue", "b-menu", "c-cake"]);
    expect(finished).toBe(2);
  });

  it("shows all, or the done ones alone", () => {
    expect(
      names(
        chooseEventTasks(tasks, { ...defaultEventTaskChoices, show: "all" }, on)
          .shown,
      ),
    ).toHaveLength(5);
    expect(
      names(
        chooseEventTasks(
          tasks,
          { ...defaultEventTaskChoices, show: "done" },
          on,
        ).shown,
      ),
    ).toEqual(["d-invitations"]);
  });

  it("narrows by whom, by label, by time, and by lateness, and counts the finished ones among them", () => {
    const choose = (changes: Partial<typeof defaultEventTaskChoices>) =>
      chooseEventTasks(tasks, { ...defaultEventTaskChoices, ...changes }, on);
    expect(names(choose({ assignee: "me" }).shown)).toEqual(["a-venue"]);
    const leo = choose({ assignee: "leo" });
    expect(names(leo.shown)).toEqual(["b-menu"]);
    expect(leo.finished).toBe(1);
    expect(names(choose({ assignee: "none" }).shown)).toEqual(["c-cake"]);
    expect(names(choose({ label: "food" }).shown)).toEqual([
      "b-menu",
      "c-cake",
    ]);
    expect(names(choose({ label: "none" }).shown)).toEqual(["a-venue"]);
    expect(names(choose({ timed: true }).shown)).toEqual(["c-cake"]);
    const late = choose({ overdue: true });
    expect(names(late.shown)).toEqual(["a-venue"]);
    // Overdue is open by nature: nothing finished is late.
    expect(late.finished).toBe(0);
  });

  it("orders the shown tasks as Sort says", () => {
    expect(
      names(
        chooseEventTasks(
          [
            task("b", { displayName: "Zebra" }),
            task("a", { displayName: "Apple" }),
          ],
          { ...defaultEventTaskChoices, sort: "name" },
          on,
        ).shown,
      ),
    ).toEqual(["a", "b"]);
  });
});
