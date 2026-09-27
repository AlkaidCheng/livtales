import { afterEach, describe, expect, it } from "vitest";
import en from "../messages/en.json";
import zhHans from "../messages/zh-Hans.json";
import zhHant from "../messages/zh-Hant.json";
import { setActiveLocale } from "../i18n/active-locale";
import {
  defaultTimePreferences,
  setActiveTimePreferences,
} from "../i18n/active-preferences";
import { formatEventWithinYear } from "../lib/event-schedule";

type Messages = Parameters<typeof setActiveLocale>[1];

const none = { startsOn: null, endsOn: null, startsAt: null, endsAt: null };
const dates = (startsOn: string, endsOn: string | null = null) => ({
  ...none,
  startsOn,
  endsOn,
});
const times = (startsAt: string, endsAt: string | null = null) => ({
  ...none,
  startsAt,
  endsAt,
});

/** Intl's spacing (thin and narrow no-break spaces) read as plain spaces. */
const plain = (text: string) => text.replace(/[   ]/g, " ");

function wordedIn(locale: "en" | "zh-Hans" | "zh-Hant", messages: Messages) {
  setActiveLocale(locale, messages);
  return (event: Parameters<typeof formatEventWithinYear>[0]) =>
    plain(formatEventWithinYear(event, locale));
}

afterEach(() => {
  setActiveLocale("en", en);
  setActiveTimePreferences(defaultTimePreferences);
});

describe("an event's dates under its year's heading", () => {
  it("leaves the year to the heading, naming it only where a span crosses into another year", () => {
    setActiveTimePreferences({
      ...defaultTimePreferences,
      timeZone: "America/Los_Angeles",
    });
    const words = wordedIn("en", en);
    expect(words(dates("2027-03-21"))).toBe("Sun, Mar 21");
    expect(words(dates("2027-03-21", "2027-03-21"))).toBe("Sun, Mar 21");
    expect(words(dates("2026-11-14", "2026-11-20"))).toBe("Nov 14 – 20");
    expect(words(dates("2026-10-30", "2026-11-02"))).toBe("Oct 30 – Nov 2");
    expect(words(dates("2026-12-30", "2027-01-02"))).toBe(
      "Dec 30, 2026 – Jan 2, 2027",
    );
    expect(words(times("2026-10-10T17:00:00.000Z"))).toBe(
      "Sat, Oct 10 · 10:00 AM",
    );
    expect(
      words(times("2026-10-10T17:00:00.000Z", "2026-10-10T21:00:00.000Z")),
    ).toBe("Sat, Oct 10 · 10:00 AM – 2:00 PM");
    expect(
      words(times("2026-10-10T17:00:00.000Z", "2026-10-12T21:00:00.000Z")),
    ).toBe("Oct 10, 10:00 AM – Oct 12, 2:00 PM");
    expect(
      words(times("2026-12-31T20:00:00.000Z", "2027-01-01T20:00:00.000Z")),
    ).toBe("Dec 31, 2026, 12:00 PM – Jan 1, 2027, 12:00 PM");
    expect(words(none)).toBe("");
  });

  it("places a timed event in the account's zone and on its clock", () => {
    // 02:00 UTC on New Year's Day is still New Year's Eve in Los Angeles.
    const party = times("2027-01-01T02:00:00.000Z");
    const words = wordedIn("en", en);
    setActiveTimePreferences({
      ...defaultTimePreferences,
      timeZone: "America/Los_Angeles",
    });
    expect(words(party)).toBe("Thu, Dec 31 · 6:00 PM");
    setActiveTimePreferences({
      timeZone: "Asia/Tokyo",
      hourCycle: "h23",
      weekStart: null,
    });
    expect(words(party)).toBe("Fri, Jan 1 · 11:00");
    // A calendar date names its own day in every zone.
    expect(words(dates("2027-01-01"))).toBe("Fri, Jan 1");
  });

  it("reads in Simplified and Traditional Chinese", () => {
    setActiveTimePreferences({
      timeZone: "Asia/Shanghai",
      hourCycle: "h23",
      weekStart: null,
    });
    const hans = wordedIn("zh-Hans", zhHans);
    expect(hans(dates("2027-03-21"))).toBe("3月21日周日");
    expect(hans(dates("2026-11-14", "2026-11-20"))).toBe("11月14日至20日");
    expect(hans(dates("2026-10-30", "2026-11-02"))).toBe("10月30日至11月2日");
    expect(hans(dates("2026-12-30", "2027-01-02"))).toBe(
      "2026年12月30日至2027年1月2日",
    );
    expect(hans(times("2026-10-10T02:00:00.000Z"))).toBe(
      "10月10日周六 · 10:00",
    );
    const hant = wordedIn("zh-Hant", zhHant);
    expect(hant(dates("2027-03-21"))).toBe("3月21日週日");
    expect(hant(dates("2026-11-14", "2026-11-20"))).toBe("11月14日至20日");
    expect(
      hant(times("2026-10-10T02:00:00.000Z", "2026-10-10T06:00:00.000Z")),
    ).toBe("10月10日週六 · 10:00至14:00");
  });
});
