import type {
  EventLayoutResponse,
  EventViewState,
  EventViewStateUpdate,
  ViewChoices,
} from "@livtales/schemas";

/** One choice's value as the account keeps it. */
export type ChoiceValue = ViewChoices[string];

const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a key names a page or a component rather than a view. */
function isId(key: string): boolean {
  return idPattern.test(key);
}

type Layout = Pick<EventLayoutResponse, "pages">;

function componentsOf(layout: Layout) {
  return layout.pages.flatMap((page) => page.components);
}

/**
 * The account's view of an event it has not kept one of: the event's own
 * page order and each component's layout, opened on its Overview.
 */
export function defaultEventView(layout: Layout): EventViewState {
  return {
    stored: false,
    place: null,
    tabs: {},
    pages: layout.pages.map((page) => page.id),
    layouts: Object.fromEntries(
      componentsOf(layout).map((component) => [
        component.id,
        component.view ?? null,
      ]),
    ),
    choices: {},
  };
}

/**
 * The account's view as the event's layout now stands, from the view it
 * keeps (null before its first save). The kept page order keeps the pages
 * that remain; a page added since goes right after the nearest page before
 * it (in the event's order) that the order already holds, else at the end.
 * A page or component that is gone drops out of the hidden tabs, the
 * layouts, the choices, and the place; view keys stay as kept.
 */
export function resolveEventView(
  layout: Layout,
  kept: EventViewState | null,
): EventViewState {
  if (kept === null) return defaultEventView(layout);
  const eventPages = layout.pages.map((page) => page.id);
  const onEvent = new Set(eventPages);
  const pages = [...new Set(kept.pages)].filter((id) => onEvent.has(id));
  for (const [index, id] of eventPages.entries()) {
    if (pages.includes(id)) continue;
    const before = eventPages
      .slice(0, index)
      .findLast((earlier) => pages.includes(earlier));
    if (before === undefined) pages.push(id);
    else pages.splice(pages.indexOf(before) + 1, 0, id);
  }
  const components = componentsOf(layout);
  const componentIds = new Set(components.map((component) => component.id));
  const place =
    kept.place !== null && "page" in kept.place && !onEvent.has(kept.place.page)
      ? null
      : kept.place;
  return {
    stored: true,
    place,
    tabs:
      kept.tabs.hidden === undefined
        ? kept.tabs
        : {
            ...kept.tabs,
            hidden: kept.tabs.hidden.filter(
              (key) => !isId(key) || onEvent.has(key),
            ),
          },
    pages,
    layouts: Object.fromEntries(
      components.map((component) => [
        component.id,
        Object.hasOwn(kept.layouts, component.id)
          ? (kept.layouts[component.id] ?? null)
          : (component.view ?? null),
      ]),
    ),
    choices: Object.fromEntries(
      Object.entries(kept.choices).filter(
        ([key]) => !isId(key) || componentIds.has(key),
      ),
    ),
  };
}

/**
 * The view once a change is saved. The first save keeps a copy of the
 * event's defaults, which the change then applies to: the place, the
 * tabs, and the page order replace what is kept, the layouts are set per
 * component, and each entry of the choices replaces that component's,
 * null or an empty object returning it to its defaults. Ids that are not
 * on the event are ignored, a place on such a page included.
 */
export function applyEventViewUpdate(
  layout: Layout,
  view: EventViewState,
  update: EventViewStateUpdate,
): EventViewState {
  const base = resolveEventView(layout, view.stored ? view : null);
  const componentIds = new Set(
    componentsOf(layout).map((component) => component.id),
  );
  const layouts = { ...base.layouts };
  for (const [id, value] of Object.entries(update.layouts ?? {}))
    if (componentIds.has(id)) layouts[id] = value;
  const choices = { ...base.choices };
  for (const [key, value] of Object.entries(update.choices ?? {})) {
    if (isId(key) && !componentIds.has(key)) continue;
    if (value === null || Object.keys(value).length === 0) delete choices[key];
    else choices[key] = value;
  }
  const place = update.place;
  const known =
    place !== undefined &&
    ("view" in place || layout.pages.some((page) => page.id === place.page));
  return resolveEventView(layout, {
    stored: true,
    place: known ? place : base.place,
    tabs: update.tabs ?? base.tabs,
    pages: update.pages ?? base.pages,
    layouts,
    choices,
  });
}

/** Whether two choice values are the same, maps compared by their entries. */
export function sameChoice(
  a: ChoiceValue | undefined,
  b: ChoiceValue | undefined,
): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => item === b[index])
    );
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  );
}

/**
 * The choices once `changes` apply, holding only what differs from the
 * defaults: a choice set back to its default is dropped.
 */
export function changedChoices(
  current: ViewChoices,
  changes: Readonly<Record<string, ChoiceValue>>,
  defaults: Readonly<Record<string, ChoiceValue>>,
): ViewChoices {
  const next: Record<string, ChoiceValue> = { ...current };
  for (const [name, value] of Object.entries(changes)) {
    if (sameChoice(value, defaults[name])) delete next[name];
    else next[name] = value;
  }
  return next;
}

/**
 * A change to a page's choices, merged by name on the account: a choice
 * set back to its default is sent as null, which drops it.
 */
export function choicesChange(
  changes: Readonly<Record<string, ChoiceValue>>,
  defaults: Readonly<Record<string, ChoiceValue>>,
): Record<string, ChoiceValue | null> {
  return Object.fromEntries(
    Object.entries(changes).map(([name, value]) => [
      name,
      sameChoice(value, defaults[name]) ? null : value,
    ]),
  );
}

/** A page's choices once a change merges into them. */
export function mergeChoices(
  current: ViewChoices,
  change: Readonly<Record<string, ChoiceValue | null>>,
): ViewChoices {
  const next: Record<string, ChoiceValue> = { ...current };
  for (const [name, value] of Object.entries(change)) {
    if (value === null) delete next[name];
    else next[name] = value;
  }
  return next;
}
