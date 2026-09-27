"use client";

import type { EventListQuery } from "@livtales/schemas";
import { useState } from "react";

import { useAuthSession } from "./auth-session";

/** The list a fold belongs to: the period the Events list shows. */
export type EventFoldList = EventListQuery["filter"];

/** Headings folded or opened by hand, by key: true folded, false open. */
type FoldChoices = Readonly<Record<string, boolean>>;

type StoredFolds = Readonly<Partial<Record<EventFoldList, FoldChoices>>>;

const foldLists = [
  "all",
  "upcoming",
  "unscheduled",
  "past",
] as const satisfies readonly EventFoldList[];

/** The browser storage of one account's folds, every list's under one key. */
export function eventFoldStorageKey(account: string): string {
  return `livtales.event-folds.${account}`;
}

/** The stored choices of each list, keeping only well-formed entries. */
function parseFolds(value: unknown): StoredFolds {
  if (typeof value !== "object" || value === null) return {};
  const folds: Partial<Record<EventFoldList, FoldChoices>> = {};
  for (const list of foldLists) {
    const choices: unknown = (value as Record<string, unknown>)[list];
    if (typeof choices !== "object" || choices === null) continue;
    folds[list] = Object.fromEntries(
      Object.entries(choices).filter(
        (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
      ),
    );
  }
  return folds;
}

function readFolds(account: string | null): StoredFolds {
  if (account === null) return {};
  try {
    const stored = window.localStorage.getItem(eventFoldStorageKey(account));
    return typeof stored === "string" ? parseFolds(JSON.parse(stored)) : {};
  } catch {
    return {};
  }
}

function writeFolds(account: string, folds: StoredFolds): void {
  try {
    const key = eventFoldStorageKey(account);
    if (
      Object.values(folds).every(
        (choices) => Object.keys(choices ?? {}).length === 0,
      )
    )
      window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(folds));
  } catch {
    // Folds last for this visit when browser storage is unavailable.
  }
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
 * The folded headings of one Events list, kept in this browser for the
 * account: the headings it folded or opened, else the default. While a
 * name is typed every heading starts open and a fold lasts for that name
 * alone, so no match is hidden. Only a choice that differs from the
 * default is stored.
 */
export function useEventFolds(
  list: EventFoldList,
  thisYear: string | null,
  query: string,
): EventFolds {
  const { credential } = useAuthSession();
  const account = credential?.homeWorkspaceId ?? null;
  const [stored, setStored] = useState(() => ({
    account,
    folds: readFolds(account),
  }));
  if (stored.account !== account)
    setStored({ account, folds: readFolds(account) });
  const [search, setSearch] = useState<{
    readonly query: string;
    readonly choices: FoldChoices;
  }>({ query: "", choices: {} });
  const searching = query !== "";
  const choices: FoldChoices = searching
    ? search.query === query
      ? search.choices
      : {}
    : (stored.folds[list] ?? {});
  const byDefault = (key: string) =>
    !searching && foldedByDefault(list, key, thisYear);
  const isFolded = (key: string) => choices[key] ?? byDefault(key);
  return {
    isFolded,
    toggle: (key) => {
      const folded = !isFolded(key);
      const next: Record<string, boolean> = { ...choices };
      if (folded === byDefault(key)) delete next[key];
      else next[key] = folded;
      if (searching) {
        setSearch({ query, choices: next });
        return;
      }
      const folds = { ...stored.folds, [list]: next };
      setStored({ account, folds });
      if (account !== null) writeFolds(account, folds);
    },
  };
}
