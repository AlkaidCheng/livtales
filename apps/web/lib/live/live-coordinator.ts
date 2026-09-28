import type { LiveTransport } from "./live-transport";
import {
  type LiveSignal,
  replayFrom,
  runOf,
  type TabPage,
} from "./live-signals";

/** The messages the browser's LivTales tabs exchange. */
type TabMessage =
  | {
      readonly type: "report";
      readonly tab: string;
      readonly pages: readonly TabPage[];
    }
  | { readonly type: "leave"; readonly tab: string }
  | { readonly type: "roll-call" }
  | { readonly type: "signal"; readonly signal: LiveSignal };

/** The part of a BroadcastChannel the coordinator uses. */
export interface TabChannel {
  postMessage(message: TabMessage): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<TabMessage>) => void,
  ): void;
  close(): void;
}

/** The part of the Web Locks API the coordinator uses. */
export interface TabLocks {
  request(
    name: string,
    options: { readonly signal: AbortSignal },
    callback: () => Promise<void>,
  ): Promise<unknown>;
}

export interface LiveCoordinatorOptions {
  readonly tabId: string;
  /** Opens the connection, in the tab that holds it. */
  readonly openTransport: (
    onSignal: (signal: LiveSignal) => void,
  ) => LiveTransport;
  /** Receives every signal, in every tab. */
  readonly onSignal: (signal: LiveSignal) => void;
  /** The channel to the browser's other tabs; null alone. */
  readonly channel: TabChannel | null;
  /** Elects the tab that holds the connection; null holds it here. */
  readonly locks: TabLocks | null;
  readonly clock?: () => number;
}

const lockName = "livtales-live";
/** How often a tab reports its pages, and after how long a silent tab is forgotten. */
const reportMs = 20_000;
const forgetMs = 60_000;
/** How long the connection stays open with no tab in front. */
const backgroundMs = 5 * 60_000;

interface Report {
  readonly pages: readonly TabPage[];
  readonly at: number;
}

/**
 * One connection per browser. The tab holding the lock opens it for the
 * pages every tab reports and hands each signal to them all; when that tab
 * closes, the next takes the lock and opens its own, resuming each page
 * from the latest position the tabs had. The connection closes after five
 * minutes with no tab in front.
 */
export class LiveCoordinator {
  readonly #tabId: string;
  readonly #openTransport: LiveCoordinatorOptions["openTransport"];
  readonly #onSignal: (signal: LiveSignal) => void;
  readonly #channel: TabChannel | null;
  readonly #clock: () => number;
  readonly #stopped = new AbortController();
  readonly #reports = new Map<string, Report>();
  #own: readonly TabPage[] = [];
  #transport: LiveTransport | null = null;
  #position: string | null = null;
  #lastHereAt: number;
  readonly #timer: ReturnType<typeof setInterval>;

  constructor(options: LiveCoordinatorOptions) {
    this.#tabId = options.tabId;
    this.#openTransport = options.openTransport;
    this.#onSignal = options.onSignal;
    this.#channel = options.channel;
    this.#clock = options.clock ?? Date.now;
    this.#lastHereAt = this.#clock();
    this.#channel?.addEventListener("message", (event) =>
      this.#receive(event.data),
    );
    if (options.locks === null || this.#channel === null) void this.#lead();
    else
      options.locks
        .request(lockName, { signal: this.#stopped.signal }, () => this.#lead())
        .catch(() => undefined);
    this.#timer = setInterval(() => this.#tick(), reportMs);
  }

  /** The latest position this tab knows, which pages it starts showing are read from. */
  position(): string | null {
    return this.#position;
  }

  /** Sets the pages this tab shows. */
  report(pages: readonly TabPage[]): void {
    this.#own = pages;
    if (this.#transport === null)
      this.#post({ type: "report", tab: this.#tabId, pages });
    else this.#merge();
  }

  stop(): void {
    if (this.#stopped.signal.aborted) return;
    this.#post({ type: "leave", tab: this.#tabId });
    this.#stopped.abort();
    clearInterval(this.#timer);
    this.#transport?.close();
    this.#transport = null;
    this.#channel?.close();
  }

  /** Holds the connection until this tab stops. */
  #lead(): Promise<void> {
    if (this.#stopped.signal.aborted) return Promise.resolve();
    this.#transport = this.#openTransport((signal) => {
      this.#learn(signal);
      this.#onSignal(signal);
      this.#post({ type: "signal", signal });
    });
    this.#post({ type: "roll-call" });
    this.#merge();
    return new Promise((resolve) =>
      this.#stopped.signal.addEventListener("abort", () => resolve(), {
        once: true,
      }),
    );
  }

  #receive(message: TabMessage): void {
    switch (message.type) {
      case "report":
        if (this.#transport === null) return;
        this.#reports.set(message.tab, {
          pages: message.pages,
          at: this.#clock(),
        });
        this.#merge();
        return;
      case "leave":
        if (this.#reports.delete(message.tab)) this.#merge();
        return;
      case "roll-call":
        this.#post({ type: "report", tab: this.#tabId, pages: this.#own });
        return;
      case "signal":
        this.#learn(message.signal);
        this.#onSignal(message.signal);
        return;
    }
  }

  #learn(signal: LiveSignal): void {
    if (signal.kind === "position" || signal.kind === "change")
      this.#position = signal.position;
  }

  /** Reports this tab's pages again, forgets silent tabs, and closes an idle connection. */
  #tick(): void {
    if (this.#transport === null) {
      this.#post({ type: "report", tab: this.#tabId, pages: this.#own });
      return;
    }
    const now = this.#clock();
    for (const [tab, report] of this.#reports)
      if (now - report.at >= forgetMs) this.#reports.delete(tab);
    this.#merge();
  }

  /** The pages every tab shows, as one watch each, handed to the connection. */
  #merge(): void {
    const transport = this.#transport;
    if (transport === null) return;
    const reports = [
      { pages: this.#own, at: this.#clock() },
      ...this.#reports.values(),
    ];
    const merged = new Map<
      string,
      {
        here: boolean;
        place: string | null;
        placeAt: number;
        since: (string | null)[];
      }
    >();
    for (const report of reports)
      for (const page of report.pages) {
        const entry = merged.get(page.page) ?? {
          here: false,
          place: null,
          placeAt: -1,
          since: [],
        };
        entry.since.push(page.since);
        // Where a person is on a page is the place of a tab showing it in front.
        const rank = (page.here ? 1e15 : 0) + report.at;
        if (rank > entry.placeAt) {
          entry.place = page.place;
          entry.placeAt = rank;
        }
        entry.here ||= page.here;
        merged.set(page.page, entry);
      }
    const run = this.#position === null ? null : runOf(this.#position);
    const pages = [...merged].map(([page, entry]) => ({
      page,
      here: entry.here,
      place: entry.place,
      since: replayFrom(entry.since, run),
    }));
    const now = this.#clock();
    if (pages.some((page) => page.here)) this.#lastHereAt = now;
    transport.setPages(pages);
    transport.setActive(now - this.#lastHereAt < backgroundMs);
  }

  #post(message: TabMessage): void {
    if (this.#stopped.signal.aborted && message.type !== "leave") return;
    try {
      this.#channel?.postMessage(message);
    } catch {
      // A closed channel has no other tabs to tell.
    }
  }
}
