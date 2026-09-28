import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiveCoordinator,
  type TabChannel,
  type TabLocks,
} from "../lib/live/live-coordinator";
import type { LiveSignal, TabPage } from "../lib/live/live-signals";
import type { LiveTransport } from "../lib/live/live-transport";

const eventId = "019d6e7d-0000-7000-8000-000000000002";
const page = `event:${eventId}`;
const tasks = "tasks:019d6e7d-0000-7000-8000-000000000001";

/** Channels between the tabs of one test, delivering to every other tab as a browser does. */
function tabBus() {
  const members = new Set<{ deliver: (message: unknown) => void }>();
  return {
    open(): TabChannel {
      const listeners: ((event: MessageEvent) => void)[] = [];
      const member = {
        deliver: (message: unknown) => {
          for (const listener of listeners)
            listener(new MessageEvent("message", { data: message }));
        },
      };
      members.add(member);
      return {
        postMessage(message) {
          for (const other of members)
            if (other !== member) other.deliver(message);
        },
        addEventListener(_type, listener) {
          listeners.push(listener as (event: MessageEvent) => void);
        },
        close() {
          members.delete(member);
        },
      };
    },
  };
}

/** One lock at a time, handed to the next waiting tab once its holder lets go. */
function tabLocks(): TabLocks {
  let held: Promise<unknown> = Promise.resolve();
  return {
    request(_name, { signal }, callback) {
      const turn = held.then(() => (signal.aborted ? undefined : callback()));
      held = turn.catch(() => undefined);
      return turn;
    },
  };
}

interface Opened {
  readonly pages: TabPage[][];
  readonly active: boolean[];
  closed: boolean;
  send: (signal: LiveSignal) => void;
}

function tab(
  bus: ReturnType<typeof tabBus>,
  locks: TabLocks,
  name: string,
  clock: () => number,
) {
  const received: LiveSignal[] = [];
  const opened: Opened[] = [];
  const coordinator = new LiveCoordinator({
    tabId: name,
    channel: bus.open(),
    locks,
    clock,
    onSignal: (signal) => received.push(signal),
    openTransport: (send): LiveTransport => {
      const transport: Opened = { pages: [], active: [], closed: false, send };
      opened.push(transport);
      return {
        setPages: (pages) => transport.pages.push([...pages]),
        setActive: (active) => transport.active.push(active),
        close: () => {
          transport.closed = true;
        },
      };
    },
  });
  return { coordinator, received, opened };
}

let now = 0;
const clock = () => now;

beforeEach(() => {
  vi.useFakeTimers();
  now = 1_000_000;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("live coordinator", () => {
  it("holds one connection for the pages of every tab and hands each signal to them all", async () => {
    const bus = tabBus();
    const locks = tabLocks();
    const first = tab(bus, locks, "tab-first", clock);
    const second = tab(bus, locks, "tab-second", clock);
    await vi.waitFor(() => expect(first.opened).toHaveLength(1));
    first.coordinator.report([
      { page, since: "0a1b2c3d.7", here: false, place: "calendar" },
    ]);
    second.coordinator.report([
      { page, since: "0a1b2c3d.4", here: true, place: "todos" },
      { page: tasks, since: null, here: false, place: null },
    ]);
    expect(second.opened).toHaveLength(0);
    expect(first.opened[0]?.pages.at(-1)).toEqual([
      { page, since: "0a1b2c3d.4", here: true, place: "todos" },
      { page: tasks, since: null, here: false, place: null },
    ]);

    const signal: LiveSignal = { kind: "position", position: "0a1b2c3d.9" };
    first.opened[0]?.send(signal);
    expect(first.received).toEqual([signal]);
    expect(second.received).toEqual([signal]);
    expect(second.coordinator.position()).toBe("0a1b2c3d.9");
    first.coordinator.stop();
    second.coordinator.stop();
  });

  it("passes the connection to the next tab when the one holding it closes", async () => {
    const bus = tabBus();
    const locks = tabLocks();
    const first = tab(bus, locks, "tab-first", clock);
    const second = tab(bus, locks, "tab-second", clock);
    await vi.waitFor(() => expect(first.opened).toHaveLength(1));
    second.coordinator.report([
      { page, since: "0a1b2c3d.4", here: true, place: "todos" },
    ]);
    first.coordinator.stop();
    expect(first.opened[0]?.closed).toBe(true);
    await vi.waitFor(() => expect(second.opened).toHaveLength(1));
    expect(second.opened[0]?.pages.at(-1)).toEqual([
      { page, since: "0a1b2c3d.4", here: true, place: "todos" },
    ]);
    second.coordinator.stop();
  });

  it("closes the connection after five minutes with no tab in front, and forgets tabs that went silent", async () => {
    const bus = tabBus();
    const locks = tabLocks();
    const only = tab(bus, locks, "tab-only", clock);
    await vi.waitFor(() => expect(only.opened).toHaveLength(1));
    only.coordinator.report([{ page, since: null, here: false, place: null }]);
    expect(only.opened[0]?.active.at(-1)).toBe(true);
    now += 5 * 60_000;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(only.opened[0]?.active.at(-1)).toBe(false);
    only.coordinator.report([{ page, since: null, here: true, place: null }]);
    expect(only.opened[0]?.active.at(-1)).toBe(true);
    only.coordinator.stop();
  });
});
