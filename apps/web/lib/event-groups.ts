import type { EventResponse } from "@livtales/schemas";

import { activeTimeZone } from "../i18n/active-preferences";
import { instantDayKey } from "./zone";

type StartingEvent = Pick<EventResponse, "startsOn" | "startsAt">;

/** A month of the Events list: its key (YYYY-MM), its number (1-12), and its events in list order. */
export interface EventMonthGroup<T> {
  readonly key: string;
  readonly month: number;
  readonly events: readonly T[];
}

/** A year of the Events list: its key (YYYY), its months in list order, and how many events they hold. */
export interface EventYearGroup<T> {
  readonly key: string;
  readonly year: number;
  readonly months: readonly EventMonthGroup<T>[];
  readonly count: number;
}

/** The Events list by year and month, and the undated events that close it. */
export interface EventGroups<T> {
  readonly years: readonly EventYearGroup<T>[];
  readonly undated: readonly T[];
}

/** The fold key of the undated events' group. */
export const undatedGroupKey = "undated";

/**
 * The month an event starts in, as YYYY-MM: a date-only start's own
 * month, a timed start's month in the zone (the account's unless given);
 * null for an event without a start.
 */
export function eventMonthKey(
  event: StartingEvent,
  timeZone: string | undefined = activeTimeZone(),
): string | null {
  if (event.startsOn !== null) return event.startsOn.slice(0, 7);
  return event.startsAt === null
    ? null
    : instantDayKey(event.startsAt, timeZone).slice(0, 7);
}

/**
 * Events grouped by the year, then the month, they start in: forward from
 * the earliest month, or back from the most recent one. A month's events
 * keep the order they came in, a multi-day event stays under the month it
 * starts in, and undated events are kept apart for the end. The groups are
 * drawn from everything loaded so far, so a month continued on a later
 * page stays one group.
 */
export function groupEventsByMonth<T extends StartingEvent>(
  events: readonly T[],
  direction: "forward" | "back",
  timeZone: string | undefined = activeTimeZone(),
): EventGroups<T> {
  const months = new Map<string, T[]>();
  const undated: T[] = [];
  for (const event of events) {
    const key = eventMonthKey(event, timeZone);
    if (key === null) {
      undated.push(event);
      continue;
    }
    const month = months.get(key);
    if (month === undefined) months.set(key, [event]);
    else month.push(event);
  }
  const keys = [...months.keys()].sort();
  if (direction === "back") keys.reverse();
  const years: {
    key: string;
    year: number;
    months: EventMonthGroup<T>[];
    count: number;
  }[] = [];
  for (const key of keys) {
    const inMonth = months.get(key) ?? [];
    const yearKey = key.slice(0, 4);
    let year = years.at(-1);
    if (year?.key !== yearKey) {
      year = { key: yearKey, year: Number(yearKey), months: [], count: 0 };
      years.push(year);
    }
    year.months.push({ key, month: Number(key.slice(5, 7)), events: inMonth });
    year.count += inMonth.length;
  }
  return { years, undated };
}
