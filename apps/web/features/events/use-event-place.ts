"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  useChangeEventView,
  useEventViewState,
} from "../../lib/event-layout-queries";
import { type EventPlace, placeToken } from "../../lib/event-place";

/** How long the account stays on a view or page before it becomes the event's place. */
export const placeSettleMs = 1500;

/**
 * Keeps where the account is on the event (`place`, stable while it does
 * not change) as the place the event opens at again, on every device.
 * The place is saved once the account has stayed on a view or page for a
 * moment, so moving through the tabs does not save each one, and at once
 * when the account leaves the event, the page, or the browser tab.
 * Returns a way to save a place still waiting at once, for an action that
 * may take the event out of the account's reach (Move to Trash).
 */
export function useKeepEventPlace(
  eventId: string,
  place: EventPlace | null,
): () => void {
  const view = useEventViewState(eventId);
  const changeView = useChangeEventView(eventId);
  // The place not yet saved, for a departure to save.
  const waiting = useRef<EventPlace | null>(null);
  const kept = view === undefined ? undefined : placeToken(view.place);
  useEffect(() => {
    if (place === null || kept === undefined) return;
    if (placeToken(place) === kept) {
      waiting.current = null;
      return;
    }
    waiting.current = place;
    const timer = window.setTimeout(() => {
      waiting.current = null;
      changeView(() => ({ place }));
    }, placeSettleMs);
    return () => window.clearTimeout(timer);
  }, [changeView, kept, place]);
  const depart = useCallback(
    (leaving: boolean) => {
      const place = waiting.current;
      if (place === null) return;
      waiting.current = null;
      changeView(() => ({ place }), { leaving });
    },
    [changeView],
  );
  useEffect(() => {
    const onPageHide = () => depart(true);
    const onHidden = () => {
      if (document.visibilityState === "hidden") depart(true);
    };
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onHidden);
      depart(false);
    };
  }, [depart]);
  return useCallback(() => depart(false), [depart]);
}
