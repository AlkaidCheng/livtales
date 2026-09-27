"use client";

import type { EventListQuery } from "@livtales/schemas";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { type StoredChoices, usePageChoices } from "./view-choices";

interface Criteria {
  readonly query: string;
  readonly scope: EventListQuery["scope"];
  readonly filter: EventListQuery["filter"];
  readonly sort: EventListQuery["sort"];
}

interface ReturnPoint {
  readonly id: string;
  readonly top: number;
  readonly scrollY: number;
}

/** The Events page's choices the account keeps: its layout, scope, period, and sort. */
type EventPageChoices = Omit<Criteria, "query"> & {
  readonly layout: "grid" | "list";
};

const defaultEventPageChoices: EventPageChoices = {
  layout: "grid",
  scope: "all",
  filter: "all",
  sort: "date",
};

function oneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T {
  return (choices as readonly unknown[]).includes(value)
    ? (value as T)
    : fallback;
}

function readEventPageChoices(stored: StoredChoices): EventPageChoices {
  const defaults = defaultEventPageChoices;
  return {
    layout: oneOf(stored.layout, ["grid", "list"], defaults.layout),
    scope: oneOf(stored.scope, ["all", "mine", "shared"], defaults.scope),
    filter: oneOf(
      stored.filter,
      ["all", "upcoming", "unscheduled", "past"],
      defaults.filter,
    ),
    sort: oneOf(stored.sort, ["date", "updated", "name"], defaults.sort),
  };
}

interface CollectionSession {
  readonly query: string;
  readonly setQuery: (query: string) => void;
  readonly returnPoint: RefObject<ReturnPoint | null>;
}

const CollectionContext = createContext<CollectionSession | null>(null);

/**
 * Holds what the Events collection keeps for the authenticated session
 * alone: the name typed, and the card to return to.
 */
export function EventCollectionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const returnPoint = useRef<ReturnPoint | null>(null);
  return (
    <CollectionContext.Provider value={{ query, setQuery, returnPoint }}>
      {children}
    </CollectionContext.Provider>
  );
}

function useCollectionSession(): CollectionSession {
  const value = useContext(CollectionContext);
  if (!value) throw new Error("EventCollectionProvider is required.");
  return value;
}

/**
 * The Events collection's criteria and layout. The name typed lasts for
 * the session; the layout, scope, period, and sort are kept on the
 * account, so the page opens as it was left on every device. `isPending`
 * holds while they load.
 */
export function useEventCollectionState() {
  const { query, setQuery, returnPoint } = useCollectionSession();
  const page = usePageChoices(
    "events",
    defaultEventPageChoices,
    readEventPageChoices,
  );
  const { layout, ...kept } = page.choices;
  return {
    criteria: { query, ...kept } satisfies Criteria,
    change: (patch: Partial<Criteria>) => {
      returnPoint.current = null;
      const { query: typed, ...choices } = patch;
      if (typed !== undefined) setQuery(typed);
      if (Object.keys(choices).length > 0) page.change(choices);
    },
    layout,
    changeLayout: (value: "grid" | "list") => {
      returnPoint.current = null;
      page.change({ layout: value });
    },
    returnPoint,
    isPending: page.isPending,
  };
}

/** Returns to an opened card after the collection has finished loading. */
export function useEventCollectionReturn(ready: boolean) {
  const { returnPoint } = useCollectionSession();
  const [point] = useState(() => returnPoint.current);
  const container = useRef<HTMLElement | null>(null);
  const restored = useRef(false);

  useEffect(() => {
    if (!point) return;
    const cancel = () => {
      if (!restored.current) returnPoint.current = null;
    };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    for (const event of events)
      window.addEventListener(event, cancel, { passive: true });
    return () => {
      for (const event of events) window.removeEventListener(event, cancel);
    };
  }, [point, returnPoint]);

  useEffect(() => {
    if (!ready || !point || restored.current || returnPoint.current !== point)
      return;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (returnPoint.current !== point) return;
        restored.current = true;
        const card = Array.from(
          container.current?.querySelectorAll<HTMLAnchorElement>(
            "[data-event-id]",
          ) ?? [],
        ).find((element) => element.dataset.eventId === point.id);
        const top = card
          ? window.scrollY + card.getBoundingClientRect().top - point.top
          : point.scrollY;
        (card ?? container.current)?.focus({ preventScroll: true });
        window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [ready, point, returnPoint]);

  function remember(id: string, event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    returnPoint.current = {
      id,
      top: event.currentTarget.getBoundingClientRect().top,
      scrollY: window.scrollY,
    };
  }

  return { container, remember };
}
