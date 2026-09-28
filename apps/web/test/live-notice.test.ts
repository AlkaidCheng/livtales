import type {
  EventPlanningResourceResponse,
  LiveChange,
  TaskResponse,
} from "@livtales/schemas";
import { describe, expect, it } from "vitest";

import {
  faceOf,
  faceTone,
  others,
  PresenceStore,
} from "../lib/live/live-people";
import { changedParts, noticeOf, noticeWords } from "../lib/live/live-notice";

const eventId = "019d6e7d-0000-7000-8000-000000000002";
const hallId = "019d6e7d-0000-7000-8000-000000000003";

function task(overrides: Partial<TaskResponse> = {}): TaskResponse {
  return {
    id: hallId,
    workspaceId: eventId,
    objectType: "task",
    displayName: "Book the hall",
    createdBy: eventId,
    permissionScopeId: eventId,
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    version: 2,
    archivedAt: null,
    deletedAt: null,
    customProperties: {},
    metadata: {},
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
    rank: "a",
    sectionId: null,
    labelIds: [],
    ...overrides,
  };
}

function objects(
  cause: Extract<LiveChange, { kind: "objects" }>["cause"],
  states: EventPlanningResourceResponse[],
  removed: string[] = [],
): Extract<LiveChange, { kind: "objects" }> {
  return {
    page: `event:${eventId}`,
    actor: { userId: eventId, displayName: "Chen", tabId: null },
    at: "2030-01-01T00:00:00.000Z",
    kind: "objects",
    cause,
    objects: states,
    removed,
  };
}

describe("the pop-up for a change", () => {
  it("names the parts of an object that changed, once each, in field order", () => {
    expect(
      changedParts(
        task(),
        task({
          version: 3,
          dueOn: "2030-02-01",
          durationMinutes: 30,
          labelIds: ["label"],
          updatedAt: "2030-01-02T00:00:00.000Z",
        }),
      ),
    ).toEqual(["due", "labels"]);
  });

  it("words an edit by the parts that differ from the copy the page held", () => {
    const edited = task({ version: 3, dueOn: "2030-02-01", rank: "b" });
    expect(noticeOf(objects("updated", [edited]), () => task())).toEqual({
      verb: "updated",
      objectId: hallId,
      objectName: "Book the hall",
      previousName: "Book the hall",
      parts: ["due"],
    });
  });

  it("stays quiet for an edit the page already holds, or one that only moved the object in its list", () => {
    expect(
      noticeOf(objects("updated", [task({ version: 2 })]), () => task()),
    ).toBeNull();
    expect(
      noticeOf(objects("updated", [task({ version: 3, rank: "b" })]), () =>
        task(),
      ),
    ).toBeNull();
  });

  it("names other causes by their verb, and a removal by the copy the page held", () => {
    expect(
      noticeOf(objects("trashed", [task()]), () => undefined),
    ).toMatchObject({ verb: "trashed", objectName: "Book the hall" });
    expect(
      noticeOf(objects("undone", [task()]), () => undefined),
    ).toMatchObject({ verb: "undid" });
    expect(
      noticeOf(objects("excluded", [], [hallId]), () => task()),
    ).toMatchObject({ verb: "removed", objectId: hallId });
    expect(
      noticeOf(objects("excluded", [], [hallId]), () => undefined),
    ).toBeNull();
  });
});

describe("the sentence a pop-up says", () => {
  const notice = (parts: readonly string[], verb = "updated") =>
    ({
      verb,
      objectId: hallId,
      objectName: "Book the town hall",
      previousName: "Book the hall",
      parts,
    }) as Parameters<typeof noticeWords>[0];

  it("names a rename by both names, and one or two parts by name", () => {
    expect(noticeWords(notice(["name"]))).toEqual({
      key: "renamed",
      before: "Book the hall",
    });
    expect(noticeWords(notice(["due"]))).toEqual({
      key: "changedOne",
      part: "due",
    });
    expect(noticeWords(notice(["name", "due"]))).toEqual({
      key: "changedTwo",
      first: "name",
      second: "due",
    });
  });

  it("says updated for no named part or three and more, and takes other verbs as they are", () => {
    expect(noticeWords(notice([]))).toEqual({ key: "updated" });
    expect(noticeWords(notice(["due", "labels", "status"]))).toEqual({
      key: "updated",
    });
    expect(noticeWords(notice([], "trashed"))).toEqual({ key: "trashed" });
  });
});

describe("faces", () => {
  it("give each person one tone and their initials, and leave the viewer out", () => {
    const chen = { userId: hallId, displayName: "Chen Li", place: null };
    expect(faceTone(hallId)).toBe(faceTone(hallId));
    expect(faceTone(hallId)).toBeGreaterThanOrEqual(0);
    expect(faceTone(hallId)).toBeLessThan(6);
    expect(faceOf(chen)).toEqual({ initials: "CL", tone: faceTone(hallId) });
    expect(faceOf({ userId: eventId, displayName: "美玲" }).initials).toBe(
      "美",
    );
    expect(
      others(
        [chen, { userId: eventId, displayName: "Me", place: null }],
        eventId,
      ),
    ).toEqual([chen]);
  });
});

describe("the people on a page", () => {
  const person = (name: string) => ({
    userId: `019d6e7d-0000-7000-8000-0000000000${name.length}${name.charCodeAt(0) % 10}`,
    displayName: name,
    place: null,
  });

  it("keep the order they arrived in, newest first, and let go of those who left", () => {
    const store = new PresenceStore();
    const page = `event:${eventId}`;
    const [ana, ben, cy] = [person("Ana"), person("Benny"), person("Cyrano")];
    store.set({ page, people: [ana, ben] });
    store.set({ page, people: [ana, ben, cy] });
    expect(store.get(page).map((one) => one.displayName)).toEqual([
      "Cyrano",
      "Ana",
      "Benny",
    ]);
    store.set({ page, people: [cy, ben] });
    expect(store.get(page).map((one) => one.displayName)).toEqual([
      "Cyrano",
      "Benny",
    ]);
    store.set({ page, people: [] });
    expect(store.get(page)).toEqual([]);
  });
});
