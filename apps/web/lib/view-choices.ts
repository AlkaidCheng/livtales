"use client";

import type {
  AccountPage,
  PageChoicesResponse,
  PageChoicesUpdate,
  ViewChoices,
} from "@livtales/schemas";
import {
  type QueryClient,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useErrorMessage } from "../components/feedback";
import { useNotices } from "../components/notices";
import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import {
  type ChoiceValue,
  choicesChange,
  mergeChoices,
  sameChoice,
} from "./personal-views";

/** One view's kept choices: plain values by name, as JSON stores them. */
export type StoredChoices = Readonly<Record<string, unknown>>;

/**
 * The choices each view was left with (its layout, what it shows, its sort
 * and filters), kept in this browser per account, per event, and per view,
 * so the view opens again as it was left. Only the most recent views are
 * kept. Storage that is blocked or full keeps nothing: the choices then
 * last while the page is open and the defaults return on the next visit.
 */
export const viewChoicesStorageKey = "chronelle.view-choices";
const kept = 200;

// The entries as last read, by the text they were read from, so a read
// that finds the same text returns the same objects.
let read: {
  readonly text: string | null;
  readonly entries: ReadonlyMap<string, StoredChoices>;
} = { text: null, entries: new Map() };
// Choices storage refused, held for the rest of the visit.
const unsaved = new Map<string, StoredChoices>();
const listeners = new Set<() => void>();

function isChoices(value: unknown): value is StoredChoices {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The kept entries in order, least recent first; anything unreadable is dropped. */
function storedEntries(): ReadonlyMap<string, StoredChoices> {
  let text: string | null = null;
  try {
    text = window.localStorage.getItem(viewChoicesStorageKey);
  } catch {
    text = null;
  }
  if (text === read.text) return read.entries;
  const entries = new Map<string, StoredChoices>();
  try {
    const parsed: unknown = JSON.parse(text ?? "[]");
    if (Array.isArray(parsed))
      for (const item of parsed)
        if (
          Array.isArray(item) &&
          typeof item[0] === "string" &&
          isChoices(item[1])
        )
          entries.set(item[0], item[1]);
  } catch {
    entries.clear();
  }
  read = { text, entries };
  return entries;
}

/** The key of one view's choices: the account, then where the view is (an event and its view, or a page). */
export function viewChoicesKey(
  accountId: string,
  ...place: readonly string[]
): string {
  return [accountId, ...place].join(":");
}

/** The choices kept under `key`, if any. */
export function keptViewChoices(key: string): StoredChoices | undefined {
  return unsaved.get(key) ?? storedEntries().get(key);
}

/** Merges `changes` into the choices kept under `key`, as its most recent entry. */
export function keepViewChoices(key: string, changes: StoredChoices): void {
  const next = { ...keptViewChoices(key), ...changes };
  const entries = [...storedEntries()].filter(([entry]) => entry !== key);
  entries.push([key, next]);
  try {
    window.localStorage.setItem(
      viewChoicesStorageKey,
      JSON.stringify(entries.slice(-kept)),
    );
    unsaved.delete(key);
  } catch {
    // Blocked or full storage keeps nothing; the choice lasts for this visit.
    unsaved.set(key, next);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * A view's choices, kept under `key` (see `viewChoicesKey`), or held for as
 * long as the view is open when there is no key. `parse` turns what
 * storage holds into choices, falling back to the defaults for anything it
 * does not recognize, and should be defined once outside the component;
 * `change` merges the given choices into the kept ones.
 */
export function useViewChoices<T extends StoredChoices>(
  key: string | null,
  defaults: T,
  parse: (stored: StoredChoices) => T,
): readonly [T, (changes: Partial<T>) => void] {
  const [local, setLocal] = useState<T>(defaults);
  const stored = useSyncExternalStore(
    subscribe,
    () => (key === null ? undefined : keptViewChoices(key)),
    () => undefined,
  );
  const choices = useMemo(
    () =>
      key === null ? local : stored === undefined ? defaults : parse(stored),
    [defaults, key, local, parse, stored],
  );
  const change = useCallback(
    (changes: Partial<T>) => {
      if (key === null) setLocal((current) => ({ ...current, ...changes }));
      else keepViewChoices(key, changes);
    },
    [key],
  );
  return [choices, change] as const;
}

/** A page's choices: plain values by name, as the account keeps them. */
type Choices = Readonly<Record<string, ChoiceValue>>;

/** A set of choices of a known shape, each a value the account can keep. */
type ChoicesOf<T> = { readonly [Name in keyof T]?: ChoiceValue };

const pageChoicesKey = (page: AccountPage) =>
  ["account", "pages", page] as const;
const pageChoicesUpdateKey = (page: AccountPage) =>
  ["page-choices-update", page] as const;

/** The page's choices as they show at this moment, changes still on their way included. */
function shownPageChoices(cache: QueryClient, page: AccountPage): ViewChoices {
  return cache
    .getMutationCache()
    .findAll({ mutationKey: pageChoicesUpdateKey(page), status: "pending" })
    .map((mutation) => (mutation.state.variables as PageChoicesUpdate).choices)
    .reduce(
      mergeChoices,
      cache.getQueryData<PageChoicesResponse>(pageChoicesKey(page))?.choices ??
        {},
    );
}

/**
 * A collection page's choices, kept on the account so the page opens as
 * it was left on every device. A change shows at once and is sent as it
 * is made, only the choices that differ from the defaults being kept; a
 * refusal takes it back and says so. `isPending` holds while the choices
 * load, so the page does not show the defaults first; a failed load
 * leaves the defaults. `change` takes the choices to change, or a way to
 * make them from the choices as they show at that moment. `parse` should
 * be defined once outside the component.
 */
export function usePageChoices<T extends ChoicesOf<T>>(
  page: AccountPage,
  defaults: T,
  parse: (stored: StoredChoices) => T,
): {
  readonly choices: T;
  readonly change: (changes: Partial<T> | ((current: T) => Partial<T>)) => void;
  readonly isPending: boolean;
} {
  const client = useApiClient();
  const cache = useQueryClient();
  const { credential } = useAuthSession();
  const { post } = useNotices();
  const describe = useErrorMessage();
  const query = useQuery({
    queryKey: pageChoicesKey(page),
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getPageChoices(page),
  });
  const pending = useMutationState({
    filters: { mutationKey: pageChoicesUpdateKey(page), status: "pending" },
    select: (mutation) =>
      (mutation.state.variables as PageChoicesUpdate).choices,
  });
  const kept = query.data?.choices;
  const choices = useMemo(
    () => parse(pending.reduce(mergeChoices, kept ?? {})),
    [kept, parse, pending],
  );
  const { mutate } = useMutation({
    mutationKey: pageChoicesUpdateKey(page),
    scope: { id: `page-choices:${page}` },
    mutationFn: (input: PageChoicesUpdate) =>
      client.updatePageChoices(page, input),
    onSuccess: (saved) => {
      const key = pageChoicesKey(page);
      const fetching = cache.getQueryState(key)?.fetchStatus === "fetching";
      cache.setQueryData(key, saved);
      if (fetching)
        void cache.invalidateQueries({ queryKey: key, exact: true });
    },
    onError: (error) => post({ message: describe(error), tone: "danger" }),
  });
  const change = useCallback(
    (changes: Partial<T> | ((current: T) => Partial<T>)) => {
      const shown = shownPageChoices(cache, page);
      const made =
        typeof changes === "function" ? changes(parse(shown)) : changes;
      const sent = Object.fromEntries(
        Object.entries(
          choicesChange(made as Choices, defaults as Choices),
        ).filter(
          ([name, value]) => !sameChoice(value ?? undefined, shown[name]),
        ),
      );
      if (Object.keys(sent).length > 0) mutate({ choices: sent });
    },
    [cache, defaults, mutate, page, parse],
  );
  return { choices, change, isPending: query.isPending };
}
