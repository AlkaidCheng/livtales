import type {
  EventPlanningResourceResponse,
  LiveChange,
  LiveView,
} from "@livtales/schemas";
import type { QueryClient, QueryKey } from "@tanstack/react-query";

import { pageChoicesKey } from "../view-choices";

type Resource = EventPlanningResourceResponse;

/** How deep a cached response is searched for copies of an object. */
const searchDepth = 5;

/** The views of an Event page whose responses hold its objects' states. */
const eventStates = new Set([
  "resource",
  "detail",
  "todos",
  "calendar",
  "itinerary",
  "expenses",
  "reminders",
  "people",
  "notes",
]);

/** The Event page views that list each type of object, which an object joining or leaving changes. */
const eventLists: Record<Resource["objectType"], readonly string[]> = {
  event: ["detail", "calendar", "itinerary", "timeline", "attachment-targets"],
  task: ["detail", "todos", "timeline", "attachment-targets"],
  expense: ["detail", "expenses", "timeline", "attachment-targets"],
  reminder: ["detail", "reminders", "timeline"],
  person: ["detail", "people"],
  note: ["detail", "notes"],
  document: ["detail"],
};

/** Queries whose responses hold current object states, which a change is written into. */
function holdsStates([family, , view]: QueryKey): boolean {
  if (family === "events" || family === "tasks" || family === "persons")
    return true;
  if (family === "event") return eventStates.has(String(view));
  return family === "object" && view === "resource";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isObjectState(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.objectType === "string" &&
    typeof value.version === "number"
  );
}

/**
 * The response with every older copy of the object replaced by its state,
 * keeping what a list adds to it; the same reference when nothing changed.
 */
export function withState(value: unknown, state: Resource, depth = 0): unknown {
  if (depth > searchDepth) return value;
  if (isObjectState(value) && value.id === state.id)
    return (value.version as number) >= state.version
      ? value
      : { ...value, ...state };
  return mapChildren(value, (child) => withState(child, state, depth + 1));
}

/** The response with the objects dropped from its lists; the same reference when none were there. */
export function withoutObjects(
  value: unknown,
  ids: ReadonlySet<string>,
  depth = 0,
): unknown {
  if (depth > searchDepth) return value;
  if (Array.isArray(value)) {
    const kept = value.filter(
      (item) => !(isObjectState(item) && ids.has(item.id as string)),
    );
    const next = mapChildren(kept, (child) =>
      withoutObjects(child, ids, depth + 1),
    );
    return kept.length === value.length && next === kept ? value : next;
  }
  return mapChildren(value, (child) => withoutObjects(child, ids, depth + 1));
}

function mapChildren(
  value: unknown,
  map: (child: unknown) => unknown,
): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const mapped = map(item);
      changed ||= mapped !== item;
      return mapped;
    });
    return changed ? next : value;
  }
  if (!isRecord(value)) return value;
  let changed = false;
  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const mapped = map(child);
    changed ||= mapped !== child;
    next[key] = mapped;
  }
  return changed ? next : value;
}

/** The first copy of an object the cache holds, as a list or read returned it. */
export function heldState(
  cache: QueryClient,
  id: string,
): Resource | undefined {
  let found: Resource | undefined;
  const search = (value: unknown, depth: number): void => {
    if (found !== undefined || depth > searchDepth) return;
    if (isObjectState(value) && value.id === id) {
      found = value as unknown as Resource;
      return;
    }
    if (Array.isArray(value)) for (const item of value) search(item, depth + 1);
    else if (isRecord(value))
      for (const child of Object.values(value)) search(child, depth + 1);
  };
  for (const query of cache
    .getQueryCache()
    .findAll({ predicate: (query) => holdsStates(query.queryKey) }))
    search(query.state.data, 0);
  return found;
}

/** The Event a change's page is, or null for a space page. */
function eventOf(change: { readonly page: string }): string | null {
  return change.page.startsWith("event:") ? change.page.slice(6) : null;
}

/**
 * Writes a confirmed change into the cache: each object's state replaces
 * older copies where they are held, trashed and removed objects leave the
 * lists, and only the lists an object may have joined or left, or that
 * are ordered or filtered on the API, are read again. A query still
 * loading is read again so it cannot land older than the change.
 */
export function applyLiveChange(cache: QueryClient, change: LiveChange): void {
  const eventId = eventOf(change);
  const onPage = (id: unknown) => eventId === null || id === eventId;
  switch (change.kind) {
    case "objects": {
      const gone = new Set(change.removed);
      for (const state of change.objects)
        if (state.deletedAt !== null) gone.add(state.id);
      const live = change.objects.filter((state) => state.deletedAt === null);
      // Only queries that held a copy are written, so the others keep
      // their age and are read again when they are next due.
      for (const query of cache
        .getQueryCache()
        .findAll({ predicate: (query) => holdsStates(query.queryKey) })) {
        const data = query.state.data;
        let next = data;
        for (const state of live) next = withState(next, state);
        if (gone.size > 0) next = withoutObjects(next, gone);
        if (next !== data) cache.setQueryData(query.queryKey, next);
      }
      const joined = ["created", "recovered", "restored", "included"].includes(
        change.cause,
      );
      const types = new Set(change.objects.map((state) => state.objectType));
      const changed = new Set(change.objects.map((state) => state.id));
      void cache.invalidateQueries({
        predicate: ({ queryKey: [family, id, view] }) => {
          switch (family) {
            case "search":
              return true;
            case "trash":
              return change.cause === "trashed" || change.cause === "recovered";
            case "tasks":
              return types.has("task") || types.has("event");
            case "events":
              return types.has("event");
            case "persons":
              return types.has("person");
            case "event":
              if (typeof id === "string" && gone.has(id)) return true;
              if (!onPage(id)) return false;
              if (view === "timeline") return true;
              return (
                (joined || gone.size > 0) &&
                [...types].some((type) =>
                  eventLists[type].includes(String(view)),
                )
              );
            case "object":
              return (
                typeof id === "string" &&
                (changed.has(id) || gone.has(id)) &&
                view !== "resource"
              );
            default:
              return false;
          }
        },
      });
      break;
    }
    case "sections":
      void cache.invalidateQueries({
        predicate: ({ queryKey: [family, id, view] }) =>
          family === "event" &&
          onPage(id) &&
          (view === "sections" || view === "todos" || view === "expenses"),
      });
      break;
    case "labels":
      void cache.invalidateQueries({ queryKey: ["labels"] });
      if (change.removed.length > 0)
        void cache.invalidateQueries({
          predicate: ({ queryKey: [family, , view] }) =>
            family === "tasks" ||
            family === "persons" ||
            (family === "event" && (view === "todos" || view === "people")),
        });
      break;
    case "layout":
      void cache.invalidateQueries({
        predicate: ({ queryKey: [family, id, view] }) =>
          family === "event" && onPage(id) && view === "layout",
      });
      break;
  }
  // A read in flight may have started before the change was saved.
  void cache.invalidateQueries({
    predicate: (query) =>
      query.state.fetchStatus === "fetching" &&
      holdsStates(query.queryKey) &&
      (query.queryKey[0] !== "event" || onPage(query.queryKey[1])),
  });
}

/** Reads a page again after the changes since its data could not be replayed. */
export function resetLivePage(cache: QueryClient, page: string): void {
  const eventId = eventOf({ page });
  void cache.invalidateQueries({
    predicate: ({ queryKey: [family, id] }) =>
      eventId === null
        ? family === "tasks" || family === "labels" || family === "persons"
        : (family === "event" && id === eventId) ||
          family === "tasks" ||
          family === "labels",
  });
}

/** Reads the account's own view again after another of its browsers changed it. */
export function applyLiveView(cache: QueryClient, view: LiveView): void {
  const target = view.target;
  if ("page" in target) {
    void cache.invalidateQueries({
      queryKey: pageChoicesKey(target.page),
      exact: true,
    });
    return;
  }
  void cache.invalidateQueries({
    predicate: ({ queryKey: [family, id, part] }) =>
      family === "event" && id === target.event && part === "layout",
  });
}
