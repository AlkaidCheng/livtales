import type { EventResponse } from "@livtales/schemas";
import { calendarDateSchema } from "@livtales/schemas";
import { activeLocale, tr } from "../i18n/active-locale";
import { instantOptions } from "../i18n/active-preferences";
import {
  dateFormat,
  formatDateTime,
  fromDateTimeInput,
  toDateTimeInput,
} from "./format";
import { changedFields } from "./changed-entries";
import { descriptionPayload } from "./description-field";
import { locationPayload } from "./location-field";
import type { FieldGroups } from "./use-editor-draft";
import { instantDayKey } from "./zone";

export interface EventScheduleDraft {
  mode: "unscheduled" | "dates" | "timed";
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
}

export function readEventSchedule(event?: EventResponse): EventScheduleDraft {
  const start = toDateTimeInput(event?.startsAt ?? null);
  const end = toDateTimeInput(event?.endsAt ?? null);
  return {
    mode: event?.startsOn ? "dates" : start ? "timed" : "unscheduled",
    startDate: event?.startsOn ?? start.slice(0, 10),
    endDate: event?.endsOn ?? end.slice(0, 10),
    startTime: start.slice(11),
    endTime: end.slice(11),
  };
}

/** The fields an Event's editors hold. */
export type EventEditorFields = EventScheduleDraft & {
  displayName: string;
  location: string;
  description: string;
};

/** An Event's schedule, which a draft keeps or follows together. */
export const eventFieldGroups: FieldGroups<EventEditorFields> = [
  ["mode", "startDate", "endDate", "startTime", "endTime"],
];

/**
 * An Event's save from its editor's fields, whole; the all-day flag and the
 * time zone stay as the Event has them.
 */
function eventFieldsPayload(
  fields: EventEditorFields,
  source: Pick<EventResponse, "isAllDay" | "timezone">,
) {
  return {
    displayName: fields.displayName,
    description: descriptionPayload(fields.description),
    ...eventSchedulePayload(fields),
    location: locationPayload(fields.location),
    isAllDay: fields.mode === "timed" && source.isAllDay,
    timezone: source.timezone,
  };
}

/**
 * What an Event's draft changed from the version it stands on, as the API
 * takes it: only those entries, the schedule together.
 */
export function eventChanges(
  fields: EventEditorFields,
  baseline: EventEditorFields,
  source: Pick<EventResponse, "isAllDay" | "timezone">,
) {
  return changedFields(
    (draft: EventEditorFields) => eventFieldsPayload(draft, source),
    fields,
    baseline,
    [["startsOn", "endsOn", "startsAt", "endsAt", "isAllDay", "timezone"]],
  );
}

function localInstant(date: string, time: string): string {
  if (
    !calendarDateSchema.safeParse(date).success ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  )
    throw new Error(tr("validation")("validDateTime"));
  const input = `${date}T${time}`;
  const instant = fromDateTimeInput(input);
  if (instant === null || toDateTimeInput(instant) !== input)
    throw new Error(tr("validation")("clockChange"));
  return instant;
}

export function eventSchedulePayload(draft: EventScheduleDraft) {
  const empty = { startsOn: null, endsOn: null, startsAt: null, endsAt: null };
  if (draft.mode === "unscheduled") return empty;
  const v = tr("validation");
  if (!draft.startDate) throw new Error(v("startDate"));
  if (
    !calendarDateSchema.safeParse(draft.startDate).success ||
    (draft.endDate && !calendarDateSchema.safeParse(draft.endDate).success)
  )
    throw new Error(v("validCalendarDates"));
  if (draft.endDate && draft.endDate < draft.startDate)
    throw new Error(v("endBeforeStartDate"));
  if (draft.mode === "dates")
    return {
      ...empty,
      startsOn: draft.startDate,
      endsOn: draft.endDate || null,
    };
  const endDate =
    draft.endDate === draft.startDate && !draft.endTime ? "" : draft.endDate;
  if (Boolean(endDate) !== Boolean(draft.endTime))
    throw new Error(v("endAndTime"));
  const startsAt = localInstant(draft.startDate, draft.startTime);
  const endsAt = endDate ? localInstant(endDate, draft.endTime) : null;
  if (endsAt !== null && endsAt < startsAt)
    throw new Error(v("endBeforeStartTime"));
  return { ...empty, startsAt, endsAt };
}

/** A calendar date in the active locale, the day it names in every zone. */
export function formatCalendarDate(
  date: string,
  locale: string = activeLocale(),
): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

export function formatEventSchedule(
  event: Pick<EventResponse, "startsAt" | "endsAt" | "startsOn" | "endsOn">,
): string {
  const range = (start: string, end: string) =>
    tr("dates")("range", { start, end });
  if (event.startsOn) {
    const start = formatCalendarDate(event.startsOn);
    return event.endsOn && event.endsOn !== event.startsOn
      ? range(start, formatCalendarDate(event.endsOn))
      : start;
  }
  if (event.startsAt === null) return "";
  const start = formatDateTime(event.startsAt);
  return event.endsAt === null
    ? start
    : range(start, formatDateTime(event.endsAt));
}

const dayOptions = {
  month: "short",
  day: "numeric",
} as const satisfies Intl.DateTimeFormatOptions;

/** The year option when two days (YYYY-MM-DD) fall in different years. */
const yearIfCrossed = (start: string, end: string) =>
  start.slice(0, 4) === end.slice(0, 4) ? {} : { year: "numeric" as const };

/**
 * When an event happens, worded for a card under its year's heading: the
 * year shows only where a span ends in another year. One day reads with
 * its weekday ("Sat, Oct 10"), a time after it ("Sat, Oct 10 · 10:00 AM",
 * a same-day end as a span of times), and days as a span that leaves out
 * what the start already names ("Nov 14 – 20", "Oct 30 – Nov 2",
 * "Dec 30, 2026 – Jan 2, 2027"). Calendar dates name their day in every
 * zone; a timed event reads in the account's zone and clock.
 */
export function formatEventWithinYear(
  event: Pick<EventResponse, "startsAt" | "endsAt" | "startsOn" | "endsOn">,
  locale: string = activeLocale(),
): string {
  const span = (start: string, end: string) =>
    tr("dates")("span", { start, end });
  if (event.startsOn) {
    const utc = (options: Intl.DateTimeFormatOptions) =>
      dateFormat(locale, { ...options, timeZone: "UTC" });
    const start = new Date(`${event.startsOn}T00:00:00Z`);
    const endsOn = event.endsOn ?? event.startsOn;
    if (endsOn === event.startsOn)
      return utc({ weekday: "short", ...dayOptions }).format(start);
    const end = new Date(`${endsOn}T00:00:00Z`);
    const days = utc({
      ...yearIfCrossed(event.startsOn, endsOn),
      ...dayOptions,
    });
    const sameMonth = event.startsOn.slice(0, 7) === endsOn.slice(0, 7);
    return span(
      days.format(start),
      (sameMonth ? utc({ day: "numeric" }) : days).format(end),
    );
  }
  if (event.startsAt === null) return "";
  const zone = instantOptions();
  const start = new Date(event.startsAt);
  const end = event.endsAt === null ? start : new Date(event.endsAt);
  const startDay = instantDayKey(start);
  const endDay = instantDayKey(end);
  if (startDay === endDay) {
    const day = dateFormat(locale, {
      weekday: "short",
      ...dayOptions,
      ...zone,
    }).format(start);
    const time = dateFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      ...zone,
    });
    return `${day} · ${
      end.getTime() === start.getTime()
        ? time.format(start)
        : span(time.format(start), time.format(end))
    }`;
  }
  const moment = dateFormat(locale, {
    ...yearIfCrossed(startDay, endDay),
    ...dayOptions,
    hour: "numeric",
    minute: "2-digit",
    ...zone,
  });
  return span(moment.format(start), moment.format(end));
}
