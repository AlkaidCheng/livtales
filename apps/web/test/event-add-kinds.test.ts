import { describe, expect, it } from "vitest";

import { eventAddKinds, eventAddKindsFor } from "../lib/event-add-kinds";
import type { EventView } from "../lib/event-views";

describe("the add menu's kinds on an Event", () => {
  it.each<[EventView, string]>([
    ["todos", "task"],
    ["calendar", "schedule"],
    ["timeline", "schedule"],
    ["itinerary", "schedule"],
    ["expenses", "expense"],
    ["reminders", "reminder"],
    ["notes", "note"],
  ])("leads with the kind %s lists", (view, lead) => {
    const kinds = eventAddKindsFor(view);
    expect(kinds[0]).toBe(lead);
    expect([...kinds].sort()).toEqual([...eventAddKinds].sort());
    expect(kinds.filter((kind) => kind !== lead)).toEqual(
      eventAddKinds.filter((kind) => kind !== lead),
    );
  });

  it.each<EventView>(["overview", "pages", "files", "people", "sharing"])(
    "keeps the usual order on %s",
    (view) => {
      expect(eventAddKindsFor(view)).toEqual([
        "task",
        "schedule",
        "expense",
        "reminder",
        "note",
      ]);
    },
  );
});
