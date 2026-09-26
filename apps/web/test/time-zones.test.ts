import { describe, expect, it } from "vitest";

import {
  normalizeSearch,
  parseOffsetQuery,
  searchTimeZones,
  timeZoneCity,
  timeZoneEntries,
} from "../lib/time-zones";

/** Midsummer in the north, so Los Angeles keeps daylight time (PDT, UTC-7). */
const july = new Date("2026-07-01T12:00:00Z");
const zones = [...new Set([...Intl.supportedValuesOf("timeZone"), "UTC"])];
const english = timeZoneEntries(zones, { locale: "en", now: july });
const chinese = timeZoneEntries(zones, { locale: "zh-Hans", now: july });

const entry = (id: string, entries = english) => {
  const found = entries.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`${id} is not listed`);
  return found;
};
const ids = (query: string, entries = english) =>
  searchTimeZones(entries, query).map((found) => found.id);
/** The first match's city: the zone may be listed under an older name. */
const first = (query: string) => searchTimeZones(english, query)[0]?.city;

describe("time zone entries", () => {
  it("names a zone by its city, country, and generic name", () => {
    expect(entry("Asia/Shanghai")).toMatchObject({
      region: "Asia",
      city: "Shanghai",
      country: "China",
      name: "China Standard Time",
      offsetMinutes: 480,
      offset: "UTC+08:00",
      lead: true,
    });
    expect(entry("America/Los_Angeles")).toMatchObject({
      region: "America",
      country: "United States",
      name: "Pacific Time",
      offset: "UTC-07:00",
    });
    expect(entry("Asia/Shanghai", chinese)).toMatchObject({
      country: "中国",
      name: "中国标准时间",
    });
  });

  it("shows a renamed zone under its current city, and UTC with no country", () => {
    expect(timeZoneCity("Asia/Calcutta")).toBe("Kolkata");
    expect(timeZoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(timeZoneCity("Europe/Kiev")).toBe("Kyiv");
    const legacy = timeZoneEntries(["Asia/Calcutta", "Asia/Saigon"], {
      locale: "en",
      now: july,
    });
    expect(legacy.map(({ city, country }) => [city, country])).toEqual([
      ["Kolkata", "India"],
      ["Ho Chi Minh", "Vietnam"],
    ]);
    expect(entry("UTC")).toMatchObject({ region: "Other", country: null });
  });

  it("writes each zone's time now on the clock asked for", () => {
    const [tokyo] = timeZoneEntries(["Asia/Tokyo"], {
      locale: "en",
      now: july,
      hourCycle: "h23",
    });
    expect(tokyo?.time).toBe("21:00");
    const [twelve] = timeZoneEntries(["Asia/Tokyo"], {
      locale: "en",
      now: july,
      hourCycle: "h12",
    });
    expect(twelve?.time).toMatch(/^9:00\sPM$/);
  });
});

describe("searching time zones", () => {
  it("puts a country's own zone first", () => {
    expect(ids("china")[0]).toBe("Asia/Shanghai");
    expect(ids("japan")[0]).toBe("Asia/Tokyo");
    expect(ids("united states")[0]).toBe("America/New_York");
  });

  it("finds a zone by its country or a city it serves, in Chinese", () => {
    expect(ids("中国", chinese)[0]).toBe("Asia/Shanghai");
    expect(ids("北京", chinese)[0]).toBe("Asia/Shanghai");
    expect(ids("日本", chinese)[0]).toBe("Asia/Tokyo");
    // An English reader can search in Chinese, and a Chinese reader in English.
    expect(ids("新西兰")[0]).toBe("Pacific/Auckland");
    expect(ids("germany", chinese)[0]).toBe("Europe/Berlin");
  });

  it("finds a zone by its name or abbreviation", () => {
    expect(ids("pacific")[0]).toBe("America/Los_Angeles");
    expect(ids("pdt")[0]).toBe("America/Los_Angeles");
    expect(ids("central european")).toContain("Europe/Paris");
  });

  it("matches a city however it is typed", () => {
    expect(ids("new york")[0]).toBe("America/New_York");
    expect(ids("new_york")[0]).toBe("America/New_York");
    expect(ids("sao paulo")[0]).toBe("America/Sao_Paulo");
    expect(first("calcutta")).toBe("Kolkata");
    expect(first("kolkata")).toBe("Kolkata");
    expect(first("ho chi minh")).toBe("Ho Chi Minh");
    expect(ids("Beijing")[0]).toBe("Asia/Shanghai");
  });

  it("keeps the zones at an offset the query names", () => {
    const plusEight = searchTimeZones(english, "+8");
    expect(plusEight.length).toBeGreaterThan(5);
    expect(plusEight.every((found) => found.offsetMinutes === 480)).toBe(true);
    expect(plusEight.map((found) => found.id)).toEqual(
      expect.arrayContaining(["Asia/Shanghai", "Asia/Singapore"]),
    );
    expect(ids("UTC-7")).toContain("America/Los_Angeles");
    expect(
      searchTimeZones(english, "gmt+5:30").map((found) => found.city),
    ).toContain("Kolkata");
  });

  it("lists nothing for a query no zone holds, and everything for none", () => {
    expect(ids("xyzzy")).toEqual([]);
    expect(searchTimeZones(english, "  ")).toHaveLength(english.length);
  });
});

describe("search text", () => {
  it("folds case, accents, and separators", () => {
    expect(normalizeSearch("  São_Paulo ")).toBe("sao paulo");
    expect(normalizeSearch("America/Port-au-Prince")).toBe(
      "america port au prince",
    );
  });

  it("reads an offset with or without its UTC and minutes", () => {
    expect(parseOffsetQuery("+8")).toBe(480);
    expect(parseOffsetQuery("UTC+5:30")).toBe(330);
    expect(parseOffsetQuery("gmt-3")).toBe(-180);
    expect(parseOffsetQuery("+0545")).toBe(345);
    expect(parseOffsetQuery("−10")).toBe(-600);
    expect(parseOffsetQuery("8")).toBeNull();
    expect(parseOffsetQuery("+15")).toBeNull();
    expect(parseOffsetQuery("utc")).toBeNull();
  });
});
