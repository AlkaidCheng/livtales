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
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useErrorMessage } from "../components/feedback";
import { useNotices } from "../components/notices";
import { useApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { useChangeEventView, useEventViewState } from "./event-layout-queries";
import {
  type ChoiceValue,
  changedChoices,
  choicesChange,
  mergeChoices,
  sameChoice,
} from "./personal-views";

/** A view's kept choices as read: plain values by name. */
export type StoredChoices = Readonly<Record<string, unknown>>;

/** A view's choices: plain values by name, as the account keeps them. */
type Choices = Readonly<Record<string, ChoiceValue>>;

/** A set of choices of a known shape, each a value the account can keep. */
type ChoicesOf<T> = { readonly [Name in keyof T]?: ChoiceValue };

interface ChoicesScope {
  /** The kept choices; undefined for none. */
  readonly stored: ViewChoices | undefined;
  readonly change: (changes: Choices, defaults: Choices) => void;
}

const ChoicesContext = createContext<ChoicesScope | null>(null);

/**
 * Keeps the choices of the view inside on the account's own view of the
 * event, under `choicesKey`: a tab's view key, or a page component's id.
 * Only the choices that differ from the defaults are kept. While the
 * account's view cannot be read, the choices last as long as the view is
 * open.
 */
export function ViewChoicesScope({
  eventId,
  choicesKey,
  children,
}: {
  readonly eventId: string;
  readonly choicesKey: string;
  readonly children: ReactNode;
}) {
  const view = useEventViewState(eventId);
  const changeView = useChangeEventView(eventId);
  const stored = view?.choices[choicesKey];
  const scope = useMemo<ChoicesScope>(
    () => ({
      stored,
      change: (changes, defaults) =>
        changeView((current) => {
          const kept = current.choices[choicesKey] ?? {};
          const next = changedChoices(kept, changes, defaults);
          const names = new Set([...Object.keys(kept), ...Object.keys(next)]);
          if ([...names].every((name) => sameChoice(kept[name], next[name])))
            return null;
          return {
            choices: {
              [choicesKey]: Object.keys(next).length === 0 ? null : next,
            },
          };
        }),
    }),
    [changeView, choicesKey, stored],
  );
  return (
    <ChoicesContext.Provider value={view === undefined ? null : scope}>
      {children}
    </ChoicesContext.Provider>
  );
}

/**
 * A view's choices: those kept for it inside a `ViewChoicesScope`, else
 * held for as long as the view is open. `parse` turns what is kept into
 * choices, falling back to the defaults for anything it does not
 * recognize, and should be defined once outside the component; `change`
 * merges the given choices into the kept ones.
 */
export function useViewChoices<T extends ChoicesOf<T>>(
  defaults: T,
  parse: (stored: StoredChoices) => T,
): readonly [T, (changes: Partial<T>) => void] {
  const scope = useContext(ChoicesContext);
  const [local, setLocal] = useState<T>(defaults);
  const stored = scope?.stored;
  const choices = useMemo(
    () =>
      scope === null ? local : stored === undefined ? defaults : parse(stored),
    [defaults, local, parse, scope, stored],
  );
  const change = useCallback(
    (changes: Partial<T>) => {
      if (scope === null) setLocal((current) => ({ ...current, ...changes }));
      else scope.change(changes as Choices, defaults as Choices);
    },
    [defaults, scope],
  );
  return [choices, change] as const;
}

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
