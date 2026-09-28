import { randomBytes } from "node:crypto";

import type { GrantedRecord } from "@livtales/authorization";
import type { WorkspaceSight } from "@livtales/object-model";
import type {
  EventPlanningResourceResponse,
  LabelResponse,
  LiveActor,
  LiveChange,
  LiveChangeCause,
  LiveEnvelope,
  LivePresence,
  LiveView,
  SectionResponse,
} from "@livtales/schemas";

import { seesRecord, seesSection } from "./live-sight.js";

/** The account a stream or poll belongs to. */
export interface LiveViewer {
  readonly userId: string;
  readonly displayName: string;
}

/** What a viewer may see of one page, resolved when the page is first watched. */
export interface PageAccess {
  readonly page: string;
  readonly workspaceId: string;
  /** For an Event's page: the Event, and the scope root it inherits. */
  readonly event: { readonly id: string; readonly scopeId: string } | null;
  readonly sight: WorkspaceSight;
}

/** The connection a stream writes its frames to. */
export interface LiveSink {
  write(frame: string): void;
  /** Bytes written but not yet sent. */
  readonly backlog: number;
  end(): void;
}

interface AnnouncementBase {
  readonly workspaceId: string;
  readonly actor: LiveActor;
  readonly at: string;
}

/** A changed object: the facts its sight is decided by, the Events showing it, and its state. */
export interface AnnouncedObject {
  readonly record: GrantedRecord;
  readonly events: readonly string[];
  readonly state: EventPlanningResourceResponse;
}

/**
 * A confirmed change as the API announces it, before any viewer's sight is
 * applied. Objects reach the Events showing them and every space page of
 * their workspace; `departed` names objects that left an Event's page.
 */
export type Announcement =
  | (AnnouncementBase & {
      readonly kind: "objects";
      readonly cause: LiveChangeCause;
      readonly objects: readonly AnnouncedObject[];
      readonly departed: readonly {
        readonly id: string;
        readonly event: string;
      }[];
    })
  | (AnnouncementBase & {
      readonly kind: "sections";
      readonly eventId: string;
      readonly sections: readonly SectionResponse[];
      readonly removed: readonly {
        readonly id: string;
        readonly view: string;
      }[];
    })
  | (AnnouncementBase & {
      readonly kind: "labels";
      readonly labels: readonly LabelResponse[];
      readonly removed: readonly string[];
    })
  | (AnnouncementBase & {
      readonly kind: "layout";
      readonly eventId: string;
      readonly version: number;
    });

/** One page as a stream or poll asks to watch it, with the access resolved for it. */
export interface WatchEntry {
  readonly page: string;
  /** Null when the account cannot open the page, which is then not watched. */
  readonly access: PageAccess | null;
  readonly since: string | null;
  readonly here: boolean;
  readonly place: string | null;
}

export interface LivePollResult {
  readonly position: string;
  readonly changes: LiveEnvelope[];
  readonly presence: LivePresence[];
  readonly views: LiveView[];
  readonly reset: string[];
  readonly unavailable: string[];
}

export interface LiveHubOptions {
  readonly clock?: () => number;
  /** How long changes are kept for replay. */
  readonly bufferMs?: number;
  readonly bufferLimit?: number;
  /** How long a person stays on a page after closing it or switching away. */
  readonly presenceGraceMs?: number;
  /** How long a stream stays open before the browser is asked to reconnect. */
  readonly streamLifetimeMs?: number;
  /** The longest a stream stays silent before a keep-alive line. */
  readonly pingMs?: number;
  /** How long a browser that polls counts as present without polling. */
  readonly pollerTtlMs?: number;
  readonly streamsPerUser?: number;
  readonly maximumStreams?: number;
  /** The unsent bytes past which a stream that does not keep up is closed. */
  readonly maximumBacklogBytes?: number;
  readonly sweepMs?: number;
}

interface Watch {
  readonly access: PageAccess;
  here: boolean;
  place: string | null;
  touchedAt: number;
  /** The people last written to the stream for the page. */
  shownPresence: string | null;
}

interface Watcher {
  readonly id: string;
  readonly viewer: LiveViewer;
  /** The session a stream was opened with, so signing it out closes it. */
  readonly session: string | null;
  /** Null for a browser that polls. */
  readonly sink: LiveSink | null;
  readonly openedAt: number;
  lastWriteAt: number;
  lastSeenAt: number;
  readonly watches: Map<string, Watch>;
  /** A poller's view notices and reset pages not yet collected. */
  readonly views: LiveView[];
  readonly resets: Set<string>;
}

interface PresenceEntry {
  displayName: string;
  place: string | null;
  here: boolean;
  lastHere: number;
}

interface Buffered {
  readonly seq: number;
  readonly at: number;
  readonly announcement: Announcement;
}

/** The API process has as many streams open as it serves. */
export class LiveCapacityError extends Error {
  constructor() {
    super("Live updates are at capacity.");
    this.name = "LiveCapacityError";
  }
}

const pendingViewLimit = 20;

/**
 * The confirmed changes of one API process and the browsers watching
 * them. Changes are numbered in the order they were announced and kept in
 * memory for replay; each is filtered by every viewer's sight before it is
 * written to their stream or collected by their poll. Presence is kept per
 * page from the pages the browsers say they show in front.
 */
export class LiveHub {
  readonly #run = randomBytes(4).toString("hex");
  readonly #clock: () => number;
  readonly #bufferMs: number;
  readonly #bufferLimit: number;
  readonly #presenceGraceMs: number;
  readonly #streamLifetimeMs: number;
  readonly #pingMs: number;
  readonly #pollerTtlMs: number;
  readonly #streamsPerUser: number;
  readonly #maximumStreams: number;
  readonly #maximumBacklogBytes: number;
  readonly #sweepMs: number;
  #seq = 0;
  /** The highest number dropped from the buffer; a position before it cannot be resumed. */
  #trimmedThrough = 0;
  readonly #buffer: Buffered[] = [];
  /**
   * By `events|<workspace>` and `spaces|<workspace>`: the number of the
   * latest change in the workspace that went unannounced to those pages
   * because none watched them. A page resumed from before it is reset.
   */
  readonly #skipped = new Map<string, number>();
  readonly #watchers = new Map<string, Watcher>();
  readonly #presence = new Map<string, Map<string, PresenceEntry>>();
  #timer: NodeJS.Timeout | undefined;

  constructor(options: LiveHubOptions = {}) {
    this.#clock = options.clock ?? Date.now;
    this.#bufferMs = options.bufferMs ?? 10 * 60_000;
    this.#bufferLimit = options.bufferLimit ?? 5_000;
    this.#presenceGraceMs = options.presenceGraceMs ?? 30_000;
    this.#streamLifetimeMs = options.streamLifetimeMs ?? 15 * 60_000;
    this.#pingMs = options.pingMs ?? 25_000;
    this.#pollerTtlMs = options.pollerTtlMs ?? 15_000;
    this.#streamsPerUser = options.streamsPerUser ?? 8;
    this.#maximumStreams = options.maximumStreams ?? 2_000;
    this.#maximumBacklogBytes = options.maximumBacklogBytes ?? 512 * 1024;
    this.#sweepMs = options.sweepMs ?? 5_000;
  }

  /** The position of the latest change. */
  position(): string {
    return `${this.#run}.${this.#seq}`;
  }

  /** Starts the timer that sends keep-alive lines and expires streams, polls, and presence. */
  start(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setInterval(() => this.sweep(), this.#sweepMs);
    this.#timer.unref();
  }

  /** Stops the timer and ends every stream, for shutdown. */
  stop(): void {
    clearInterval(this.#timer);
    this.#timer = undefined;
    for (const watcher of this.#watchers.values()) watcher.sink?.end();
    this.#watchers.clear();
    this.#presence.clear();
  }

  /**
   * Opens a stream for the viewer and writes its first frame. The
   * viewer's oldest stream closes when it already holds the most one
   * account may.
   */
  openStream(
    viewer: LiveViewer,
    sink: LiveSink,
    session: string | null,
  ): string {
    const streams = [...this.#watchers.values()].filter(
      (watcher) => watcher.sink !== null,
    );
    if (streams.length >= this.#maximumStreams) throw new LiveCapacityError();
    const own = streams.filter(
      (watcher) => watcher.viewer.userId === viewer.userId,
    );
    const excess = own.length - this.#streamsPerUser + 1;
    for (const watcher of own.slice(0, Math.max(0, excess)))
      this.closeStream(watcher.id);
    const now = this.#clock();
    const id = randomBytes(18).toString("base64url");
    const watcher: Watcher = {
      id,
      viewer,
      session,
      sink,
      openedAt: now,
      lastWriteAt: now,
      lastSeenAt: now,
      watches: new Map(),
      views: [],
      resets: new Set(),
    };
    this.#watchers.set(id, watcher);
    sink.write("retry: 3000\n\n");
    this.#send(watcher, "ready", { stream: id, position: this.position() });
    return id;
  }

  /** Ends a stream and takes its viewer off the pages it showed. */
  closeStream(id: string): void {
    const watcher = this.#watchers.get(id);
    if (watcher?.sink == null) return;
    this.#watchers.delete(id);
    watcher.sink.end();
    this.#refreshPresence(watcher.watches.keys());
  }

  /** The pages a viewer's stream watches, with their access; undefined for another account's stream or none. */
  watchedPages(
    id: string,
    userId: string,
  ): ReadonlyMap<string, PageAccess> | undefined {
    const watcher = this.#watchers.get(id);
    if (watcher?.sink == null || watcher.viewer.userId !== userId)
      return undefined;
    return new Map(
      [...watcher.watches].map(([page, watch]) => [page, watch.access]),
    );
  }

  /**
   * Sets the pages a stream watches. A page watched for the first time
   * replays the changes after its `since`, or, when they are gone, stays
   * watched with a reset asking for its data to be read again; a page
   * already watched only moves its presence.
   */
  watch(id: string, entries: readonly WatchEntry[]): void {
    const watcher = this.#watchers.get(id);
    if (watcher?.sink == null) return;
    const added = this.#setWatches(watcher, entries);
    const reset: string[] = [];
    for (const entry of entries) {
      if (!added.has(entry.page) || entry.since === null) continue;
      const replay = this.#replay(watcher.watches.get(entry.page), entry.since);
      if (replay === null) reset.push(entry.page);
      else
        for (const envelope of replay)
          this.#send(watcher, "change", envelope.change, envelope.position);
    }
    for (const page of added) this.#sendPresence(watcher, page);
    if (reset.length > 0)
      this.#send(watcher, "reset", { pages: reset, position: this.position() });
  }

  /**
   * Answers a browser that polls: the changes on each page after its
   * `since`, the pages to read again, the people on them, and the account's
   * view notices. The browser counts as present on its pages until it stops
   * polling.
   */
  poll(
    viewer: LiveViewer,
    client: string,
    entries: readonly WatchEntry[],
  ): LivePollResult {
    const id = `poll:${viewer.userId}:${client}`;
    const now = this.#clock();
    let watcher = this.#watchers.get(id);
    if (watcher === undefined) {
      watcher = {
        id,
        viewer,
        session: null,
        sink: null,
        openedAt: now,
        lastWriteAt: now,
        lastSeenAt: now,
        watches: new Map(),
        views: [],
        resets: new Set(),
      };
      this.#watchers.set(id, watcher);
    }
    watcher.lastSeenAt = now;
    this.#setWatches(watcher, entries);
    const changes: LiveEnvelope[] = [];
    const reset: string[] = [];
    for (const entry of entries) {
      const watch = watcher.watches.get(entry.page);
      if (watch === undefined) continue;
      if (watcher.resets.has(entry.page)) {
        reset.push(entry.page);
        continue;
      }
      if (entry.since === null) continue;
      const replay = this.#replay(watch, entry.since);
      if (replay === null) reset.push(entry.page);
      else changes.push(...replay);
    }
    watcher.resets.clear();
    changes.sort((first, second) => sequence(first) - sequence(second));
    return {
      position: this.position(),
      changes,
      presence: [...watcher.watches.keys()].map((page) =>
        this.#presenceOf(page),
      ),
      views: watcher.views.splice(0),
      reset,
      unavailable: entries
        .filter((entry) => entry.access === null)
        .map((entry) => entry.page),
    };
  }

  /** Whether any browser watches an Event's page or a space page of the workspace. */
  watching(workspaceId: string): {
    readonly events: boolean;
    readonly spaces: boolean;
  } {
    let events = false;
    let spaces = false;
    for (const watcher of this.#watchers.values())
      for (const watch of watcher.watches.values()) {
        if (watch.access.workspaceId !== workspaceId) continue;
        if (watch.access.event === null) spaces = true;
        else events = true;
      }
    return { events, spaces };
  }

  /**
   * Numbers a change in the workspace that went unannounced to its Event
   * pages, or to all of its pages, because none were watched; a browser
   * resuming one of them from before it reads the page again.
   */
  skip(workspaceId: string, pages: "events" | "all"): void {
    this.#seq += 1;
    this.#skipped.set(`events|${workspaceId}`, this.#seq);
    if (pages === "all") this.#skipped.set(`spaces|${workspaceId}`, this.#seq);
  }

  /** Numbers a confirmed change, keeps it for replay, and writes it to every stream it reaches. */
  announce(announcement: Announcement): void {
    this.#seq += 1;
    const entry = { seq: this.#seq, at: this.#clock(), announcement };
    this.#buffer.push(entry);
    this.#trim(entry.at);
    const position = this.position();
    const now = new Date(entry.at);
    for (const watcher of [...this.#watchers.values()]) {
      if (watcher.sink === null) continue;
      for (const watch of watcher.watches.values()) {
        const change = render(announcement, watch.access, now);
        if (change !== null) this.#send(watcher, "change", change, position);
      }
    }
  }

  /** Tells the account's other browsers that its own view of an Event or page changed. */
  notifyView(userId: string, view: LiveView): void {
    for (const watcher of [...this.#watchers.values()]) {
      if (watcher.viewer.userId !== userId) continue;
      if (watcher.sink !== null) this.#send(watcher, "view", view);
      else if (watcher.views.length < pendingViewLimit)
        watcher.views.push(view);
    }
  }

  /**
   * Stops watching the pages the predicate picks and tells their browsers
   * to read them again, for a change to what the viewer may see of them;
   * they are watched again, with the access resolved anew, once the
   * browser asks for them.
   */
  resetWhere(
    predicate: (viewer: LiveViewer, access: PageAccess) => boolean,
  ): void {
    for (const watcher of [...this.#watchers.values()]) {
      const pages = [...watcher.watches]
        .filter(([, watch]) => predicate(watcher.viewer, watch.access))
        .map(([page]) => page);
      if (pages.length > 0) this.#reset(watcher, pages);
    }
  }

  /** Ends an account's streams: those opened with the session, or all of them. */
  closeSessions(userId: string, session: string | null): void {
    for (const watcher of [...this.#watchers.values()]) {
      if (watcher.viewer.userId !== userId) continue;
      if (watcher.sink === null) {
        if (session === null) {
          this.#watchers.delete(watcher.id);
          this.#refreshPresence(watcher.watches.keys());
        }
      } else if (session === null || watcher.session === session)
        this.closeStream(watcher.id);
    }
  }

  /**
   * Sends keep-alive lines, closes streams past their lifetime or too far
   * behind, forgets browsers that stopped polling, and lets people who
   * left a page go once their grace has passed.
   */
  sweep(): void {
    const now = this.#clock();
    this.#trim(now);
    const touched = new Set<string>();
    for (const watcher of [...this.#watchers.values()]) {
      if (watcher.sink === null) {
        if (now - watcher.lastSeenAt < this.#pollerTtlMs) continue;
        this.#watchers.delete(watcher.id);
        for (const page of watcher.watches.keys()) touched.add(page);
      } else if (now - watcher.openedAt >= this.#streamLifetimeMs)
        this.closeStream(watcher.id);
      else if (now - watcher.lastWriteAt >= this.#pingMs) {
        watcher.sink.write(": ping\n\n");
        watcher.lastWriteAt = now;
      }
    }
    for (const [page, entries] of this.#presence)
      if ([...entries.values()].some((entry) => !entry.here)) touched.add(page);
    this.#refreshPresence(touched);
  }

  /** Replaces a watcher's pages; returns the pages it did not watch before. */
  #setWatches(watcher: Watcher, entries: readonly WatchEntry[]): Set<string> {
    const now = this.#clock();
    const added = new Set<string>();
    const touched = new Set<string>(watcher.watches.keys());
    const wanted = new Map(
      entries.flatMap((entry) =>
        entry.access === null ? [] : [[entry.page, entry] as const],
      ),
    );
    for (const page of [...watcher.watches.keys()])
      if (!wanted.has(page)) watcher.watches.delete(page);
    for (const [page, entry] of wanted) {
      touched.add(page);
      const watch = watcher.watches.get(page);
      if (watch !== undefined) {
        if (watch.here !== entry.here || watch.place !== entry.place)
          watch.touchedAt = now;
        watch.here = entry.here;
        watch.place = entry.place;
        continue;
      }
      if (entry.access === null) continue;
      watcher.watches.set(page, {
        access: entry.access,
        here: entry.here,
        place: entry.place,
        touchedAt: now,
        shownPresence: null,
      });
      added.add(page);
    }
    this.#refreshPresence(touched);
    return added;
  }

  /** The changes after `since` that reach the watch, or null when they can no longer be replayed. */
  #replay(watch: Watch | undefined, since: string): LiveEnvelope[] | null {
    const from = this.#resumable(since);
    if (from === null || watch === undefined) return null;
    const pages = watch.access.event === null ? "spaces" : "events";
    const skipped = this.#skipped.get(`${pages}|${watch.access.workspaceId}`);
    if (skipped !== undefined && skipped > from) return null;
    const envelopes: LiveEnvelope[] = [];
    for (const entry of this.#buffer) {
      if (entry.seq <= from) continue;
      const change = render(
        entry.announcement,
        watch.access,
        new Date(entry.at),
      );
      if (change !== null)
        envelopes.push({ position: `${this.#run}.${entry.seq}`, change });
    }
    return envelopes;
  }

  /** The number a position names when every change after it is still kept. */
  #resumable(position: string): number | null {
    const [run, number] = position.split(".");
    const seq = Number(number);
    if (run !== this.#run || !Number.isSafeInteger(seq)) return null;
    if (seq > this.#seq || seq < this.#trimmedThrough) return null;
    return seq;
  }

  #reset(watcher: Watcher, pages: readonly string[]): void {
    for (const page of pages) watcher.watches.delete(page);
    if (watcher.sink === null)
      for (const page of pages) watcher.resets.add(page);
    else this.#send(watcher, "reset", { pages, position: this.position() });
    this.#refreshPresence(pages);
  }

  #trim(now: number): void {
    let drop = 0;
    while (
      drop < this.#buffer.length &&
      (this.#buffer.length - drop > this.#bufferLimit ||
        now - (this.#buffer[drop]?.at ?? now) > this.#bufferMs)
    )
      drop += 1;
    if (drop === 0) return;
    this.#trimmedThrough = this.#buffer[drop - 1]?.seq ?? this.#trimmedThrough;
    this.#buffer.splice(0, drop);
    for (const [key, seq] of this.#skipped)
      if (seq <= this.#trimmedThrough) this.#skipped.delete(key);
  }

  #send(watcher: Watcher, event: string, data: unknown, id?: string): void {
    const sink = watcher.sink;
    if (sink === null || this.#watchers.get(watcher.id) !== watcher) return;
    sink.write(
      `${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
    );
    watcher.lastWriteAt = this.#clock();
    if (sink.backlog > this.#maximumBacklogBytes) this.closeStream(watcher.id);
  }

  /** Recomputes who is on each page and writes the pages whose people changed. */
  #refreshPresence(pages: Iterable<string>): void {
    const now = this.#clock();
    for (const page of new Set(pages)) {
      const entries =
        this.#presence.get(page) ?? new Map<string, PresenceEntry>();
      const here = new Map<string, { viewer: LiveViewer; watch: Watch }>();
      for (const watcher of this.#watchers.values()) {
        const watch = watcher.watches.get(page);
        if (watch?.here !== true) continue;
        const current = here.get(watcher.viewer.userId);
        if (current === undefined || watch.touchedAt >= current.watch.touchedAt)
          here.set(watcher.viewer.userId, { viewer: watcher.viewer, watch });
      }
      for (const [userId, entry] of entries) {
        if (here.has(userId)) continue;
        if (entry.here) {
          entry.here = false;
          entry.lastHere = now;
        } else if (now - entry.lastHere >= this.#presenceGraceMs)
          entries.delete(userId);
      }
      for (const [userId, { viewer, watch }] of here)
        entries.set(userId, {
          displayName: viewer.displayName,
          place: watch.place,
          here: true,
          lastHere: now,
        });
      if (entries.size === 0) this.#presence.delete(page);
      else this.#presence.set(page, entries);
      const presence = this.#presenceOf(page);
      for (const watcher of [...this.#watchers.values()])
        this.#sendPresence(watcher, page, presence);
    }
  }

  /** Writes who is on the page to a stream watching it, when that changed since it was last written. */
  #sendPresence(
    watcher: Watcher,
    page: string,
    presence: LivePresence = this.#presenceOf(page),
  ): void {
    const watch = watcher.watches.get(page);
    if (watch === undefined || watcher.sink === null) return;
    const key = JSON.stringify(presence.people);
    if (watch.shownPresence === key) return;
    watch.shownPresence = key;
    this.#send(watcher, "presence", presence);
  }

  #presenceOf(page: string): LivePresence {
    const entries =
      this.#presence.get(page) ?? new Map<string, PresenceEntry>();
    return {
      page,
      people: [...entries]
        .map(([userId, entry]) => ({
          userId,
          displayName: entry.displayName,
          place: entry.place,
        }))
        .sort(
          (first, second) =>
            first.displayName.localeCompare(second.displayName) ||
            first.userId.localeCompare(second.userId),
        ),
    };
  }
}

function sequence(envelope: LiveEnvelope): number {
  return Number(envelope.position.split(".")[1]);
}

/** The change as one watch of a page receives it, or null when nothing of it reaches the viewer. */
export function render(
  announcement: Announcement,
  access: PageAccess,
  now: Date,
): LiveChange | null {
  if (announcement.workspaceId !== access.workspaceId) return null;
  const base = {
    page: access.page,
    actor: announcement.actor,
    at: announcement.at,
  };
  const event = access.event;
  switch (announcement.kind) {
    case "objects": {
      const objects: EventPlanningResourceResponse[] = [];
      const removed: string[] = [];
      for (const object of announcement.objects) {
        if (event !== null && !object.events.includes(event.id)) continue;
        if (seesRecord(access.sight, object.record, now))
          objects.push(object.state);
        else if (!access.sight.member) removed.push(object.record.id);
      }
      for (const departed of announcement.departed)
        if (departed.event === event?.id && !removed.includes(departed.id))
          removed.push(departed.id);
      if (objects.length === 0 && removed.length === 0) return null;
      return {
        ...base,
        kind: "objects",
        cause: announcement.cause,
        objects,
        removed,
      };
    }
    case "sections": {
      if (event?.id !== announcement.eventId) return null;
      const sections = announcement.sections.filter((section) =>
        seesSection(access.sight, event, section, now),
      );
      const removed = announcement.removed
        .filter((section) => seesSection(access.sight, event, section, now))
        .map(({ id }) => id);
      if (sections.length === 0 && removed.length === 0) return null;
      return { ...base, kind: "sections", sections, removed };
    }
    case "labels":
      return {
        ...base,
        kind: "labels",
        labels: [...announcement.labels],
        removed: [...announcement.removed],
      };
    case "layout":
      if (event?.id !== announcement.eventId) return null;
      return { ...base, kind: "layout", version: announcement.version };
  }
}
