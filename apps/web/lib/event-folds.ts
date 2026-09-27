"use client";

import type { EventListQuery } from "@livtales/schemas";
import { useState } from "react";

import { type StoredChoices, usePageChoices } from "./view-choices";

/** The list a fold belongs to: the period the Events list shows. */
export type EventFoldList = EventListQuery["filter"];

/** Headings folded or opened by hand, by key: true folded, false open. */
type FoldChoices = Readonly<Record<string, boolean>>;

/** Each list's folds, kept among the Events page's choices as "folds.<list>". */
type StoredFolds = Readonly<Record<`folds.${EventFoldList}`, FoldChoices>>;

const noFolds: StoredFolds = {
  "folds.all": {},
  "folds.upcoming": {},
  "folds.unscheduled": {},
  "folds.past": {},
};

/** The kept folds of each list, keeping only well-formed entries. */
function readFolds(stored: StoredChoices): StoredFolds {
  return Object.fromEntries(
    Object.keys(noFolds).map((name) => {
      const choices = stored[name];
      return [
        name,
        typeof choices === "object" &&
        choices !== null &&
        !Array.isArray(choices)
          ? Object.fromEntries(
              Object.entries(choices).filter(
                (entry): entry is [string, boolean] =>
                  typeof entry[1] === "boolean",
              ),
            )
          : {},
      ];
    }),
  ) as StoredFolds;
}

/**
 * Whether a heading starts folded before any choice: in Past and in All
 * (whose Mine and Shared share its folds), the years before this one, so
 * either list opens near the present.
 */
export function foldedByDefault(
  list: EventFoldList,
  key: string,
  thisYear: string | null,
): boolean {
  return (
    (list === "past" || list === "all") &&
    thisYear !== null &&
    /^\d{4}$/.test(key) &&
    key < thisYear
  );
}

export interface EventFolds {
  readonly isFolded: (key: string) => boolean;
  readonly toggle: (key: string) => void;
}

/**
 * The folded headings of one Events list, kept on the account among the
 * Events page's choices: the headings it folded or opened, else the
 * default. While a name is typed every heading starts open and a fold
 * lasts for that name alone, so no match is hidden. Only a choice that
 * differs from the default is kept.
 */
export function useEventFolds(
  list: EventFoldList,
  thisYear: string | null,
  query: string,
): EventFolds {
  const kept = usePageChoices("events", noFolds, readFolds);
  const [search, setSearch] = useState<{
    readonly query: string;
    readonly choices: FoldChoices;
  }>({ query: "", choices: {} });
  const searching = query !== "";
  const choices: FoldChoices = searching
    ? search.query === query
      ? search.choices
      : {}
    : kept.choices[`folds.${list}`];
  const byDefault = (key: string) =>
    !searching && foldedByDefault(list, key, thisYear);
  /** The folds with `key` turned over, keeping only what differs from the default. */
  const turned = (folds: FoldChoices, key: string): FoldChoices => {
    const folded = !(folds[key] ?? byDefault(key));
    const next: Record<string, boolean> = { ...folds };
    if (folded === byDefault(key)) delete next[key];
    else next[key] = folded;
    return next;
  };
  return {
    isFolded: (key) => choices[key] ?? byDefault(key),
    toggle: (key) => {
      if (searching)
        setSearch((current) => ({
          query,
          choices: turned(current.query === query ? current.choices : {}, key),
        }));
      else
        kept.change((current) => ({
          [`folds.${list}`]: turned(current[`folds.${list}`], key),
        }));
    },
  };
}
