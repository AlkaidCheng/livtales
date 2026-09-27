"use client";

import type { EventPlace } from "./event-place";
import { type EventView, parseEventView } from "./event-views";
import { readAddress, useAddress, writeAddress } from "./location-store";

function useEventLocation() {
  const location = useAddress();
  function select(
    name: "view" | "page",
    value: string | null,
    tidy?: (url: URL) => void,
  ) {
    if (!location) return;
    const url = readAddress();
    if (url.pathname !== location.pathname || url.hash !== location.hash)
      return;
    if (url.searchParams.get(name) === value) return;
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    tidy?.(url);
    writeAddress(url, "push");
  }
  return { location, select };
}

/**
 * Keeps client-side projections bookmarkable without remounting open
 * editors. A page's address is `?page=<id>`; the Pages view without a
 * page named is `?view=pages`, so an address naming neither is an event
 * just opened (see `useEventAddress`).
 */
export function useEventView() {
  const { location, select } = useEventLocation();
  const view = location && parseEventView(location.searchParams.get("view"));
  // A page just chosen is already in the address, so the Pages view then
  // needs no parameter of its own.
  const selectView = (value: EventView) =>
    select(
      "view",
      value === "pages" && readAddress().searchParams.has("page")
        ? null
        : value,
    );
  return [view, selectView] as const;
}

/**
 * Where the address stands for an event: `away` from it (another page, or
 * before the address is known), `bare` at it with neither a view nor a page
 * named, as when the event was just opened, or `placed` at a view or page.
 */
export function useEventAddress(eventId: string): "away" | "bare" | "placed" {
  const location = useAddress();
  if (location === null || location.pathname.split("/").at(-1) !== eventId)
    return "away";
  return location.searchParams.has("view") || location.searchParams.has("page")
    ? "placed"
    : "bare";
}

/** Opens the event at `place` in place of the bare address it was opened at. */
export function landOnEventPlace(place: EventPlace): void {
  const url = readAddress();
  if ("page" in place) url.searchParams.set("page", place.page);
  else url.searchParams.set("view", place.view);
  writeAddress(url, "replace");
}

export function useEventPage() {
  const { location, select } = useEventLocation();
  return [
    location?.searchParams.get("page") ?? null,
    // A page's own address names the Pages view already.
    (id: string) =>
      select("page", id, (url) => {
        if (url.searchParams.get("view") === "pages")
          url.searchParams.delete("view");
      }),
  ] as const;
}
