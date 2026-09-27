import type { EventResponse } from "@livtales/schemas";

/** What a calendar file needs of a schedule item. */
export type CalendarItem = Pick<
  EventResponse,
  | "id"
  | "displayName"
  | "startsOn"
  | "endsOn"
  | "startsAt"
  | "endsAt"
  | "location"
  | "description"
  | "updatedAt"
>;

/**
 * An iCalendar file (RFC 5545) holding one VEVENT per dated item, for
 * importing a schedule into another calendar app. Each item keeps its id
 * as its UID, so importing the file again updates the same entries. An
 * all-day item spans its dates (DTEND is the day after its last, as the
 * format counts it); a timed item starts and ends at its instants in UTC,
 * which every calendar shows in its reader's own zone. An item with no
 * date is left out. Text is escaped, long lines are folded at 75 octets
 * without splitting a character, and lines end in CRLF.
 */
export function icsFile(
  items: readonly CalendarItem[],
  options: { readonly name?: string | undefined; readonly now: Date },
): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LivTales//Schedule export//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(options.name === undefined || options.name.trim() === ""
      ? []
      : [`X-WR-CALNAME:${escapeText(options.name.trim())}`]),
    ...items.flatMap((item) => eventLines(item, options.now)),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function eventLines(item: CalendarItem, now: Date): string[] {
  const when = timing(item);
  if (when === null) return [];
  return [
    "BEGIN:VEVENT",
    `UID:${item.id}@livtales`,
    `DTSTAMP:${utcStamp(now)}`,
    ...when,
    `SUMMARY:${escapeText(item.displayName)}`,
    ...(item.location === null || item.location.trim() === ""
      ? []
      : [`LOCATION:${escapeText(item.location)}`]),
    ...(item.description === null || item.description.trim() === ""
      ? []
      : [`DESCRIPTION:${escapeText(item.description)}`]),
    `LAST-MODIFIED:${utcStamp(new Date(item.updatedAt))}`,
    "END:VEVENT",
  ];
}

/** DTSTART and DTEND: dates for an all-day item, UTC instants for a timed one. */
function timing(item: CalendarItem): string[] | null {
  if (item.startsOn !== null) {
    const last =
      item.endsOn !== null && item.endsOn >= item.startsOn
        ? item.endsOn
        : item.startsOn;
    return [
      `DTSTART;VALUE=DATE:${basicDate(item.startsOn)}`,
      `DTEND;VALUE=DATE:${basicDate(dayAfter(last))}`,
    ];
  }
  if (item.startsAt === null) return null;
  const start = new Date(item.startsAt);
  const end = item.endsAt === null ? null : new Date(item.endsAt);
  return [
    `DTSTART:${utcStamp(start)}`,
    ...(end === null || end.getTime() <= start.getTime()
      ? []
      : [`DTEND:${utcStamp(end)}`]),
  ];
}

/** A calendar date, "2026-10-10", as the format writes it: "20261010". */
function basicDate(day: string): string {
  return day.replaceAll("-", "");
}

/** The calendar date after `day`, counted in UTC so no zone moves it. */
function dayAfter(day: string): string {
  const next = new Date(`${day}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/** An instant in UTC in the format's basic form: "20261010T170000Z". */
function utcStamp(instant: Date): string {
  return `${instant
    .toISOString()
    .slice(0, 19)
    .replaceAll("-", "")
    .replaceAll(":", "")}Z`;
}

/**
 * A TEXT value as the format reads it: a backslash, a semicolon, and a
 * comma escaped with a backslash, and a line break written as \n.
 */
export function escapeText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll(/\r\n|\r|\n/gu, "\\n");
}

const encoder = new TextEncoder();

/**
 * A content line folded to at most 75 octets a line: each further line
 * starts with one space, and a character is never split across lines.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    // The space that opens a continued line counts toward its 75 octets.
    const limit = parts.length === 0 ? 75 : 74;
    if (size + width > limit) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += character;
    size += width;
  }
  parts.push(current);
  return parts.join("\r\n ");
}
