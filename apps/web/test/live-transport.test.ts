import { ApiClientError, type LivTalesApiClient } from "@livtales/api-client";
import type { LivePollRequest, LivePollResponse } from "@livtales/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { LiveSignal, TabPage } from "../lib/live/live-signals";
import { openLiveTransport } from "../lib/live/live-transport";

const eventId = "019d6e7d-0000-7000-8000-000000000002";
const page = `event:${eventId}`;
const run = "0a1b2c3d";

/** A stand-in for the browser's EventSource that the test feeds frames to. */
class FakeSource {
  static opened: FakeSource[] = [];
  readonly listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeSource.opened.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown, lastEventId = "") {
    for (const listener of this.listeners.get(type) ?? [])
      listener(
        new MessageEvent(type, { data: JSON.stringify(data), lastEventId }),
      );
  }

  fail() {
    this.onerror?.();
  }
}

const change = (name: string) => ({
  page,
  actor: { userId: eventId, displayName: "Chen", tabId: null },
  at: "2030-01-01T00:00:00.000Z",
  kind: "layout" as const,
  version: Number(name),
});

function setup(options: { failWatch?: boolean } = {}) {
  const signals: LiveSignal[] = [];
  const watchLive = vi.fn(
    async (_stream: string, input: { pages: readonly TabPage[] }) => {
      if (options.failWatch)
        throw new ApiClientError(
          404,
          "stream_closed",
          "The live stream is closed.",
        );
      return {
        pages: input.pages.map((entry) => ({
          page: entry.page,
          watching: true,
        })),
      };
    },
  );
  const pollLive = vi.fn(
    async (_input: LivePollRequest): Promise<LivePollResponse> => ({
      position: `${run}.9`,
      changes: [{ position: `${run}.8`, change: change("8") }],
      presence: [{ page, people: [] }],
      views: [],
      reset: [],
      unavailable: [],
    }),
  );
  const transport = openLiveTransport({
    client: { watchLive, pollLive } as unknown as LivTalesApiClient,
    onSignal: (signal) => signals.push(signal),
    openStream: (url) => new FakeSource(url) as unknown as EventSource,
    pollMs: 3_000,
  });
  return { transport, signals, watchLive, pollLive };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSource.opened = [];
});

afterEach(() => {
  vi.useRealTimers();
});

const tabPage = (since: string | null): TabPage => ({
  page,
  since,
  here: true,
  place: "todos",
});

describe("live transport", () => {
  it("watches the pages once the stream is ready, and resumes a new stream from the latest position", async () => {
    const { transport, signals, watchLive } = setup();
    transport.setPages([tabPage(`${run}.3`)]);
    const first = FakeSource.opened[0];
    expect(first?.url).toBe("/api/live");
    first?.emit("ready", {
      stream: "stream-aaaaaaaaaaaaaaaa",
      position: `${run}.5`,
    });
    await vi.waitFor(() => expect(watchLive).toHaveBeenCalled());
    expect(watchLive.mock.calls[0]?.[1]).toEqual({
      pages: [tabPage(`${run}.3`)],
    });
    first?.emit("change", change("6"), `${run}.6`);
    expect(signals).toContainEqual({
      kind: "change",
      position: `${run}.6`,
      change: change("6"),
    });

    first?.fail();
    expect(first?.closed).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    const second = FakeSource.opened[1];
    second?.emit("ready", {
      stream: "stream-bbbbbbbbbbbbbbbb",
      position: `${run}.7`,
    });
    await vi.waitFor(() => expect(watchLive).toHaveBeenCalledTimes(2));
    expect(watchLive.mock.calls[1]).toEqual([
      "stream-bbbbbbbbbbbbbbbb",
      { pages: [tabPage(`${run}.6`)] },
    ]);
    transport.close();
  });

  it("tells the tabs to read their pages again when the API restarted", async () => {
    const { transport, signals, watchLive } = setup();
    transport.setPages([tabPage(`${run}.3`)]);
    FakeSource.opened[0]?.emit("ready", {
      stream: "stream-aaaaaaaaaaaaaaaa",
      position: `${run}.5`,
    });
    await vi.waitFor(() => expect(watchLive).toHaveBeenCalled());
    FakeSource.opened[0]?.fail();
    await vi.advanceTimersByTimeAsync(1_000);
    FakeSource.opened[1]?.emit("ready", {
      stream: "stream-bbbbbbbbbbbbbbbb",
      position: "ffffffff.2",
    });
    expect(signals).toContainEqual({
      kind: "reset",
      pages: [page],
      position: "ffffffff.2",
    });
    await vi.waitFor(() => expect(watchLive).toHaveBeenCalledTimes(2));
    expect(watchLive.mock.calls[1]?.[1]).toEqual({
      pages: [tabPage("ffffffff.2")],
    });
    transport.close();
  });

  it("opens a new stream when the API closed the one it watched on", async () => {
    const { transport } = setup({ failWatch: true });
    transport.setPages([tabPage(null)]);
    FakeSource.opened[0]?.emit("ready", {
      stream: "stream-aaaaaaaaaaaaaaaa",
      position: `${run}.1`,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeSource.opened[0]?.closed).toBe(true);
    expect(FakeSource.opened).toHaveLength(2);
    transport.close();
  });

  it("polls every few seconds once the stream fails to open three times", async () => {
    const { transport, signals, pollLive } = setup();
    transport.setPages([tabPage(`${run}.3`)]);
    for (const wait of [1_000, 3_000, 0]) {
      FakeSource.opened.at(-1)?.fail();
      await vi.advanceTimersByTimeAsync(wait);
    }
    expect(FakeSource.opened).toHaveLength(3);
    await vi.waitFor(() => expect(pollLive).toHaveBeenCalledTimes(1));
    expect(pollLive.mock.calls[0]?.[0]).toMatchObject({
      pages: [tabPage(`${run}.3`)],
    });
    expect(signals).toEqual(
      expect.arrayContaining([
        { kind: "change", position: `${run}.8`, change: change("8") },
        { kind: "presence", presence: { page, people: [] } },
      ]),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(pollLive).toHaveBeenCalledTimes(2);
    expect(pollLive.mock.calls[1]?.[0]).toMatchObject({
      pages: [tabPage(`${run}.9`)],
    });
    transport.setActive(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pollLive).toHaveBeenCalledTimes(2);
    transport.close();
  });

  it("closes the stream while no tab is in front and opens it again", () => {
    const { transport } = setup();
    transport.setActive(false);
    expect(FakeSource.opened[0]?.closed).toBe(true);
    transport.setActive(true);
    expect(FakeSource.opened).toHaveLength(2);
    transport.close();
    expect(FakeSource.opened[1]?.closed).toBe(true);
  });
});
