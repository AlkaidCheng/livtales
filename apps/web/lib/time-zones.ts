import { countryLeadZones, zoneCountries } from "./time-zone-countries";
import { zoneOffsetLabel, zoneOffsetMinutes } from "./zone";

/**
 * Zones the browser's ICU data still lists under an older name, each with
 * the name the tz database now gives the same place. The tz database's
 * links are not used for this: several point at the zone whose rules a
 * place shares (Asmera at Nairobi), not at the place itself.
 */
const renamed: Readonly<Record<string, string>> = {
  "Africa/Asmera": "Africa/Asmara",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
  "America/Catamarca": "America/Argentina/Catamarca",
  "America/Coral_Harbour": "America/Atikokan",
  "America/Cordoba": "America/Argentina/Cordoba",
  "America/Godthab": "America/Nuuk",
  "America/Indianapolis": "America/Indiana/Indianapolis",
  "America/Jujuy": "America/Argentina/Jujuy",
  "America/Louisville": "America/Kentucky/Louisville",
  "America/Mendoza": "America/Argentina/Mendoza",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Atlantic/Faeroe": "Atlantic/Faroe",
  "Europe/Kiev": "Europe/Kyiv",
  "Pacific/Enderbury": "Pacific/Kanton",
  "Pacific/Ponape": "Pacific/Pohnpei",
  "Pacific/Truk": "Pacific/Chuuk",
};

/**
 * Major cities a zone serves without being named after them, in English
 * and Chinese, so a search for "Beijing" or "东京" finds the zone. Search
 * only; the list shows the zone's own city.
 */
const cityAliases: Readonly<Record<string, string>> = {
  "Asia/Shanghai":
    "Beijing Guangzhou Shenzhen 北京 上海 广州 深圳 重庆 成都 杭州 廣州 重慶",
  "Asia/Hong_Kong": "香港",
  "Asia/Macau": "澳门 澳門",
  "Asia/Taipei": "台北 臺北 台湾 臺灣",
  "Asia/Tokyo": "东京 東京",
  "Asia/Seoul": "首尔 首爾",
  "Asia/Singapore": "新加坡",
  "Asia/Bangkok": "曼谷",
  "Asia/Dubai": "迪拜 杜拜",
  "Asia/Kolkata": "New Delhi Delhi Mumbai Bangalore 新德里 孟买 孟買",
  "Europe/London": "伦敦 倫敦",
  "Europe/Paris": "巴黎",
  "Europe/Berlin": "柏林",
  "Europe/Moscow": "莫斯科",
  "America/New_York": "Washington Boston 纽约 紐約 华盛顿 華盛頓 波士顿 波士頓",
  "America/Chicago": "芝加哥",
  "America/Los_Angeles":
    "San Francisco Seattle 洛杉矶 洛杉磯 旧金山 舊金山 西雅图 西雅圖",
  "America/Toronto": "Montreal 多伦多 多倫多 蒙特利尔",
  "America/Vancouver": "温哥华 溫哥華",
  "Australia/Sydney": "Canberra 悉尼 雪梨 堪培拉",
  "Australia/Melbourne": "墨尔本 墨爾本",
  "Pacific/Auckland": "Wellington 奥克兰 奧克蘭 惠灵顿",
};

/** The areas the tz database names zones by, in the order the picker lists them. */
export const timeZoneRegions = [
  "Africa",
  "America",
  "Antarctica",
  "Arctic",
  "Asia",
  "Atlantic",
  "Australia",
  "Europe",
  "Indian",
  "Pacific",
  "Other",
] as const;
export type TimeZoneRegion = (typeof timeZoneRegions)[number];

/** One zone as the picker shows and searches it. */
export interface TimeZoneEntry {
  /** The zone as the browser names it, which is what is stored. */
  readonly id: string;
  readonly region: TimeZoneRegion;
  /** "Los Angeles", "Ho Chi Minh" (the current name of a renamed zone). */
  readonly city: string;
  /** The country the zone serves, in the reader's language. */
  readonly country: string | null;
  /** The zone's generic name in the reader's language: "Pacific Time". */
  readonly name: string;
  readonly offsetMinutes: number;
  /** "UTC+08:00". */
  readonly offset: string;
  /** The zone's time now, as the reader's clock writes it. */
  readonly time: string;
  readonly cityKey: string;
  /** The country's name in the reader's language, English, and Chinese, normalized. */
  readonly countryKeys: readonly string[];
  /** Whether the zone is its country's most populous one. */
  readonly lead: boolean;
  /** The zone's names ("pacific time", "pdt", ...), normalized, one per line. */
  readonly nameKeys: readonly string[];
  /** The city, its aliases, the country, and the zone's names, normalized. */
  readonly primary: string;
  /** The zone's identifiers and offset, normalized. */
  readonly secondary: string;
}

/** Lower case, without accents, with separators as spaces: "São_Paulo" -> "sao paulo". */
export function normalizeSearch(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[_/().,\-−]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function zoneName(
  locale: string,
  timeZone: string,
  style: "long" | "longGeneric" | "short" | "shortGeneric",
  instant: Date,
): string {
  try {
    return (
      new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: style })
        .formatToParts(instant)
        .find((part) => part.type === "timeZoneName")?.value ?? ""
    );
  } catch {
    return "";
  }
}

function regionNames(locale: string): Intl.DisplayNames | null {
  try {
    return new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    return null;
  }
}

/** The name the tz database now gives a zone the browser may list under an older one. */
export function currentTimeZone(zone: string): string {
  return renamed[zone] ?? zone;
}

/** The zone's city: the last part of its current name, with spaces. */
export function timeZoneCity(zone: string): string {
  const current = currentTimeZone(zone);
  return (current.split("/").at(-1) ?? current).replaceAll("_", " ");
}

/**
 * The zones as the picker lists them, each with its country and names in
 * the reader's language, its offset, and its time at `now`.
 */
export function timeZoneEntries(
  zones: readonly string[],
  options: {
    readonly locale: string;
    readonly now: Date;
    readonly hourCycle?: "h12" | "h23" | undefined;
  },
): readonly TimeZoneEntry[] {
  const { locale, now } = options;
  const local = regionNames(locale);
  const others = ["en", "zh-Hans", "zh-Hant"].map(regionNames);
  return zones.map((id) => {
    const current = currentTimeZone(id);
    const [area] = current.split("/");
    const region: TimeZoneRegion =
      current.includes("/") &&
      (timeZoneRegions as readonly string[]).includes(area ?? "")
        ? (area as TimeZoneRegion)
        : "Other";
    const city = timeZoneCity(id);
    const code = zoneCountries[current] ?? zoneCountries[id] ?? null;
    const country = code === null ? null : (local?.of(code) ?? null);
    const countries =
      code === null ? [] : others.map((names) => names?.of(code) ?? "");
    const name =
      zoneName(locale, id, "longGeneric", now) ||
      zoneName(locale, id, "long", now);
    let time = "";
    try {
      time = new Intl.DateTimeFormat(locale, {
        timeZone: id,
        hour: "numeric",
        minute: "2-digit",
        ...(options.hourCycle === undefined
          ? {}
          : { hourCycle: options.hourCycle }),
      }).format(now);
    } catch {
      time = "";
    }
    const offsetMinutes = zoneOffsetMinutes(id, now);
    const offset = zoneOffsetLabel(id, now);
    const nameKeys = [
      name,
      zoneName(locale, id, "long", now),
      zoneName("en", id, "longGeneric", now),
      zoneName("en", id, "long", now),
      zoneName("en", id, "short", now),
    ]
      .map(normalizeSearch)
      .filter((key) => key !== "");
    return {
      id,
      region,
      city,
      country,
      name,
      offsetMinutes,
      offset,
      time,
      cityKey: normalizeSearch(city),
      countryKeys: [country ?? "", ...countries]
        .map(normalizeSearch)
        .filter((key) => key !== ""),
      lead: countryLeadZones.has(current),
      nameKeys,
      primary: normalizeSearch(
        [
          city,
          cityAliases[current] ?? "",
          country ?? "",
          ...countries,
          code ?? "",
        ]
          .concat(nameKeys)
          .join(" | "),
      ),
      secondary: normalizeSearch([id, current, offset].join(" | ")),
    };
  });
}

/**
 * An offset the query names, in minutes: "+8", "UTC+8", "gmt-3:30",
 * "+0530". Null when the query is not an offset.
 */
export function parseOffsetQuery(query: string): number | null {
  const match = /^(?:utc|gmt)?\s*([+\-−])\s*(\d{1,2})(?::?(\d{2}))?$/i.exec(
    query.trim(),
  );
  if (match === null) return null;
  const hours = Number(match[2]);
  const minutes = Number(match[3] ?? 0);
  if (hours > 14 || minutes > 59) return null;
  const total = hours * 60 + minutes;
  return match[1] === "+" ? total : -total;
}

/**
 * The zones that match the query, best first: the city itself, a city that
 * starts with it, the country itself, a zone name that starts with it ("Pacific
 * Time", "PDT"), a country that starts with it, a word of the city, country,
 * or names that starts with it, then those names or the zone's identifier
 * holding every word. Within a rank, a zone whose own name starts with the
 * query comes first ("China Standard Time" before Urumqi), then a
 * country's most populous zone, then by offset.
 * An offset query ("+8", "UTC-7") keeps the zones at that offset.
 */
export function searchTimeZones(
  entries: readonly TimeZoneEntry[],
  query: string,
): readonly TimeZoneEntry[] {
  const needle = normalizeSearch(query);
  if (needle === "") return entries;
  const offset = parseOffsetQuery(query);
  const words = needle.split(" ");
  const wordStart = (text: string) => ` ${text}`.includes(` ${needle}`);
  const scored: { entry: TimeZoneEntry; score: number; named: boolean }[] = [];
  for (const entry of entries) {
    const named = entry.nameKeys.some((key) => key.startsWith(needle));
    let score: number | null = null;
    if (offset !== null) {
      if (entry.offsetMinutes === offset) score = 0;
    } else if (entry.cityKey === needle) score = 0;
    else if (entry.cityKey.startsWith(needle)) score = 1;
    else if (entry.countryKeys.includes(needle)) score = 2;
    else if (named) score = 3;
    else if (entry.countryKeys.some((key) => key.startsWith(needle))) score = 4;
    else if (wordStart(entry.primary)) score = 5;
    else if (words.every((word) => entry.primary.includes(word))) score = 6;
    else if (
      words.every(
        (word) =>
          entry.primary.includes(word) || entry.secondary.includes(word),
      )
    )
      score = 7;
    if (score !== null) scored.push({ entry, score, named });
  }
  return scored
    .sort(
      (a, b) =>
        a.score - b.score ||
        Number(b.named) - Number(a.named) ||
        Number(b.entry.lead) - Number(a.entry.lead) ||
        a.entry.offsetMinutes - b.entry.offsetMinutes ||
        a.entry.city.localeCompare(b.entry.city),
    )
    .map(({ entry }) => entry);
}
