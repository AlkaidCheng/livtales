import { ApiClientError, type LivTalesApiClient } from "@livtales/api-client";
import {
  type AccountPage,
  type EventLayoutWithViewResponse,
  type EventViewState,
  type EventViewStateUpdate,
  eventComponentViewSchema,
  type PageChoicesResponse,
  type ViewChoices,
  viewChoicesSchema,
} from "@livtales/schemas";
import { viewsOf } from "./event-components";
import { type EventPlace, placeOf } from "./event-place";
import { isTemporaryReadError } from "./query-errors";
import {
  defaultEventTaskChoices,
  defaultTaskPageChoices,
} from "./task-choices";

/**
 * The browser stores that may still hold views kept on this browser. Each
 * is read once for the signed-in account, saved to the account, and
 * removed; nothing writes them. The places and the view choices hold every
 * account's entries under the account's id; the folds are kept per account
 * under its home workspace; the three layouts belong to the browser.
 */
export const keptViewStores = {
  places: "chronelle.event-places",
  choices: "chronelle.view-choices",
  eventLayout: "chronelle.event-layout",
  peopleLayout: "chronelle.people-layout",
  taskView: "chronelle.task-view",
  folds: (account: string) => `livtales.event-folds.${account}`,
} as const;

/** The accounts a move reads for: the account, and the home workspace the folds were kept under. */
export interface KeptViewsOwner {
  readonly accountId: string;
  readonly foldAccount: string;
}

type Entry = readonly [key: string, value: unknown];

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage that refuses keeps what it held; nothing reads it but a move.
  }
}

function parse(text: string | null): unknown {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

function readEntries(key: string): Entry[] {
  const parsed = parse(read(key));
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): Entry[] =>
    Array.isArray(item) && typeof item[0] === "string"
      ? [[item[0], item[1]]]
      : [],
  );
}

function writeEntries(key: string, entries: readonly Entry[]): void {
  write(key, entries.length === 0 ? null : JSON.stringify(entries));
}

/** Takes the entries `claimed` names out of a store, returning them. */
function claimEntries(
  key: string,
  claimed: (entry: string) => boolean,
): Entry[] {
  const entries = readEntries(key);
  const taken = entries.filter(([entry]) => claimed(entry));
  if (taken.length > 0)
    writeEntries(
      key,
      entries.filter(([entry]) => !claimed(entry)),
    );
  return taken;
}

function putBack(key: string, entries: readonly Entry[]): void {
  if (entries.length > 0) writeEntries(key, [...readEntries(key), ...entries]);
}

/**
 * Kept choices as the account keeps them: an object whose values the
 * account takes, without the choices that are their defaults. Null when
 * nothing is left or the choices do not fit.
 */
function keptChoices(
  value: unknown,
  defaults: Readonly<Record<string, unknown>>,
): ViewChoices | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  const choices = Object.fromEntries(
    Object.entries(value).filter(
      ([name, choice]) =>
        choice !== null && choice !== undefined && choice !== defaults[name],
    ),
  );
  const parsed = viewChoicesSchema.safeParse(choices);
  return parsed.success && Object.keys(parsed.data).length > 0
    ? parsed.data
    : null;
}

/** The defaults of an event tab's choices: its layout and Notes order, and its tasks' choices. */
const tabChoiceDefaults: Readonly<Record<string, unknown>> = {
  ...defaultEventTaskChoices,
  noteSort: "edited",
};

function isFinal(error: unknown): boolean {
  return error instanceof ApiClientError && !isTemporaryReadError(error);
}

/** What this browser kept for one of the account's events. */
interface KeptEventView {
  readonly place: EventPlace | null;
  /** Each tab's choices, by view key. */
  readonly choices: Readonly<Record<string, ViewChoices>>;
}

/**
 * The change that moves what the browser kept into the account's view:
 * the place when the view has none, and each tab's choices the view does
 * not hold yet. A page that is no longer on the event is not a place.
 */
function eventViewMoveOf(
  kept: KeptEventView,
  layout: EventLayoutWithViewResponse,
): EventViewStateUpdate | null {
  const keptPlace = kept.place;
  const place =
    layout.yours.place === null &&
    keptPlace !== null &&
    ("view" in keptPlace ||
      layout.pages.some((page) => page.id === keptPlace.page))
      ? keptPlace
      : undefined;
  const choices = Object.fromEntries(
    Object.entries(kept.choices).filter(
      ([view]) => !Object.hasOwn(layout.yours.choices, view),
    ),
  );
  const hasChoices = Object.keys(choices).length > 0;
  if (place === undefined && !hasChoices) return null;
  return {
    ...(place === undefined ? {} : { place }),
    ...(hasChoices ? { choices } : {}),
  };
}

/**
 * Moves what this browser kept for the event into the account's view,
 * once: the browser forgets the event, and what the view does not have
 * yet is saved. A save that fails for a while puts the entries back for a
 * later read. Returns the view as it then stands.
 */
export async function moveKeptEventView(
  client: LivTalesApiClient,
  accountId: string,
  layout: EventLayoutWithViewResponse,
): Promise<EventViewState> {
  const prefix = `${accountId}:${layout.eventId}`;
  const places = claimEntries(keptViewStores.places, (key) => key === prefix);
  const choices = claimEntries(keptViewStores.choices, (key) =>
    key.startsWith(`${prefix}:`),
  );
  if (places.length === 0 && choices.length === 0) return layout.yours;
  const move = eventViewMoveOf(
    {
      place: placeOf(places[0]?.[1]),
      choices: Object.fromEntries(
        choices.flatMap(([key, value]) => {
          const kept = keptChoices(value, tabChoiceDefaults);
          return kept === null ? [] : [[key.slice(prefix.length + 1), kept]];
        }),
      ),
    },
    layout,
  );
  if (move === null) return layout.yours;
  try {
    return await client.updateEventView(layout.eventId, move);
  } catch (error) {
    if (!isFinal(error)) {
      putBack(keptViewStores.places, places);
      putBack(keptViewStores.choices, choices);
    }
    return layout.yours;
  }
}

/** Takes a store holding one value out of the browser, returning its text. */
function claimValue(key: string): string | null {
  const text = read(key);
  if (text !== null) write(key, null);
  return text;
}

const foldLists = ["all", "upcoming", "unscheduled", "past"] as const;

/**
 * Takes what this browser kept for one of the collection pages out of its
 * stores: the choices, and a way to put the stores back.
 */
function claimKeptPage(
  page: AccountPage,
  owner: KeptViewsOwner,
): { readonly choices: ViewChoices; readonly putBack: () => void } | null {
  const choices: Record<string, ViewChoices[string]> = {};
  let putBackAll: () => void;
  if (page === "events") {
    const foldKey = keptViewStores.folds(owner.foldAccount);
    const layout = claimValue(keptViewStores.eventLayout);
    const folds = claimValue(foldKey);
    if (layout === null && folds === null) return null;
    if (layout === "list") choices.layout = "list";
    const lists = parse(folds);
    if (typeof lists === "object" && lists !== null)
      for (const list of foldLists) {
        const kept: unknown = Reflect.get(lists, list);
        if (typeof kept !== "object" || kept === null) continue;
        const map = Object.fromEntries(
          Object.entries(kept).filter(
            (entry): entry is [string, boolean] =>
              typeof entry[1] === "boolean",
          ),
        );
        if (Object.keys(map).length > 0) choices[`folds.${list}`] = map;
      }
    putBackAll = () => {
      if (layout !== null) write(keptViewStores.eventLayout, layout);
      if (folds !== null) write(foldKey, folds);
    };
  } else if (page === "tasks") {
    const entries = claimEntries(
      keptViewStores.choices,
      (key) => key === `${owner.accountId}:tasks`,
    );
    const view = claimValue(keptViewStores.taskView);
    if (entries.length === 0 && view === null) return null;
    Object.assign(
      choices,
      keptChoices(entries[0]?.[1], defaultTaskPageChoices) ?? {},
    );
    const layout = eventComponentViewSchema.safeParse(view);
    if (
      layout.success &&
      layout.data !== "list" &&
      viewsOf("todos").includes(layout.data)
    )
      choices.layout = layout.data;
    putBackAll = () => {
      putBack(keptViewStores.choices, entries);
      if (view !== null) write(keptViewStores.taskView, view);
    };
  } else {
    const layout = claimValue(keptViewStores.peopleLayout);
    if (layout === null) return null;
    if (layout === "cards") choices.layout = "cards";
    putBackAll = () => write(keptViewStores.peopleLayout, layout);
  }
  const parsed = viewChoicesSchema.safeParse(choices);
  return {
    choices: parsed.success ? parsed.data : {},
    putBack: putBackAll,
  };
}

/**
 * Whether this browser may still keep views to move, before the account
 * is known: whether any of the stores is there at all.
 */
export function mayHoldKeptViews(foldAccount?: string): boolean {
  return [
    keptViewStores.places,
    keptViewStores.choices,
    keptViewStores.eventLayout,
    keptViewStores.peopleLayout,
    keptViewStores.taskView,
    ...(foldAccount === undefined ? [] : [keptViewStores.folds(foldAccount)]),
  ].some((key) => read(key) !== null);
}

/**
 * Moves what this browser kept for a collection page into the account's
 * choices, once: the browser forgets it, and when the account keeps no
 * choices for the page yet they are saved. A save that fails for a while
 * puts the stores back for a later read.
 */
export async function moveKeptPageChoices(
  client: LivTalesApiClient,
  owner: KeptViewsOwner,
  kept: PageChoicesResponse,
): Promise<PageChoicesResponse> {
  const claimed = claimKeptPage(kept.page, owner);
  if (
    claimed === null ||
    Object.keys(kept.choices).length > 0 ||
    Object.keys(claimed.choices).length === 0
  )
    return kept;
  try {
    return await client.updatePageChoices(kept.page, {
      choices: claimed.choices,
    });
  } catch (error) {
    if (!isFinal(error)) claimed.putBack();
    return kept;
  }
}
