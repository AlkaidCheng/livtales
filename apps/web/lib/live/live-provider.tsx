"use client";

import type { LivePresence } from "@livtales/schemas";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import { useLeavingApiClient } from "../api-context";
import { useAuthSession } from "../auth-session";
import {
  applyLiveChange,
  applyLiveView,
  resetLivePage,
} from "./apply-live-change";
import { LiveCoordinator } from "./live-coordinator";
import { type LiveSignal, liveTabId, type TabPage } from "./live-signals";
import { openLiveTransport } from "./live-transport";

type People = LivePresence["people"];
const nobody: People = [];

/** Who is on each page, as the connection last said. */
class PresenceStore {
  readonly #people = new Map<string, People>();
  readonly #listeners = new Set<() => void>();

  set(presence: LivePresence): void {
    if (presence.people.length === 0) this.#people.delete(presence.page);
    else this.#people.set(presence.page, presence.people);
    for (const listener of this.#listeners) listener();
  }

  get(page: string): People {
    return this.#people.get(page) ?? nobody;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

interface ShownPage {
  readonly page: string;
  readonly place: string | null;
}

/** The pages this tab shows, reported to the browser's connection. */
class TabPages {
  readonly #shown = new Map<symbol, ShownPage>();
  #coordinator: LiveCoordinator | null = null;

  /** Says this tab shows the page, at the place; returns the way to say it stopped. */
  show(page: ShownPage): () => void {
    const key = Symbol(page.page);
    this.#shown.set(key, page);
    this.report();
    return () => {
      this.#shown.delete(key);
      this.report();
    };
  }

  attach(coordinator: LiveCoordinator | null): void {
    this.#coordinator = coordinator;
    this.report();
  }

  /** Reports each page once, in front while the tab is, read from the latest position the tab knows. */
  report(): void {
    const coordinator = this.#coordinator;
    if (coordinator === null) return;
    const here = document.visibilityState === "visible";
    const since = coordinator.position();
    const pages = new Map<string, TabPage>();
    for (const { page, place } of this.#shown.values())
      pages.set(page, { page, place, here, since });
    coordinator.report([...pages.values()]);
  }
}

interface LiveContextValue {
  readonly pages: TabPages;
  readonly presence: PresenceStore;
}

const LiveContext = createContext<LiveContextValue | null>(null);

/** The channel to the browser's other tabs; null where the page may not open one. */
function tabChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== "function") return null;
  try {
    return new BroadcastChannel("livtales-live");
  } catch {
    return null;
  }
}

function tabLocks(): LockManager | null {
  return typeof navigator === "object" && navigator.locks !== undefined
    ? navigator.locks
    : null;
}

/**
 * Keeps the pages open in this tab current with the changes others
 * confirm: the browser holds one connection to the API, shared by its
 * tabs, and each tab writes what it receives into its own cache. A tab
 * skips the changes it made itself, which its own requests already applied.
 */
export function LiveProvider({ children }: { readonly children: ReactNode }) {
  const cache = useQueryClient();
  // The watch and the poll outlive the page, so leaving it cuts none short.
  const client = useLeavingApiClient();
  const { credential } = useAuthSession();
  const signedIn = credential !== null;
  const [value] = useState<LiveContextValue>(() => ({
    pages: new TabPages(),
    presence: new PresenceStore(),
  }));

  useEffect(() => {
    if (!signedIn) return;
    const { pages, presence } = value;
    const tab = liveTabId();
    const receive = (signal: LiveSignal) => {
      switch (signal.kind) {
        case "change":
          if (signal.change.actor.tabId !== tab)
            applyLiveChange(cache, signal.change);
          return;
        case "presence":
          presence.set(signal.presence);
          return;
        case "view":
          if (signal.view.tabId !== tab) applyLiveView(cache, signal.view);
          return;
        case "reset":
          for (const page of signal.pages) resetLivePage(cache, page);
          // The pages are watched again once this tab reports them.
          pages.report();
          return;
        case "position":
          return;
      }
    };
    let coordinator: LiveCoordinator | null = null;
    const start = () => {
      coordinator = new LiveCoordinator({
        tabId: tab,
        openTransport: (onSignal) => openLiveTransport({ client, onSignal }),
        onSignal: receive,
        channel: tabChannel(),
        locks: tabLocks(),
      });
      pages.attach(coordinator);
    };
    const stop = () => {
      pages.attach(null);
      coordinator?.stop();
      coordinator = null;
    };
    // A page going away lets go of the connection at once, so another tab
    // takes it over; one restored from the back-forward cache starts again.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted && coordinator === null) start();
    };
    const onVisibility = () => pages.report();
    start();
    window.addEventListener("pagehide", stop);
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", stop);
      window.removeEventListener("pageshow", onPageShow);
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [cache, client, signedIn, value]);

  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}

/**
 * Says the component shows a page, while it is mounted: its changes reach
 * this tab, and the person counts as on it, at `place`, while the tab is in
 * front. Null shows nothing.
 */
export function useLivePage(page: string | null, place: string | null): void {
  const live = useContext(LiveContext);
  useEffect(() => {
    if (live === null || page === null) return;
    return live.pages.show({ page, place });
  }, [live, page, place]);
}

/** The people on a page, the viewer included. */
export function usePresence(page: string | null): People {
  const live = useContext(LiveContext);
  return useSyncExternalStore(
    (listener) => live?.presence.subscribe(listener) ?? (() => undefined),
    () => (live === null || page === null ? nobody : live.presence.get(page)),
    () => nobody,
  );
}
