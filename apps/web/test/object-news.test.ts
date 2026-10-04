import { ApiClientError } from "@livtales/api-client";
import type { LiveChange } from "@livtales/schemas";
import { describe, expect, it, vi } from "vitest";

import {
  goneOf,
  newsOf,
  ObjectFollows,
  type ObjectNews,
  refusalOf,
} from "../lib/live/object-news";

const eventId = "019d6e7d-0000-7000-8000-000000000002";
const taskId = "019d6e7d-0000-7000-8000-000000000003";
const chen = "019d6e7d-0000-7000-8000-00000000000c";
const viewer = "019d6e7d-0000-7000-8000-00000000000a";

function state(overrides: Record<string, unknown> = {}) {
  return {
    id: taskId,
    objectType: "task",
    displayName: "Buy tickets",
    version: 2,
    deletedAt: null,
    ...overrides,
  };
}

function change(
  cause: Extract<LiveChange, { kind: "objects" }>["cause"],
  objects: readonly Record<string, unknown>[],
  removed: readonly string[] = [],
  userId = chen,
): LiveChange {
  return {
    kind: "objects",
    page: `event:${eventId}`,
    actor: { userId, displayName: "Chen", tabId: null },
    at: "2026-09-29T10:00:00.000Z",
    cause,
    objects,
    removed,
  } as unknown as LiveChange;
}

function news(overrides: Partial<ObjectNews>): ObjectNews {
  return {
    cause: "updated",
    actor: "Chen",
    state: state() as unknown as ObjectNews["state"],
    ...overrides,
  };
}

describe("newsOf", () => {
  it("gives each object its state and the person who changed it", () => {
    const told = newsOf(change("updated", [state()]), viewer);
    expect(told.get(taskId)).toEqual({
      cause: "updated",
      actor: "Chen",
      state: state(),
    });
  });

  it("names nobody for the viewer's own change on another device", () => {
    const told = newsOf(change("updated", [state()], [], viewer), viewer);
    expect(told.get(taskId)?.actor).toBeNull();
  });

  it("has an object that left the page carry no state", () => {
    const told = newsOf(
      change("excluded", [state({ id: eventId })], [taskId]),
      viewer,
    );
    expect(told.get(taskId)?.state).toBeUndefined();
    expect(told.get(eventId)?.state).toBeDefined();
  });

  it("tells nothing of sections, labels, or layouts", () => {
    const sections = {
      kind: "sections",
      page: `event:${eventId}`,
      actor: { userId: chen, displayName: "Chen", tabId: null },
      at: "2026-09-29T10:00:00.000Z",
      sections: [],
      removed: [taskId],
    } as LiveChange;
    expect(newsOf(sections, viewer).size).toBe(0);
  });
});

describe("goneOf", () => {
  it("leaves a confirmation standing while the object stays as it expects", () => {
    expect(goneOf(news({}))).toBeNull();
    expect(
      goneOf(
        news({
          state: state({ deletedAt: "2026-09-29T10:00:00.000Z" }) as never,
        }),
        true,
      ),
    ).toBeNull();
  });

  it("ends it once the object went to Trash, naming who", () => {
    expect(
      goneOf(
        news({
          cause: "trashed",
          state: state({ deletedAt: "2026-09-29T10:00:00.000Z" }) as never,
        }),
      ),
    ).toEqual({ kind: "trashed", actor: "Chen" });
  });

  it("ends one about a record in Trash once it came back out", () => {
    expect(goneOf(news({ cause: "recovered" }), true)).toEqual({
      kind: "restored",
      actor: "Chen",
    });
  });

  it("tells taken off the page from out of the viewer's sight", () => {
    expect(goneOf(news({ cause: "excluded", state: undefined }))).toEqual({
      kind: "removed",
      actor: "Chen",
    });
    expect(goneOf(news({ cause: "updated", state: undefined }))).toEqual({
      kind: "unavailable",
      actor: "Chen",
    });
  });
});

describe("refusalOf", () => {
  it("reads a missing or forbidden object as unavailable", () => {
    for (const status of [403, 404])
      expect(
        refusalOf(new ApiClientError(status, "not_found", "Not found.")),
      ).toEqual({ kind: "unavailable", actor: null });
  });

  it("reads a stale version as changed", () => {
    expect(
      refusalOf(new ApiClientError(409, "version_conflict", "Changed.")),
    ).toEqual({ kind: "changed", actor: null });
  });

  it("leaves any other failure to its own notice", () => {
    expect(refusalOf(null)).toBeNull();
    expect(refusalOf(new Error("Offline"))).toBeNull();
    expect(
      refusalOf(new ApiClientError(409, "move_changed", "Changed.")),
    ).toBeNull();
    expect(
      refusalOf(new ApiClientError(500, "internal_error", "Failed.")),
    ).toBeNull();
  });
});

describe("ObjectFollows", () => {
  it("tells only the followers of the objects a change touched, until they stop", () => {
    const follows = new ObjectFollows();
    const task = vi.fn();
    const other = vi.fn();
    const stop = follows.follow(taskId, task);
    follows.follow(eventId, other);
    follows.tell(change("updated", [state()]), viewer);
    expect(task).toHaveBeenCalledWith(
      expect.objectContaining({ cause: "updated", actor: "Chen" }),
    );
    expect(other).not.toHaveBeenCalled();
    stop();
    follows.tell(change("updated", [state({ version: 3 })]), viewer);
    expect(task).toHaveBeenCalledTimes(1);
  });
});
