import type { EventView } from "./event-views";

/** What the phone's add button offers to add to an Event, in its usual order. */
export const eventAddKinds = [
  "task",
  "schedule",
  "expense",
  "reminder",
  "note",
] as const;

export type EventAddKind = (typeof eventAddKinds)[number];

/** The kind of record each view lists; the other views list none of their own. */
const viewKinds: Partial<Record<EventView, EventAddKind>> = {
  todos: "task",
  calendar: "schedule",
  timeline: "schedule",
  itinerary: "schedule",
  expenses: "expense",
  reminders: "reminder",
  notes: "note",
};

/**
 * The add menu's kinds on a view: the kind the view lists first, nearest
 * the button, then the rest in their usual order.
 */
export function eventAddKindsFor(view: EventView): readonly EventAddKind[] {
  const lead = viewKinds[view];
  return lead === undefined
    ? eventAddKinds
    : [lead, ...eventAddKinds.filter((kind) => kind !== lead)];
}
