import type { LiveChange, TaskResponse } from "@livtales/schemas";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  applyLiveChange,
  applyLiveView,
  resetLivePage,
} from "../lib/live/apply-live-change";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const eventId = "019d6e7d-0000-7000-8000-000000000002";
const hallId = "019d6e7d-0000-7000-8000-000000000003";
const cakeId = "019d6e7d-0000-7000-8000-000000000004";
const otherEventId = "019d6e7d-0000-7000-8000-000000000005";

function task(id: string, displayName: string, version: number): TaskResponse {
  return {
    id,
    workspaceId,
    objectType: "task",
    displayName,
    createdBy: workspaceId,
    permissionScopeId: eventId,
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
    version,
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
  };
}

const hall = task(hallId, "Book the hall", 2);
const cake = task(cakeId, "Order the cake", 1);

function change(
  cause: Extract<LiveChange, { kind: "objects" }>["cause"],
  objects: TaskResponse[],
  removed: string[] = [],
): LiveChange {
  return {
    page: `event:${eventId}`,
    actor: { userId: workspaceId, displayName: "Chen", tabId: "tab-chen-1" },
    at: "2030-01-01T00:00:00.000Z",
    kind: "objects",
    cause,
    objects,
    removed,
  };
}

function seeded() {
  const cache = new QueryClient();
  cache.setQueryData(["event", eventId, "todos"], {
    sourceEventId: eventId,
    items: [hall, cake],
    sections: [],
  });
  cache.setQueryData(["object", hallId, "resource"], hall);
  cache.setQueryData(["tasks", { filter: "open" }], {
    pages: [{ items: [{ ...hall, extra: "context" }] }],
    pageParams: [undefined],
  });
  cache.setQueryData(["object", hallId, "history"], {
    items: [{ snapshot: task(hallId, "Old name", 1) }],
  });
  cache.setQueryData(["event", eventId, "timeline"], { items: [] });
  cache.setQueryData(["event", otherEventId, "todos"], { items: [] });
  return cache;
}

const invalidated = (cache: QueryClient, key: unknown[]) =>
  cache.getQueryState(key)?.isInvalidated ?? false;

describe("applying a live change", () => {
  it("writes a newer state wherever the object is held, and reads again only the lists it may reorder", () => {
    const cache = seeded();
    const renamed = task(hallId, "Book the town hall", 3);
    applyLiveChange(cache, change("updated", [renamed]));
    expect(
      cache.getQueryData<{ items: TaskResponse[] }>(["event", eventId, "todos"])
        ?.items,
    ).toEqual([renamed, cake]);
    expect(cache.getQueryData(["object", hallId, "resource"])).toEqual(renamed);
    expect(
      cache.getQueryData<{ pages: { items: unknown[] }[] }>([
        "tasks",
        { filter: "open" },
      ])?.pages[0]?.items,
    ).toEqual([{ ...renamed, extra: "context" }]);
    // History keeps the snapshot it read.
    expect(cache.getQueryData(["object", hallId, "history"])).toEqual({
      items: [{ snapshot: task(hallId, "Old name", 1) }],
    });
    expect(invalidated(cache, ["event", eventId, "todos"])).toBe(false);
    expect(invalidated(cache, ["event", eventId, "timeline"])).toBe(true);
    expect(invalidated(cache, ["tasks", { filter: "open" }])).toBe(true);
    expect(invalidated(cache, ["object", hallId, "history"])).toBe(true);
    expect(invalidated(cache, ["event", otherEventId, "todos"])).toBe(false);
  });

  it("keeps a copy newer than the change", () => {
    const cache = seeded();
    applyLiveChange(cache, change("updated", [task(hallId, "Stale", 1)]));
    expect(cache.getQueryData(["object", hallId, "resource"])).toEqual(hall);
  });

  it("drops trashed and removed objects from the lists and reads the Event's lists again", () => {
    const cache = seeded();
    applyLiveChange(
      cache,
      change(
        "trashed",
        [{ ...hall, version: 3, deletedAt: "2030-01-02T00:00:00.000Z" }],
        [cakeId],
      ),
    );
    expect(
      cache.getQueryData<{ items: TaskResponse[] }>(["event", eventId, "todos"])
        ?.items,
    ).toEqual([]);
    expect(invalidated(cache, ["event", eventId, "todos"])).toBe(true);
    expect(invalidated(cache, ["event", otherEventId, "todos"])).toBe(false);
  });

  it("reads the Event's lists again when an object joins them", () => {
    const cache = seeded();
    applyLiveChange(cache, change("created", [task(otherEventId, "New", 1)]));
    expect(invalidated(cache, ["event", eventId, "todos"])).toBe(true);
  });

  it("reads sections, labels, layouts, views, and reset pages again", () => {
    const cache = seeded();
    for (const key of [
      ["event", eventId, "sections"],
      ["event", eventId, "layout"],
      ["labels", workspaceId],
      ["account", "pages", "tasks"],
    ])
      cache.setQueryData(key, {});
    const base = {
      page: `event:${eventId}`,
      actor: { userId: workspaceId, displayName: "Chen", tabId: null },
      at: "2030-01-01T00:00:00.000Z",
    };
    applyLiveChange(cache, {
      ...base,
      kind: "sections",
      sections: [],
      removed: [],
    });
    expect(invalidated(cache, ["event", eventId, "sections"])).toBe(true);
    applyLiveChange(cache, {
      ...base,
      kind: "labels",
      labels: [],
      removed: [],
    });
    expect(invalidated(cache, ["labels", workspaceId])).toBe(true);
    applyLiveChange(cache, { ...base, kind: "layout", version: 2 });
    expect(invalidated(cache, ["event", eventId, "layout"])).toBe(true);
    applyLiveView(cache, { target: { page: "tasks" }, tabId: null });
    expect(invalidated(cache, ["account", "pages", "tasks"])).toBe(true);

    const fresh = seeded();
    resetLivePage(fresh, `event:${eventId}`);
    expect(invalidated(fresh, ["event", eventId, "todos"])).toBe(true);
    expect(invalidated(fresh, ["event", otherEventId, "todos"])).toBe(false);
  });
});
