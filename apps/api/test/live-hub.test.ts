import type { WorkspaceSight } from "@livtales/object-model";
import type { EventPlanningResourceResponse } from "@livtales/schemas";
import { describe, expect, it } from "vitest";

import {
  type AnnouncedObject,
  type Announcement,
  LiveHub,
  type LiveSink,
  type PageAccess,
  type WatchEntry,
} from "../src/live/live-hub.js";

const workspace = "00000000-0000-7000-8000-0000000000a1";
const otherWorkspace = "00000000-0000-7000-8000-0000000000a2";
const event = "00000000-0000-7000-8000-0000000000e1";
const otherEvent = "00000000-0000-7000-8000-0000000000e2";
const section = "00000000-0000-7000-8000-0000000000c1";
const alice = {
  userId: "00000000-0000-7000-8000-0000000000b1",
  displayName: "Alice",
};
const bea = {
  userId: "00000000-0000-7000-8000-0000000000b2",
  displayName: "Bea",
};
const actor = { ...alice, tabId: "tab-alice-1" };

const member: WorkspaceSight = { member: true, grants: [] };
const todosOnly: WorkspaceSight = {
  member: false,
  grants: [
    { resourceId: event, scope: "todos", sectionId: section, expiresAt: null },
  ],
};

class RecordingSink implements LiveSink {
  readonly frames: string[] = [];
  backlog = 0;
  ended = false;

  write(frame: string): void {
    this.frames.push(frame);
  }

  end(): void {
    this.ended = true;
  }

  /** The events written, as [event, data] pairs; comments and retry lines are left out. */
  events(): [string, unknown][] {
    return this.frames.flatMap((frame) => {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const data = /^data: (.+)$/m.exec(frame)?.[1];
      return event === undefined || data === undefined
        ? []
        : [[event, JSON.parse(data)] as [string, unknown]];
    });
  }

  ofKind(kind: string): unknown[] {
    return this.events()
      .filter(([event]) => event === kind)
      .map(([, data]) => data);
  }
}

function eventPage(sight: WorkspaceSight, id = event): PageAccess {
  return {
    page: `event:${id}`,
    workspaceId: workspace,
    event: { id, scopeId: id },
    sight,
  };
}

function tasksPage(sight: WorkspaceSight): PageAccess {
  return {
    page: `tasks:${workspace}`,
    workspaceId: workspace,
    event: null,
    sight,
  };
}

function entry(
  access: PageAccess,
  options: Partial<Omit<WatchEntry, "access" | "page">> = {},
): WatchEntry {
  return {
    page: access.page,
    access,
    since: null,
    here: false,
    place: null,
    ...options,
  };
}

function task(
  id: string,
  sectionId: string | null,
  events: readonly string[] = [event],
): AnnouncedObject {
  return {
    record: { id, objectType: "task", permissionScopeId: event, sectionId },
    events,
    state: {
      id,
      objectType: "task",
      sectionId,
    } as unknown as EventPlanningResourceResponse,
  };
}

function objects(
  ...announced: AnnouncedObject[]
): Extract<Announcement, { kind: "objects" }> {
  return {
    kind: "objects",
    workspaceId: workspace,
    actor,
    at: "2030-01-01T00:00:00.000Z",
    cause: "updated",
    objects: announced,
    departed: [],
  };
}

const inSection = "00000000-0000-7000-8000-0000000000d1";
const outside = "00000000-0000-7000-8000-0000000000d2";

function setup(options: ConstructorParameters<typeof LiveHub>[0] = {}) {
  let now = 1_000_000;
  const hub = new LiveHub({ clock: () => now, ...options });
  return {
    hub,
    advance: (ms: number) => {
      now += ms;
    },
    open(viewer = alice, session: string | null = null) {
      const sink = new RecordingSink();
      const id = hub.openStream(viewer, sink, session);
      return { id, sink };
    },
  };
}

describe("LiveHub streams", () => {
  it("opens with the stream id and the current position", () => {
    const { open, hub } = setup();
    const { id, sink } = open();
    expect(sink.frames[0]).toBe("retry: 3000\n\n");
    expect(sink.ofKind("ready")).toEqual([
      { stream: id, position: hub.position() },
    ]);
  });

  it("writes a change to each watched page it reaches, filtered by what the viewer may see", () => {
    const { open, hub } = setup();
    const owner = open(alice);
    const guest = open(bea);
    hub.watch(owner.id, [entry(eventPage(member)), entry(tasksPage(member))]);
    hub.watch(guest.id, [entry(eventPage(todosOnly))]);

    hub.announce(objects(task(inSection, section), task(outside, null)));

    const ownerChanges = owner.sink.ofKind("change") as {
      page: string;
      objects: { id: string }[];
    }[];
    expect(ownerChanges.map((change) => change.page)).toEqual([
      `event:${event}`,
      `tasks:${workspace}`,
    ]);
    expect(ownerChanges[0]?.objects.map(({ id }) => id)).toEqual([
      inSection,
      outside,
    ]);
    expect(guest.sink.ofKind("change")).toEqual([
      expect.objectContaining({
        page: `event:${event}`,
        kind: "objects",
        cause: "updated",
        actor,
        objects: [expect.objectContaining({ id: inSection })],
        removed: [outside],
      }),
    ]);
  });

  it("leaves out objects not shown on the watched Event", () => {
    const { open, hub } = setup();
    const owner = open();
    hub.watch(owner.id, [entry(eventPage(member))]);
    hub.announce(objects(task(inSection, null, [otherEvent])));
    hub.announce({
      ...objects(task(inSection, null)),
      workspaceId: otherWorkspace,
    });
    expect(owner.sink.ofKind("change")).toEqual([]);
  });

  it("names an object that departed the Event's page as removed", () => {
    const { open, hub } = setup();
    const owner = open();
    hub.watch(owner.id, [entry(eventPage(member))]);
    hub.announce({
      ...objects(task(inSection, null, [])),
      cause: "excluded",
      departed: [{ id: inSection, event }],
    });
    expect(owner.sink.ofKind("change")).toEqual([
      expect.objectContaining({
        cause: "excluded",
        objects: [],
        removed: [inSection],
      }),
    ]);
  });

  it("shows sections to a narrowed viewer only where the grant reaches", () => {
    const { open, hub } = setup();
    const guest = open(bea);
    hub.watch(guest.id, [entry(eventPage(todosOnly))]);
    const sectionState = (id: string, view: "todos" | "expenses") => ({
      id,
      workspaceId: workspace,
      eventId: event,
      view,
      name: "Section",
      description: null,
      rank: "a",
      createdAt: "2030-01-01T00:00:00.000Z",
      updatedAt: "2030-01-01T00:00:00.000Z",
    });
    hub.announce({
      kind: "sections",
      workspaceId: workspace,
      actor,
      at: "2030-01-01T00:00:00.000Z",
      eventId: event,
      sections: [
        sectionState(section, "todos"),
        sectionState(outside, "todos"),
      ],
      removed: [{ id: inSection, view: "expenses" }],
    });
    expect(guest.sink.ofKind("change")).toEqual([
      expect.objectContaining({
        kind: "sections",
        sections: [expect.objectContaining({ id: section })],
        removed: [],
      }),
    ]);
  });

  it("writes the account's own view notices to its streams only", () => {
    const { open, hub } = setup();
    const own = open(alice);
    const other = open(bea);
    hub.notifyView(alice.userId, { target: { event }, tabId: "tab-alice-1" });
    expect(own.sink.ofKind("view")).toEqual([
      { target: { event }, tabId: "tab-alice-1" },
    ]);
    expect(other.sink.ofKind("view")).toEqual([]);
  });

  it("closes an account's oldest stream past the per-account limit", () => {
    const { open } = setup({ streamsPerUser: 2 });
    const first = open();
    const second = open();
    const third = open();
    expect([first.sink.ended, second.sink.ended, third.sink.ended]).toEqual([
      true,
      false,
      false,
    ]);
  });

  it("closes the streams of a signed-out session, or all of an account's", () => {
    const { open, hub } = setup();
    const phone = open(alice, "phone");
    const laptop = open(alice, "laptop");
    hub.closeSessions(alice.userId, "phone");
    expect([phone.sink.ended, laptop.sink.ended]).toEqual([true, false]);
    hub.closeSessions(alice.userId, null);
    expect(laptop.sink.ended).toBe(true);
  });

  it("pings a quiet stream, closes it after its lifetime, and closes one that falls behind", () => {
    const { open, hub, advance } = setup({
      pingMs: 25_000,
      streamLifetimeMs: 60_000,
      maximumBacklogBytes: 100,
    });
    const quiet = open();
    const slow = open(bea);
    hub.watch(slow.id, [entry(eventPage(member))]);
    advance(25_000);
    hub.sweep();
    expect(quiet.sink.frames.at(-1)).toBe(": ping\n\n");
    slow.sink.backlog = 101;
    hub.announce(objects(task(inSection, null)));
    expect(slow.sink.ended).toBe(true);
    advance(35_000);
    hub.sweep();
    expect(quiet.sink.ended).toBe(true);
  });
});

describe("LiveHub replay", () => {
  it("replays the changes after a page's position when it is first watched", () => {
    const { open, hub } = setup();
    const before = hub.position();
    hub.announce(objects(task(inSection, null)));
    const after = hub.position();
    hub.announce(objects(task(outside, null)));
    const stream = open();
    hub.watch(stream.id, [entry(eventPage(member), { since: before })]);
    const replayed = stream.sink.frames.filter((frame) =>
      frame.includes("event: change"),
    );
    expect(replayed).toHaveLength(2);
    expect(replayed[0]).toMatch(
      new RegExp(`^id: ${after.replace(".", "\\.")}\n`),
    );

    const late = open(bea);
    hub.watch(late.id, [entry(eventPage(member), { since: after })]);
    expect(late.sink.ofKind("change")).toHaveLength(1);
  });

  it("resets a page whose position is from another run or older than the buffer", () => {
    const { open, hub, advance } = setup({ bufferMs: 60_000 });
    const old = hub.position();
    hub.announce(objects(task(inSection, null)));
    advance(61_000);
    hub.announce(objects(task(outside, null)));
    const stream = open();
    hub.watch(stream.id, [
      entry(eventPage(member), { since: old }),
      entry(tasksPage(member), { since: "0000abcd.1" }),
    ]);
    expect(stream.sink.ofKind("reset")).toEqual([
      {
        pages: [`event:${event}`, `tasks:${workspace}`],
        position: hub.position(),
      },
    ]);
    // The pages stay watched while their data is read again.
    expect(hub.watchedPages(stream.id, alice.userId)?.size).toBe(2);
  });

  it("stops watching the pages whose access changed", () => {
    const { open, hub } = setup();
    const stream = open(bea);
    hub.watch(stream.id, [
      entry(eventPage(todosOnly)),
      entry(tasksPage(member)),
    ]);
    hub.resetWhere((_viewer, access) => !access.sight.member);
    expect(stream.sink.ofKind("reset")).toEqual([
      { pages: [`event:${event}`], position: hub.position() },
    ]);
    expect([
      ...(hub.watchedPages(stream.id, bea.userId)?.keys() ?? []),
    ]).toEqual([`tasks:${workspace}`]);
  });

  it("resets a page whose workspace had a change announced while nobody watched it", () => {
    const { open, hub } = setup();
    const since = hub.position();
    hub.skip(workspace, "events");
    const stream = open();
    hub.watch(stream.id, [
      entry(eventPage(member), { since }),
      entry(tasksPage(member), { since }),
    ]);
    expect(stream.sink.ofKind("reset")).toEqual([
      { pages: [`event:${event}`], position: hub.position() },
    ]);
    const later = open(bea);
    hub.watch(later.id, [entry(eventPage(member), { since: hub.position() })]);
    expect(later.sink.ofKind("reset")).toEqual([]);
  });

  it("answers a poll from the buffer and keeps the pages it should read again", () => {
    const { hub } = setup();
    const since = hub.position();
    hub.announce(objects(task(inSection, section)));
    const first = hub.poll(bea, "client-1", [
      entry(eventPage(todosOnly), { since, here: true }),
    ]);
    expect(first.changes).toEqual([
      expect.objectContaining({
        position: hub.position(),
        change: expect.objectContaining({
          objects: [expect.objectContaining({ id: inSection })],
        }),
      }),
    ]);
    expect(first.presence).toEqual([
      {
        page: `event:${event}`,
        people: [{ userId: bea.userId, displayName: "Bea", place: null }],
      },
    ]);

    hub.resetWhere((viewer) => viewer.userId === bea.userId);
    const second = hub.poll(bea, "client-1", [
      entry(eventPage(todosOnly), { since: first.position, here: true }),
      {
        page: `event:${otherEvent}`,
        access: null,
        since: null,
        here: false,
        place: null,
      },
    ]);
    expect(second.reset).toEqual([`event:${event}`]);
    expect(second.unavailable).toEqual([`event:${otherEvent}`]);
  });
});

describe("LiveHub presence", () => {
  it("names who is in front on a page, at the place they were last, until the grace after they leave", () => {
    const { open, hub, advance } = setup({ presenceGraceMs: 30_000 });
    const watcher = open(alice);
    const guest = open(bea);
    hub.watch(watcher.id, [
      entry(eventPage(member), { here: true, place: "tasks" }),
    ]);
    expect(watcher.sink.ofKind("presence")).toHaveLength(1);
    hub.watch(guest.id, [
      entry(eventPage(member), { here: true, place: "calendar" }),
    ]);
    const people = () =>
      (watcher.sink.ofKind("presence").at(-1) as { people: unknown[] }).people;
    expect(people()).toEqual([
      { userId: alice.userId, displayName: "Alice", place: "tasks" },
      { userId: bea.userId, displayName: "Bea", place: "calendar" },
    ]);

    hub.watch(guest.id, [
      entry(eventPage(member), { here: false, place: "calendar" }),
    ]);
    expect(people()).toHaveLength(2);
    advance(29_000);
    hub.sweep();
    expect(people()).toHaveLength(2);
    advance(1_000);
    hub.sweep();
    expect(people()).toEqual([
      { userId: alice.userId, displayName: "Alice", place: "tasks" },
    ]);
  });

  it("lets a browser that stopped polling go", () => {
    const { open, hub, advance } = setup({
      pollerTtlMs: 15_000,
      presenceGraceMs: 30_000,
    });
    const watcher = open(alice);
    hub.watch(watcher.id, [entry(eventPage(member))]);
    hub.poll(bea, "client-1", [entry(eventPage(member), { here: true })]);
    const names = () =>
      (
        watcher.sink.ofKind("presence").at(-1) as {
          people: { displayName: string }[];
        }
      ).people.map((person) => person.displayName);
    expect(names()).toEqual(["Bea"]);
    advance(15_000);
    hub.sweep();
    advance(30_000);
    hub.sweep();
    expect(names()).toEqual([]);
  });
});
