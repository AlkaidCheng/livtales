import { type EventView, parseEventView } from "./event-views";

/** Where an event was left: the view shown, or one of its pages. */
export type EventPlace =
  { readonly view: EventView } | { readonly page: string };

const pageId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A place the app can open: one of its views other than the Pages view,
 * or a page by its id. Anything else is null, and the event then opens on
 * its Overview.
 */
export function placeOf(value: unknown): EventPlace | null {
  if (typeof value !== "object" || value === null) return null;
  const view: unknown = Reflect.get(value, "view");
  const page: unknown = Reflect.get(value, "page");
  if (typeof page === "string" && pageId.test(page)) return { page };
  if (typeof view === "string" && view !== "pages") {
    const parsed = parseEventView(view);
    return parsed === view ? { view: parsed } : null;
  }
  return null;
}

/** A place as one word, "view:calendar" or "page:<id>"; no place is the Overview. */
export function placeToken(
  place: { readonly view: string } | { readonly page: string } | null,
): string {
  if (place === null) return "view:overview";
  return "page" in place ? `page:${place.page}` : `view:${place.view}`;
}
