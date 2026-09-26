"use client";

import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { deviceTimeZone } from "../i18n/active-preferences";
import {
  type TimeZoneEntry,
  type TimeZoneRegion,
  currentTimeZone,
  searchTimeZones,
  timeZoneCity,
  timeZoneEntries,
  timeZoneRegions,
} from "../lib/time-zones";
import { useDisplayPreferences } from "../lib/use-display-preferences";
import { openPickerPanel, revealRow } from "../lib/picker-panel";
import { isKnownTimeZone, zoneOffsetLabel } from "../lib/zone";
import { CheckIcon, ChevronDownIcon, SearchIcon } from "./icons";

/** A row of the list: the device's zone (`null`) or one zone. */
interface Choice {
  readonly key: string;
  readonly value: string | null;
  readonly entry: TimeZoneEntry;
}

/** A run of rows under one label: Suggested, a region, or a search's matches. */
interface Section {
  readonly key: string;
  /** The region the label names; null for Suggested and for matches. */
  readonly region: TimeZoneRegion | null;
  readonly choices: readonly Choice[];
}

/**
 * The zones the browser knows, always with the device's zone and UTC: some
 * engines leave UTC out of their list, and an older one lists nothing. A
 * chosen zone the list lacks is added unless the list has it under its
 * other name (Asia/Calcutta for Asia/Kolkata).
 */
function knownTimeZones(chosen: string | null): readonly string[] {
  let listed: readonly string[] = [];
  try {
    listed = Intl.supportedValuesOf("timeZone");
  } catch {
    listed = [];
  }
  const zones = new Set([...listed, deviceTimeZone(), "UTC"]);
  if (
    chosen !== null &&
    isKnownTimeZone(chosen) &&
    ![...zones].some(
      (zone) => currentTimeZone(zone) === currentTimeZone(chosen),
    )
  )
    zones.add(chosen);
  return [...zones];
}

/** How far a page of the list moves with Page Up and Page Down. */
const page = 8;

/**
 * A time zone field: a button naming the chosen zone (or the device's) that
 * opens a searchable list. The search finds a zone by its city, by its
 * country in the reader's language, English, or Chinese, by its name or
 * abbreviation, or by offset ("+8"); with no search the list suggests the
 * device's zone and shows every zone by region. Each row shows the zone's
 * country and name, its time now, and its offset. Arrow keys move through
 * the list, Enter chooses, Escape closes; on a phone the list opens as a
 * sheet.
 *
 * `value` is the chosen zone, or null for the device's.
 */
export function TimeZonePicker({
  value,
  onChange,
  id,
  className,
  variant = "field",
  align = variant === "compact" ? "end" : "start",
  hourCycle,
  ...described
}: {
  readonly value: string | null;
  readonly onChange: (timeZone: string | null) => void;
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  /** The look of a form's full-width field, or of a Settings row's menu. */
  readonly variant?: "field" | "compact";
  /** Which edge of the button the list lines up with. */
  readonly align?: "start" | "end";
  /** The clock the rows' times use; the account's when not given. */
  readonly hourCycle?: "h12" | "h23" | null | undefined;
  readonly "aria-describedby"?: string | undefined;
  readonly "aria-labelledby"?: string | undefined;
}) {
  const t = useTranslations("preferences");
  const picker = useTranslations("preferences.zonePicker");
  const preferences = useDisplayPreferences();
  const { locale } = preferences;
  const clock = hourCycle === undefined ? preferences.hourCycle : hourCycle;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The row the arrow keys are on; null for the chosen zone while
  // browsing, or the best match of a search.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const dialogId = `${baseId}-dialog`;
  const listId = `${baseId}-list`;
  const optionId = (key: string) => `${baseId}-option-${key}`;
  const device = deviceTimeZone();

  // The list is built when it opens: every zone's names and time now.
  const entries = useMemo(
    () =>
      open
        ? timeZoneEntries(knownTimeZones(value), {
            locale,
            now: new Date(),
            hourCycle: clock ?? undefined,
          })
        : [],
    [open, locale, clock, value],
  );
  const results = useMemo(
    () => (query.trim() === "" ? [] : searchTimeZones(entries, query)),
    [entries, query],
  );
  const browsing = query.trim() === "";
  // Browsing lists the device's zone first, then every zone by region; a
  // search lists its matches best first.
  const sections: readonly Section[] = useMemo(() => {
    const choice = (entry: TimeZoneEntry): Choice => ({
      key: entry.id,
      value: entry.id,
      entry,
    });
    if (!browsing)
      return [{ key: "results", region: null, choices: results.map(choice) }];
    const deviceEntry = entries.find((entry) => entry.id === device);
    const suggested: Section[] =
      deviceEntry === undefined
        ? []
        : [
            {
              key: "suggested",
              region: null,
              choices: [{ key: "device", value: null, entry: deviceEntry }],
            },
          ];
    return suggested.concat(
      timeZoneRegions
        .map((region) => ({
          key: region,
          region,
          choices: entries
            .filter((entry) => entry.region === region)
            .sort((a, b) => a.city.localeCompare(b.city))
            .map(choice),
        }))
        .filter((section) => section.choices.length > 0),
    );
  }, [browsing, results, entries, device]);
  const choices = useMemo(
    () => sections.flatMap((section) => section.choices),
    [sections],
  );
  // The chosen zone's row, which may list it under its other name.
  const selectedKey =
    value === null
      ? "device"
      : (choices.find(
          (choice) =>
            choice.value !== null &&
            currentTimeZone(choice.value) === currentTimeZone(value),
        )?.key ?? value);
  const keyed = choices.findIndex(
    (choice) => choice.key === (activeKey ?? (browsing ? selectedKey : "")),
  );
  const active = keyed < 0 ? 0 : keyed;
  const activeChoice = choices[active];

  function show() {
    setQuery("");
    setActiveKey(null);
    setOpen(true);
  }

  function search(next: string) {
    setQuery(next);
    setActiveKey(null);
    if (list.current !== null) list.current.scrollTop = 0;
  }

  /** Moves the arrow keys' row to `index` and scrolls it into the list's view. */
  function move(index: number) {
    const choice = choices[index];
    if (choice === undefined) return;
    setActiveKey(choice.key);
    revealRow(list.current, document.getElementById(optionId(choice.key)), {
      top: 32,
    });
  }

  function close() {
    setOpen(false);
    dialog.current?.close();
    button.current?.focus();
  }

  function choose(choice: Choice) {
    onChange(choice.value);
    close();
  }

  // Opening shows the list next to the button and starts on the chosen zone.
  useLayoutEffect(() => {
    const panel = dialog.current;
    const anchor = button.current;
    if (!open || panel === null || anchor === null) return;
    openPickerPanel(panel, anchor, { align, minWidth: 400, maxHeight: 440 });
    field.current?.focus();
  }, [open, align]);

  // The list opens, and returns from a search, on the chosen zone.
  useLayoutEffect(() => {
    if (!open || !browsing) return;
    revealRow(
      list.current,
      list.current?.querySelector('[aria-selected="true"]') ?? null,
      { center: true },
    );
  }, [open, browsing]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // A key that finishes an IME composition belongs to the composition.
    if (event.nativeEvent.isComposing) return;
    const last = choices.length - 1;
    const moves: Record<string, number> = {
      ArrowDown: Math.min(active + 1, last),
      ArrowUp: Math.max(active - 1, 0),
      PageDown: Math.min(active + page, last),
      PageUp: Math.max(active - page, 0),
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      move(next);
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeChoice !== undefined) choose(activeChoice);
    }
  }

  const chosenCity = timeZoneCity(value ?? device);
  const chosenOffset = zoneOffsetLabel(value ?? device);

  const label = (section: Section) =>
    section.region === null
      ? picker("suggested")
      : picker(`regions.${section.region}`);

  let index = -1;
  const row = (choice: Choice) => {
    index += 1;
    const at = index;
    const isDevice = choice.value === null;
    const { entry } = choice;
    const detail = (
      isDevice ? [entry.city, entry.name] : [entry.country, entry.name]
    )
      .filter(Boolean)
      .join(" · ");
    const classes = [
      "time-zone-option",
      at === active && "is-active",
      choice.key === selectedKey && "is-chosen",
    ];
    return (
      <button
        aria-selected={at === active}
        className={classes.filter(Boolean).join(" ")}
        id={optionId(choice.key)}
        key={choice.key}
        onClick={() => choose(choice)}
        // The search keeps focus through the press.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => {
          if (at !== active) setActiveKey(choice.key);
        }}
        role="option"
        tabIndex={-1}
        type="button"
      >
        <span className="time-zone-option-text">
          <span className="time-zone-option-city">
            {isDevice ? picker("device") : entry.city}
          </span>
          {detail === "" ? null : (
            <span className="time-zone-option-detail">{detail}</span>
          )}
        </span>
        <span className="time-zone-option-meta">
          <span className="time-zone-option-time">{entry.time}</span>
          <span className="time-zone-option-offset">{entry.offset}</span>
        </span>
        <CheckIcon className="time-zone-option-check" />
      </button>
    );
  };

  return (
    <>
      <button
        {...described}
        aria-controls={open ? dialogId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={[
          "picker-trigger",
          variant === "compact" && "is-compact",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        id={id}
        onClick={show}
        ref={button}
        role="combobox"
        type="button"
      >
        <span className="picker-trigger-value">
          {value === null
            ? picker("deviceChoice", { city: chosenCity })
            : chosenCity}
        </span>
        <span className="time-zone-trigger-offset">{chosenOffset}</span>
        <ChevronDownIcon className="picker-trigger-chevron" />
      </button>
      {/* The panel lives at the document's end, clear of the styles of the
          form or row that holds the button. */}
      {open
        ? createPortal(
            <dialog
              aria-label={t("timeZone")}
              className="picker-panel time-zone-panel"
              id={dialogId}
              // The list closes alone: a dialog or sheet holding the field
              // hears neither the Escape nor the cancel.
              onCancel={(event) => {
                event.preventDefault();
                event.stopPropagation();
                close();
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (event.target === event.currentTarget) close();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                event.stopPropagation();
                close();
              }}
              ref={dialog}
            >
              <div className="time-zone-search">
                <SearchIcon className="time-zone-search-icon" />
                <input
                  aria-activedescendant={
                    activeChoice === undefined
                      ? undefined
                      : optionId(activeChoice.key)
                  }
                  aria-autocomplete="list"
                  aria-controls={listId}
                  aria-expanded="true"
                  aria-label={t("searchZones")}
                  autoComplete="off"
                  className="time-zone-search-input"
                  enterKeyHint="done"
                  onChange={(event) => search(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder={picker("searchPlaceholder")}
                  ref={field}
                  role="combobox"
                  spellCheck={false}
                  type="text"
                  value={query}
                />
                <button
                  className="time-zone-close"
                  onClick={() => close()}
                  type="button"
                >
                  {picker("close")}
                </button>
              </div>
              <p aria-live="polite" className="visually-hidden">
                {browsing ? "" : picker("results", { count: choices.length })}
              </p>
              {choices.length === 0 ? (
                <p className="time-zone-empty">
                  {picker("none", { query: query.trim() })}
                </p>
              ) : null}
              <div
                aria-label={t("timeZone")}
                className="time-zone-list"
                hidden={choices.length === 0}
                id={listId}
                ref={list}
                role="listbox"
              >
                {sections.map((section) =>
                  browsing ? (
                    // biome-ignore lint/a11y/useSemanticElements: These are listbox option groups, not form fieldsets.
                    <div
                      aria-label={label(section)}
                      key={section.key}
                      role="group"
                    >
                      <p aria-hidden="true" className="time-zone-group-label">
                        {label(section)}
                      </p>
                      {section.choices.map(row)}
                    </div>
                  ) : (
                    section.choices.map(row)
                  ),
                )}
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
