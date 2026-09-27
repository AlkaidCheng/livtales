import { afterEach, describe, expect, it } from "vitest";
import {
  defaultTimePreferences,
  setActiveTimePreferences,
} from "../i18n/active-preferences";
import { eventMonthKey, groupEventsByMonth } from "../lib/event-groups";

interface Listed {
  readonly id: string;
  readonly startsOn: string | null;
  readonly startsAt: string | null;
}

const on = (id: string, startsOn: string): Listed => ({
  id,
  startsOn,
  startsAt: null,
});
const at = (id: string, startsAt: string): Listed => ({
  id,
  startsOn: null,
  startsAt,
});
const undated = (id: string): Listed => ({
  id,
  startsOn: null,
  startsAt: null,
});

afterEach(() => {
  setActiveTimePreferences(defaultTimePreferences);
});

const shape = (groups: ReturnType<typeof groupEventsByMonth<Listed>>) => ({
  years: groups.years.map((year) => [
    year.key,
    year.count,
    year.months.map((month) => [
      month.key,
      month.month,
      month.events.map(({ id }) => id),
    ]),
  ]),
  undated: groups.undated.map(({ id }) => id),
});

describe("events by year and month", () => {
  it("runs forward by year and month, the undated events apart for the end", () => {
    setActiveTimePreferences({
      ...defaultTimePreferences,
      timeZone: "UTC",
    });
    const groups = groupEventsByMonth(
      [
        at("gathering", "2026-10-10T10:00:00.000Z"),
        at("supper", "2026-10-24T19:00:00.000Z"),
        // A multi-day event sits under the month it starts in.
        { ...on("kyoto", "2026-11-14"), endsOn: "2026-12-20" },
        at("cabin", "2027-01-09T09:00:00.000Z"),
        undated("studio"),
      ],
      "forward",
    );
    expect(shape(groups)).toEqual({
      years: [
        [
          "2026",
          3,
          [
            ["2026-10", 10, ["gathering", "supper"]],
            ["2026-11", 11, ["kyoto"]],
          ],
        ],
        ["2027", 1, [["2027-01", 1, ["cabin"]]]],
      ],
      undated: ["studio"],
    });
  });

  it("runs back from the most recent month and keeps each month's order", () => {
    const groups = groupEventsByMonth(
      [
        on("picnic", "2026-08-16"),
        on("reunion", "2026-07-04"),
        on("graduation", "2026-06-12"),
        on("eve", "2025-12-31"),
        on("walk", "2025-10-19"),
      ],
      "back",
    );
    expect(shape(groups).years).toEqual([
      [
        "2026",
        3,
        [
          ["2026-08", 8, ["picnic"]],
          ["2026-07", 7, ["reunion"]],
          ["2026-06", 6, ["graduation"]],
        ],
      ],
      [
        "2025",
        2,
        [
          ["2025-12", 12, ["eve"]],
          ["2025-10", 10, ["walk"]],
        ],
      ],
    ]);
  });

  it("keeps one group for a month that returns later, as a continued page brings it", () => {
    setActiveTimePreferences({
      ...defaultTimePreferences,
      timeZone: "UTC",
    });
    const groups = groupEventsByMonth(
      [
        at("first", "2026-10-01T09:00:00.000Z"),
        at("november", "2026-11-02T09:00:00.000Z"),
        at("late", "2026-10-30T09:00:00.000Z"),
      ],
      "forward",
    );
    expect(shape(groups).years).toEqual([
      [
        "2026",
        3,
        [
          ["2026-10", 10, ["first", "late"]],
          ["2026-11", 11, ["november"]],
        ],
      ],
    ]);
  });

  it("places a timed start in the account's zone and a date-only start on its own date", () => {
    const newYear = at("party", "2027-01-01T02:00:00.000Z");
    const dateOnly = on("holiday", "2027-01-01");
    setActiveTimePreferences({
      ...defaultTimePreferences,
      timeZone: "America/Los_Angeles",
    });
    expect(eventMonthKey(newYear)).toBe("2026-12");
    expect(eventMonthKey(dateOnly)).toBe("2027-01");
    expect(shape(groupEventsByMonth([newYear, dateOnly], "forward"))).toEqual({
      years: [
        ["2026", 1, [["2026-12", 12, ["party"]]]],
        ["2027", 1, [["2027-01", 1, ["holiday"]]]],
      ],
      undated: [],
    });
    // A zone given in place of the account's.
    expect(eventMonthKey(newYear, "Asia/Tokyo")).toBe("2027-01");
    expect(eventMonthKey(undated("plan"))).toBeNull();
  });
});
