import { type EventView, parseEventView } from "./event-views";

/** Where an event was left: the view shown, or one of its pages. */
export type EventPlace =
  { readonly view: EventView } | { readonly page: string };

/**
 * Where the account left each event, kept in this browser so an event
 * opened again returns there. Only the event's id and the view or page id
 * are kept, under the account's id, for the most recent events; storage
 * that is blocked or full keeps nothing, and the event then opens on its
 * Overview.
 */
const storageKey = "chronelle.event-places";
const kept = 50;

type Entry = readonly [key: string, place: EventPlace];

const pageId =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function placeOf(value: unknown): EventPlace | null {
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

/** The kept places, least recent first; anything unreadable is dropped. */
function readPlaces(): Entry[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(storageKey) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item): Entry[] => {
      if (!Array.isArray(item) || typeof item[0] !== "string") return [];
      const place = placeOf(item[1]);
      return place === null ? [] : [[item[0], place]];
    });
  } catch {
    return [];
  }
}

const keyOf = (accountId: string, eventId: string) => `${accountId}:${eventId}`;

/** Where the account left the event in this browser, if it was kept. */
export function rememberedEventPlace(
  accountId: string,
  eventId: string,
): EventPlace | null {
  const key = keyOf(accountId, eventId);
  return readPlaces().find(([entry]) => entry === key)?.[1] ?? null;
}

/** Keeps where the account is on the event, as its most recent place. */
export function rememberEventPlace(
  accountId: string,
  eventId: string,
  place: EventPlace,
): void {
  const key = keyOf(accountId, eventId);
  const places = readPlaces().filter(([entry]) => entry !== key);
  places.push([key, place]);
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify(places.slice(-kept)),
    );
  } catch {
    // Blocked or full storage keeps nothing; the event opens on its Overview.
  }
}
