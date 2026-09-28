import {
  type EventComponentView,
  type EventPage,
  type EventPlace,
  type EventTabsPreference,
  type EventViewState,
  type EventViewStateUpdate,
  type ViewChoices,
  eventComponentViewSchema,
  eventPlaceSchema,
  eventTabsPreferenceSchema,
  viewChoicesSchema,
} from "@livtales/schemas";

// An account's own view of an Event resolves as: the account's own choice,
// else its copy of the event's defaults taken at its first save, else the
// app's defaults (which are never stored). Both database paths store the
// rows; everything here is shared so they read and save alike.

/** How many events keep a view on one account; the least recently opened go first. */
export const eventViewLimit = 200;

/** How many component choices one account keeps; the least recently changed go first. */
export const componentChoicesLimit = 1000;

export type ComponentLayouts = Readonly<
  Record<string, EventComponentView | null>
>;

/** The account's view of one Event as stored, from its first save on. */
export interface StoredEventView {
  readonly place: EventPlace | null;
  readonly tabs: EventTabsPreference;
  readonly pages: readonly string[];
  readonly layouts: ComponentLayouts;
  /** Each tab's (by view key) and page component's (by id) choices. */
  readonly choices: Readonly<Record<string, ViewChoices>>;
}

/** A field a save writes; with `ifUnchanged`, only while the field still holds that value. */
export interface ViewFieldWrite<Value> {
  readonly value: Value;
  readonly ifUnchanged?: Value;
}

/**
 * One save, field by field, so two saves that race each keep what they
 * changed. The fields the change names replace what is stored; a field the
 * save only brings up to the event's current layout is written while it
 * still holds what was read.
 */
export interface EventViewWrite {
  /** The page order and component layouts a first save stores. */
  readonly defaults: {
    readonly pages: readonly string[];
    readonly layouts: ComponentLayouts;
  };
  /** Replaces the place and marks the event opened now. */
  readonly place?: EventPlace;
  readonly tabs?: ViewFieldWrite<EventTabsPreference>;
  readonly pages?: ViewFieldWrite<readonly string[]>;
  /** `add` fills components the stored view lacks, `set` replaces, `drop` removes. */
  readonly layouts: {
    readonly add: ComponentLayouts;
    readonly set: ComponentLayouts;
    readonly drop: readonly string[];
  };
  /** Each component's choices; an empty object returns it to its defaults. */
  readonly choices: Readonly<Record<string, ViewChoices>>;
  /** The event's component ids; the choices of any other component id go. */
  readonly components: readonly string[];
}

const idShape =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Page and component keys are ids; a tab's view key never is. */
function isId(key: string): boolean {
  return idShape.test(key);
}

interface EventOutline {
  readonly pages: readonly string[];
  /** Each component's layout on the event, in page order. */
  readonly components: ReadonlyMap<string, EventComponentView | null>;
}

function outline(layout: readonly EventPage[]): EventOutline {
  return {
    pages: layout.map((page) => page.id),
    components: new Map(
      layout.flatMap((page) =>
        page.components.map(
          (component) => [component.id, component.view ?? null] as const,
        ),
      ),
    ),
  };
}

/**
 * The account's pages restricted to the event's, with each page of the
 * event it lacks placed right after the nearest page that precedes it on
 * the event and is already placed, or last when none is.
 */
function orderPages(
  pages: readonly string[],
  eventPages: readonly string[],
): string[] {
  const known = new Set(eventPages);
  const ordered = [...new Set(pages)].filter((id) => known.has(id));
  eventPages.forEach((id, index) => {
    if (ordered.includes(id)) return;
    let position = ordered.length;
    for (let before = index - 1; before >= 0; before -= 1) {
      const placed = ordered.indexOf(eventPages[before] ?? "");
      if (placed !== -1) {
        position = placed + 1;
        break;
      }
    }
    ordered.splice(position, 0, id);
  });
  return ordered;
}

/** The tabs with hidden pages the event no longer has left out; view keys stay as given. */
function keepTabs(
  tabs: EventTabsPreference,
  eventPages: ReadonlySet<string>,
): EventTabsPreference {
  if (tabs.hidden === undefined) return tabs;
  return {
    ...tabs,
    hidden: tabs.hidden.filter((key) => !isId(key) || eventPages.has(key)),
  };
}

/** Each component of the event with the account's layout, else the event's. */
function keepLayouts(
  layouts: ComponentLayouts,
  event: EventOutline,
): Record<string, EventComponentView | null> {
  return Object.fromEntries(
    [...event.components].map(([id, view]) => [
      id,
      Object.hasOwn(layouts, id) ? (layouts[id] ?? null) : view,
    ]),
  );
}

/** Tab choices stay; a component's go with it. */
function keepChoices(
  choices: Readonly<Record<string, ViewChoices>>,
  event: EventOutline,
): Record<string, ViewChoices> {
  return Object.fromEntries(
    Object.entries(choices).filter(
      ([key]) => !isId(key) || event.components.has(key),
    ),
  );
}

function sameList(
  first: readonly string[] | undefined,
  second: readonly string[] | undefined,
): boolean {
  return (
    first?.length === second?.length &&
    (first ?? []).every((item, index) => item === second?.[index])
  );
}

/** The event's page order and component layouts, as a first save copies them. */
export function eventViewDefaults(layout: readonly EventPage[]): {
  readonly pages: readonly string[];
  readonly layouts: ComponentLayouts;
} {
  const event = outline(layout);
  return { pages: event.pages, layouts: Object.fromEntries(event.components) };
}

/**
 * The account's view of an Event with the event's current layout: pages
 * and components the event no longer has are left out, those it gained
 * join in place, and a place on a page that is gone reads as none. Before
 * the first save it is the view that save would keep.
 */
export function normalizeEventView(
  layout: readonly EventPage[],
  stored: StoredEventView | null,
): EventViewState {
  const event = outline(layout);
  const pageIds = new Set(event.pages);
  const left = stored?.place ?? null;
  const place =
    left !== null && ("view" in left || pageIds.has(left.page)) ? left : null;
  return {
    stored: stored !== null,
    place,
    tabs: keepTabs(stored?.tabs ?? {}, pageIds),
    pages: orderPages(stored?.pages ?? event.pages, event.pages),
    layouts: keepLayouts(stored?.layouts ?? {}, event),
    choices: keepChoices(stored?.choices ?? {}, event),
  };
}

/**
 * The write a change makes to the stored view, planned against the
 * event's current layout. Ids the event does not have are ignored. A
 * first save stores the event's defaults before the change; any save
 * brings the stored copy up to the layout, so pages and components added
 * since are kept where they are now.
 */
export function planEventViewSave(
  layout: readonly EventPage[],
  stored: StoredEventView | null,
  change: EventViewStateUpdate,
): EventViewWrite {
  const event = outline(layout);
  const pageIds = new Set(event.pages);
  const place =
    change.place !== undefined &&
    ("view" in change.place || pageIds.has(change.place.page))
      ? change.place
      : undefined;

  let tabs: ViewFieldWrite<EventTabsPreference> | undefined;
  if (change.tabs !== undefined)
    tabs = { value: keepTabs(change.tabs, pageIds) };
  else if (stored !== null) {
    const kept = keepTabs(stored.tabs, pageIds);
    if (!sameList(kept.hidden, stored.tabs.hidden))
      tabs = { value: kept, ifUnchanged: stored.tabs };
  }

  let pages: ViewFieldWrite<readonly string[]> | undefined;
  if (change.pages !== undefined)
    pages = { value: orderPages(change.pages, event.pages) };
  else if (stored !== null) {
    const ordered = orderPages(stored.pages, event.pages);
    if (!sameList(ordered, stored.pages))
      pages = { value: ordered, ifUnchanged: stored.pages };
  }

  const storedLayouts = stored?.layouts ?? {};
  const choices = Object.fromEntries(
    Object.entries(change.choices ?? {})
      .filter(([key]) => !isId(key) || event.components.has(key))
      .map(([key, value]) => [key, value ?? {}]),
  );
  return {
    defaults: eventViewDefaults(layout),
    ...(place !== undefined && { place }),
    ...(tabs !== undefined && { tabs }),
    ...(pages !== undefined && { pages }),
    layouts: {
      add: Object.fromEntries(
        [...event.components].filter(
          ([id]) => !Object.hasOwn(storedLayouts, id),
        ),
      ),
      set: Object.fromEntries(
        Object.entries(change.layouts ?? {}).filter(([id]) =>
          event.components.has(id),
        ),
      ),
      drop: Object.keys(storedLayouts).filter(
        (id) => !event.components.has(id),
      ),
    },
    choices,
    components: [...event.components.keys()],
  };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A stored view as either path reads it. A field that no longer fits the
 * contract reads as its default rather than failing the read: a layout
 * that is not a known view is the kind's default, and choices that do not
 * fit are left out.
 */
export function storedEventViewFrom(row: {
  readonly place: unknown;
  readonly tabs: unknown;
  readonly pages: unknown;
  readonly layouts: unknown;
  readonly choices: unknown;
}): StoredEventView {
  return {
    place: eventPlaceSchema.safeParse(row.place).data ?? null,
    tabs: eventTabsPreferenceSchema.safeParse(row.tabs).data ?? {},
    pages: Array.isArray(row.pages)
      ? row.pages.filter((id): id is string => typeof id === "string")
      : [],
    layouts: Object.fromEntries(
      Object.entries(record(row.layouts)).map(([id, view]) => [
        id,
        eventComponentViewSchema.safeParse(view).data ?? null,
      ]),
    ),
    choices: Object.fromEntries(
      Object.entries(record(row.choices)).flatMap(([key, value]) => {
        const choices = viewChoicesSchema.safeParse(value).data;
        return choices === undefined || key.length > 40
          ? []
          : [[key, choices] as const];
      }),
    ),
  };
}

/** A collection page's stored choices; any that no longer fit read as none. */
export function pageChoicesFrom(value: unknown): ViewChoices {
  return viewChoicesSchema.safeParse(value ?? {}).data ?? {};
}
