import { ApiClientError, type LivTalesApiClient } from "@livtales/api-client";
import {
  liveChangeSchema,
  livePresenceSchema,
  liveReadySchema,
  liveResetSchema,
  liveViewSchema,
} from "@livtales/schemas";

import { newId } from "../new-id";
import { type LiveSignal, runOf, type TabPage } from "./live-signals";

/** The browser's connection to the API's live changes, held by one tab. */
export interface LiveTransport {
  /** The pages every tab shows, merged; pages left out stop. */
  setPages(pages: readonly TabPage[]): void;
  /** Closes the connection while no tab is in front, and opens it again. */
  setActive(active: boolean): void;
  close(): void;
}

export interface LiveTransportOptions {
  /**
   * Sends the watch and the poll. Its requests should outlive the page
   * (`keepalive`), so none is cut short as the page goes.
   */
  readonly client: LivTalesApiClient;
  readonly onSignal: (signal: LiveSignal) => void;
  /**
   * Opens the stream. Without server-sent events (outside a browser) the
   * transport stays idle; the poll serves a browser whose streams fail.
   */
  readonly openStream?: ((url: string) => EventSource) | undefined;
  readonly pollMs?: number;
}

/** Stream attempts that fail before the stream is ready, after which the transport polls. */
const streamAttempts = 3;
const retryMs = [1_000, 3_000, 10_000, 30_000];

function openEventSource(url: string): EventSource {
  return new EventSource(url);
}

/**
 * Holds the stream, or polls every few seconds where the stream cannot be
 * held, and hands each signal on. A page first watched replays the changes
 * after the position its tab read it from; once its changes have been
 * followed, a new stream picks up from the latest position seen.
 */
export function openLiveTransport(
  options: LiveTransportOptions,
): LiveTransport {
  const { client, onSignal } = options;
  const pollMs = options.pollMs ?? 3_000;
  const openStream =
    options.openStream ??
    (typeof EventSource === "function" ? openEventSource : undefined);
  const pollClient = newId();
  let pages: readonly TabPage[] = [];
  let active = true;
  let closed = false;
  let mode: "stream" | "poll" = "stream";
  let position: string | null = null;
  /** Pages whose changes this transport has delivered, so a new stream resumes them from `position`. */
  const followed = new Set<string>();
  let source: EventSource | null = null;
  let stream: string | null = null;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let syncing = false;
  let syncAgain = false;

  const see = (next: string) => {
    position = next;
  };
  const sinceOf = (page: TabPage): string | null =>
    followed.has(page.page) && position !== null ? position : page.since;
  const watched = () =>
    pages.map((page) => ({ ...page, since: sinceOf(page) }));
  const schedule = (run: () => void, ms: number) => {
    clearTimeout(timer);
    if (!closed && active) timer = setTimeout(run, ms);
  };

  function emit(signal: LiveSignal): void {
    if (!closed) onSignal(signal);
  }

  function listen(
    eventSource: EventSource,
    event: string,
    read: (data: unknown, id: string) => void,
  ) {
    eventSource.addEventListener(event, (message) => {
      const { data, lastEventId } = message as MessageEvent<string>;
      try {
        read(JSON.parse(data), lastEventId);
      } catch {
        // A frame this client cannot read is left out.
      }
    });
  }

  function connect(): void {
    if (closed || !active || openStream === undefined) return;
    const eventSource = openStream("/api/live");
    source = eventSource;
    let ready = false;
    listen(eventSource, "ready", (data) => {
      const parsed = liveReadySchema.parse(data);
      ready = true;
      failures = 0;
      stream = parsed.stream;
      if (position !== null && runOf(position) !== runOf(parsed.position)) {
        // A new run of the API cannot replay what the tabs hold: they read
        // the pages again and follow them from the new run's position.
        const resumed = pages
          .map((page) => page.page)
          .filter((page) => followed.has(page));
        if (resumed.length > 0)
          emit({ kind: "reset", pages: resumed, position: parsed.position });
      }
      if (position === null || runOf(position) !== runOf(parsed.position))
        see(parsed.position);
      emit({ kind: "position", position: parsed.position });
      void sync();
    });
    listen(eventSource, "change", (data, id) => {
      const change = liveChangeSchema.parse(data);
      see(id);
      emit({ kind: "change", position: id, change });
    });
    listen(eventSource, "presence", (data) =>
      emit({ kind: "presence", presence: livePresenceSchema.parse(data) }),
    );
    listen(eventSource, "view", (data) =>
      emit({ kind: "view", view: liveViewSchema.parse(data) }),
    );
    listen(eventSource, "reset", (data) => {
      const reset = liveResetSchema.parse(data);
      emit({ kind: "reset", pages: reset.pages, position: reset.position });
      // Pages the API stopped watching are asked for again.
      void sync();
    });
    eventSource.onerror = () => {
      eventSource.close();
      if (source !== eventSource) return;
      source = null;
      stream = null;
      if (!ready) failures += 1;
      if (failures >= streamAttempts) {
        mode = "poll";
        schedule(() => void poll(), 0);
        return;
      }
      schedule(
        connect,
        retryMs[Math.min(Math.max(failures - 1, 0), retryMs.length - 1)] ?? 0,
      );
    };
  }

  /** Sends the pages to the stream, one request at a time. */
  async function sync(): Promise<void> {
    if (stream === null) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    const current = stream;
    const sent = watched();
    try {
      const answer = await client.watchLive(current, { pages: sent });
      if (current === stream)
        for (const entry of answer.pages)
          if (entry.watching) followed.add(entry.page);
    } catch (error) {
      if (current === stream) {
        if (error instanceof ApiClientError && error.status === 404) {
          // The stream closed on the API: open a new one.
          source?.close();
          source = null;
          stream = null;
          schedule(connect, retryMs[0] ?? 0);
        } else schedule(() => void sync(), retryMs[1] ?? 0);
      }
    } finally {
      syncing = false;
      if (syncAgain) {
        syncAgain = false;
        void sync();
      }
    }
  }

  async function poll(): Promise<void> {
    if (closed || !active) return;
    try {
      const answer = await client.pollLive({
        client: pollClient,
        pages: watched(),
      });
      if (closed) return;
      if (answer.position !== position)
        emit({ kind: "position", position: answer.position });
      for (const envelope of answer.changes)
        emit({
          kind: "change",
          position: envelope.position,
          change: envelope.change,
        });
      for (const presence of answer.presence)
        emit({ kind: "presence", presence });
      for (const view of answer.views) emit({ kind: "view", view });
      if (answer.reset.length > 0)
        emit({ kind: "reset", pages: answer.reset, position: answer.position });
      see(answer.position);
      for (const page of pages)
        if (!answer.unavailable.includes(page.page)) followed.add(page.page);
      failures = 0;
      schedule(() => void poll(), pollMs);
    } catch {
      failures += 1;
      schedule(
        () => void poll(),
        retryMs[Math.min(failures, retryMs.length - 1)] ?? pollMs,
      );
    }
  }

  function start(): void {
    if (mode === "stream") connect();
    else schedule(() => void poll(), 0);
  }

  function stop(): void {
    clearTimeout(timer);
    source?.close();
    source = null;
    stream = null;
  }

  start();
  return {
    setPages(next) {
      const known = new Set(pages.map((page) => page.page));
      pages = next;
      for (const page of [...followed])
        if (!next.some((entry) => entry.page === page)) followed.delete(page);
      if (mode === "stream") void sync();
      else if (next.some((page) => !known.has(page.page)))
        schedule(() => void poll(), 0);
    },
    setActive(next) {
      if (next === active) return;
      active = next;
      if (active) start();
      else stop();
    },
    close() {
      closed = true;
      stop();
    },
  };
}
