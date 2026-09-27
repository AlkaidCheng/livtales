import { describe, expect, it } from "vitest";

import {
  type CalendarItem,
  escapeText,
  foldLine,
  icsFile,
} from "../lib/export/ics";

const now = new Date("2030-09-26T08:30:15.123Z");

function item(fields: Partial<CalendarItem>): CalendarItem {
  return {
    id: "0e8b3c1d-7f3a-4c52-9a51-4f0e6b2d8a11",
    displayName: "Guests arrive",
    startsOn: null,
    endsOn: null,
    startsAt: null,
    endsAt: null,
    location: null,
    description: null,
    updatedAt: "2030-09-20T10:00:00.000Z",
    ...fields,
  };
}

/** The file's lines, unfolded as a reader unfolds them. */
function unfolded(file: string): string[] {
  return file.replaceAll("\r\n ", "").split("\r\n");
}

describe("icsFile", () => {
  it("wraps one VEVENT per dated item in a VCALENDAR, lines ending in CRLF", () => {
    const file = icsFile(
      [
        item({
          startsAt: "2030-10-10T01:00:00.000Z",
          endsAt: "2030-10-10T02:30:00.000Z",
          location: "Garden",
        }),
      ],
      { name: "Autumn gathering", now },
    );
    expect(file.endsWith("\r\n")).toBe(true);
    expect(file.split("\r\n").every((line) => !line.includes("\n"))).toBe(true);
    expect(unfolded(file)).toEqual([
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//LivTales//Schedule export//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:Autumn gathering",
      "BEGIN:VEVENT",
      "UID:0e8b3c1d-7f3a-4c52-9a51-4f0e6b2d8a11@livtales",
      "DTSTAMP:20300926T083015Z",
      "DTSTART:20301010T010000Z",
      "DTEND:20301010T023000Z",
      "SUMMARY:Guests arrive",
      "LOCATION:Garden",
      "LAST-MODIFIED:20300920T100000Z",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ]);
  });

  it("spans an all-day item's dates, the end being the day after its last", () => {
    const lines = unfolded(
      icsFile(
        [
          item({ startsOn: "2030-12-30", endsOn: "2030-12-31" }),
          item({ id: "one-day", startsOn: "2030-02-28" }),
        ],
        { now },
      ),
    );
    expect(lines).toContain("DTSTART;VALUE=DATE:20301230");
    expect(lines).toContain("DTEND;VALUE=DATE:20310101");
    expect(lines).toContain("DTSTART;VALUE=DATE:20300228");
    expect(lines).toContain("DTEND;VALUE=DATE:20300301");
    // No calendar name was given, so none is written.
    expect(lines.some((line) => line.startsWith("X-WR-CALNAME"))).toBe(false);
  });

  it("leaves out an item with no date and an end that does not follow the start", () => {
    const lines = unfolded(
      icsFile(
        [
          item({ id: "undated" }),
          item({
            id: "instant",
            startsAt: "2030-10-10T01:00:00.000Z",
            endsAt: "2030-10-10T01:00:00.000Z",
          }),
        ],
        { now },
      ),
    );
    expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(1);
    expect(lines).not.toContain("UID:undated@livtales");
    expect(lines.some((line) => line.startsWith("DTEND"))).toBe(false);
  });

  it("escapes text and keeps the description's line breaks", () => {
    const lines = unfolded(
      icsFile(
        [
          item({
            displayName: "Lunch, then the market; bring cash",
            startsOn: "2030-10-10",
            location: "Nishiki \\ east gate",
            description: "Meet at noon.\nTable for six,\r\nby the window.",
          }),
        ],
        { now },
      ),
    );
    expect(lines).toContain("SUMMARY:Lunch\\, then the market\\; bring cash");
    expect(lines).toContain("LOCATION:Nishiki \\\\ east gate");
    expect(lines).toContain(
      "DESCRIPTION:Meet at noon.\\nTable for six\\,\\nby the window.",
    );
  });
});

describe("escapeText", () => {
  it("escapes the backslash first so the others are not doubled", () => {
    expect(escapeText("a\\;b,c\nd")).toBe("a\\\\\\;b\\,c\\nd");
  });
});

describe("foldLine", () => {
  const octets = (text: string) => new TextEncoder().encode(text).length;

  it("keeps a short line whole", () => {
    expect(foldLine("SUMMARY:Short")).toBe("SUMMARY:Short");
  });

  it("folds at 75 octets, each further line opening with one space", () => {
    const line = `DESCRIPTION:${"x".repeat(200)}`;
    const parts = foldLine(line).split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect(octets(part)).toBeLessThanOrEqual(75);
    expect(parts.slice(1).every((part) => part.startsWith(" "))).toBe(true);
    expect(
      parts.map((part, at) => (at === 0 ? part : part.slice(1))).join(""),
    ).toBe(line);
  });

  it("never splits a character that takes several octets", () => {
    const line = `SUMMARY:${"秋の集い".repeat(20)}`;
    const parts = foldLine(line).split("\r\n");
    for (const part of parts) {
      expect(octets(part)).toBeLessThanOrEqual(75);
      expect(part).not.toContain("�");
    }
    expect(
      parts.map((part, at) => (at === 0 ? part : part.slice(1))).join(""),
    ).toBe(line);
  });
});
