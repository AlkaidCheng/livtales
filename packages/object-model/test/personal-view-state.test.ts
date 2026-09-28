import { createId } from "@livtales/db";
import type { EventPage } from "@livtales/schemas";
import { describe, expect, it } from "vitest";

import {
  eventViewDefaults,
  normalizeEventView,
  planEventViewSave,
  type StoredEventView,
  storedEventViewFrom,
} from "../src/personal-view-state.js";

const [a, b, c, d, e] = [
  createId(),
  createId(),
  createId(),
  createId(),
  createId(),
];
const [todos, notes, gone] = [createId(), createId(), createId()];

const page = (id: string, components: EventPage["components"] = []) => ({
  id,
  name: "Page",
  components,
});

const stored = (fields: Partial<StoredEventView> = {}): StoredEventView => ({
  place: null,
  tabs: {},
  pages: [],
  layouts: {},
  choices: {},
  ...fields,
});

describe("an account's view of an event", () => {
  it("orders pages the event gained after their nearest placed predecessor, else last", () => {
    const layout = [a, b, c, d, e].map((id) => page(id));
    const pages = (kept: string[]) =>
      normalizeEventView(layout, stored({ pages: kept })).pages;
    expect(pages([d, b])).toEqual([d, e, b, c, a]);
    expect(pages([e, a])).toEqual([e, a, b, c, d]);
    expect(pages([])).toEqual([a, b, c, d, e]);
    expect(pages([c, c, gone, a])).toEqual([c, d, e, a, b]);
    expect(normalizeEventView(layout, null).pages).toEqual([a, b, c, d, e]);
  });

  it("keeps view keys and leaves out pages and components the event lacks", () => {
    const layout = [
      page(a, [{ id: todos, kind: "todos", view: "board" }]),
      page(b, [{ id: notes, kind: "notes" }]),
    ];
    expect(
      normalizeEventView(
        layout,
        stored({
          place: { page: c },
          tabs: { order: ["later"], hidden: [c, a, "sharing"], removed: [c] },
          pages: [b, a],
          layouts: { [gone]: "list", [notes]: "list" },
          choices: {
            todos: { sort: "due" },
            unknown: { kept: true },
            [gone]: { show: "all" },
            [todos]: { show: "mine" },
          },
        }),
      ),
    ).toEqual({
      stored: true,
      place: null,
      tabs: { order: ["later"], hidden: [a, "sharing"], removed: [c] },
      pages: [b, a],
      layouts: { [todos]: "board", [notes]: "list" },
      choices: {
        todos: { sort: "due" },
        unknown: { kept: true },
        [todos]: { show: "mine" },
      },
    });
    expect(
      normalizeEventView(layout, stored({ place: { view: "calendar" } })).place,
    ).toEqual({ view: "calendar" });
    expect(eventViewDefaults(layout)).toEqual({
      pages: [a, b],
      layouts: { [todos]: "board", [notes]: null },
    });
  });

  it("plans a first save from the event's defaults with only what the change names", () => {
    const layout = [page(a, [{ id: todos, kind: "todos" }]), page(b)];
    expect(
      planEventViewSave(layout, null, {
        place: { page: gone },
        layouts: { [todos]: "list", [gone]: "week" },
        choices: { todos: null, [gone]: { sort: "due" }, notes: {} },
      }),
    ).toEqual({
      defaults: { pages: [a, b], layouts: { [todos]: null } },
      layouts: { add: { [todos]: null }, set: { [todos]: "list" }, drop: [] },
      choices: { todos: {}, notes: {} },
      components: [todos],
    });
  });

  it("brings a stored copy up to the layout only while it holds what was read", () => {
    const layout = [page(a, [{ id: todos, kind: "todos" }]), page(c), page(b)];
    const before = stored({
      tabs: { hidden: [gone, "files"] },
      pages: [b, a],
      layouts: { [gone]: "list" },
    });
    expect(
      planEventViewSave(layout, before, { place: { view: "notes" } }),
    ).toMatchObject({
      place: { view: "notes" },
      tabs: { value: { hidden: ["files"] }, ifUnchanged: before.tabs },
      pages: { value: [b, a, c], ifUnchanged: [b, a] },
      layouts: { add: { [todos]: null }, set: {}, drop: [gone] },
    });
    // A change that names the field replaces it outright.
    const named = planEventViewSave(layout, before, {
      tabs: { order: ["todos"] },
      pages: [c, gone],
    });
    expect(named.tabs).toEqual({ value: { order: ["todos"] } });
    expect(named.pages).toEqual({ value: [c, b, a] });
    // Nothing to bring up: the fields stay out of the write.
    const current = planEventViewSave(
      layout,
      stored({ tabs: { hidden: ["files"] }, pages: [a, c, b] }),
      {},
    );
    expect(current).not.toHaveProperty("tabs");
    expect(current).not.toHaveProperty("pages");
    expect(current).not.toHaveProperty("place");
  });

  it("reads a stored field that no longer fits as its default", () => {
    expect(
      storedEventViewFrom({
        place: { view: "todos", page: a },
        tabs: { order: "todos" },
        pages: [a, 7, b],
        layouts: { [todos]: "carousel", [notes]: "list", [gone]: null },
        choices: {
          todos: { sort: "due" },
          broken: { nested: { deeper: { value: 1 } } },
          ["x".repeat(41)]: { sort: "due" },
        },
      }),
    ).toEqual({
      place: null,
      tabs: {},
      pages: [a, b],
      layouts: { [todos]: null, [notes]: "list", [gone]: null },
      choices: { todos: { sort: "due" } },
    });
  });
});
