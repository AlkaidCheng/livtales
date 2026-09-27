import type { EventLayoutResponse, EventViewState } from "@livtales/schemas";
import { describe, expect, it } from "vitest";

import {
  applyEventViewUpdate,
  changedChoices,
  choicesChange,
  defaultEventView,
  mergeChoices,
  resolveEventView,
  sameChoice,
} from "../lib/personal-views";

const id = (n: number) =>
  `019d6e7d-0000-7000-8000-${String(n).padStart(12, "0")}`;
const [a, b, c, d] = [id(1), id(2), id(3), id(4)];
const [todos, calendar, notes] = [id(11), id(12), id(13)];

function layout(
  pages: readonly (readonly [
    string,
    readonly EventLayoutResponse["pages"][number]["components"][number][],
  ])[],
): EventLayoutResponse {
  return {
    eventId: id(100),
    version: 1,
    updatedAt: null,
    pages: pages.map(([pageId, components]) => ({
      id: pageId,
      name: pageId.slice(-2),
      components: [...components],
    })),
  };
}

const event = layout([
  [a, [{ id: todos, kind: "todos", view: "board" }]],
  [b, [{ id: calendar, kind: "calendar" }]],
  [c, []],
]);

function kept(view: Partial<EventViewState>): EventViewState {
  return { ...defaultEventView(event), stored: true, ...view };
}

describe("the account's view of an event", () => {
  it("reads the event's own order and layouts until the account keeps a view", () => {
    expect(resolveEventView(event, null)).toEqual({
      stored: false,
      place: null,
      tabs: {},
      pages: [a, b, c],
      layouts: { [todos]: "board", [calendar]: null },
      choices: {},
    });
  });

  it("keeps the pages it holds and puts a new page after the nearest one before it, else at the end", () => {
    const grown = layout([
      [d, []],
      [a, []],
      [b, []],
      [c, []],
    ]);
    // D comes first on the event, with no page before it: it goes last.
    expect(resolveEventView(grown, kept({ pages: [c, a] })).pages).toEqual([
      c,
      a,
      b,
      d,
    ]);
    // B follows A, the nearest page before it that the order holds.
    expect(resolveEventView(event, kept({ pages: [c, a] })).pages).toEqual([
      c,
      a,
      b,
    ]);
    // A page gone drops out, and a repeat counts once.
    expect(
      resolveEventView(
        layout([
          [a, []],
          [b, []],
        ]),
        kept({ pages: [b, d, b, a] }),
      ).pages,
    ).toEqual([b, a]);
  });

  it("drops what is gone from the hidden tabs, the layouts, the choices, and the place", () => {
    const view = resolveEventView(
      layout([[a, [{ id: todos, kind: "todos", view: "board" }]]]),
      kept({
        place: { page: b },
        tabs: { order: ["todos", "later-view"], hidden: [b, "sharing", a] },
        layouts: { [todos]: "list", [calendar]: "month" },
        choices: {
          todos: { sort: "name" },
          [todos]: { show: "all" },
          [calendar]: { sort: "due" },
          "later-view": { layout: "list" },
        },
      }),
    );
    expect(view).toEqual({
      stored: true,
      place: null,
      tabs: { order: ["todos", "later-view"], hidden: ["sharing", a] },
      pages: [a],
      layouts: { [todos]: "list" },
      choices: {
        todos: { sort: "name" },
        [todos]: { show: "all" },
        "later-view": { layout: "list" },
      },
    });
    // A component added since starts with the event's layout for it.
    expect(
      resolveEventView(
        layout([
          [
            a,
            [
              { id: todos, kind: "todos" },
              { id: notes, kind: "notes", view: "list" },
            ],
          ],
        ]),
        kept({ layouts: { [todos]: "by-day" } }),
      ).layouts,
    ).toEqual({ [todos]: "by-day", [notes]: "list" });
  });

  it("keeps a copy of the event's defaults on the first save, which later changes of the event do not reach", () => {
    const first = applyEventViewUpdate(event, resolveEventView(event, null), {
      place: { view: "calendar" },
    });
    expect(first).toEqual({
      ...defaultEventView(event),
      stored: true,
      place: { view: "calendar" },
    });
    const rearranged = layout([
      [c, []],
      [b, [{ id: calendar, kind: "calendar", view: "month" }]],
      [a, [{ id: todos, kind: "todos", view: "list" }]],
    ]);
    expect(resolveEventView(rearranged, first)).toMatchObject({
      pages: [a, b, c],
      layouts: { [todos]: "board", [calendar]: null },
    });
  });

  it("replaces the place, tabs, and pages, sets layouts one by one, and replaces or clears each component's choices", () => {
    const view = kept({
      layouts: { [todos]: "board", [calendar]: "agenda" },
      choices: { todos: { sort: "name" }, [todos]: { show: "all" } },
    });
    const saved = applyEventViewUpdate(event, view, {
      tabs: { hidden: ["sharing"] },
      pages: [c, b],
      layouts: { [calendar]: "month", [notes]: "list" },
      choices: {
        todos: { overdue: true },
        [todos]: null,
        notes: {},
        [notes]: { noteSort: "title" },
        calendar: { layout: "month" },
      },
    });
    expect(saved).toEqual({
      stored: true,
      place: null,
      tabs: { hidden: ["sharing"] },
      pages: [c, b, a],
      layouts: { [todos]: "board", [calendar]: "month" },
      choices: { todos: { overdue: true }, calendar: { layout: "month" } },
    });
    // A place on a page the event does not have is not kept.
    expect(
      applyEventViewUpdate(
        event,
        { ...view, place: { view: "notes" } },
        { place: { page: d } },
      ).place,
    ).toEqual({ view: "notes" });
  });
});

describe("choices as the account keeps them", () => {
  it("compares words, lists, and maps", () => {
    expect(sameChoice("list", "list")).toBe(true);
    expect(sameChoice(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameChoice(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameChoice({ "2025": true }, { "2025": true })).toBe(true);
    expect(sameChoice({ "2025": true }, {})).toBe(false);
    expect(sameChoice({}, undefined)).toBe(false);
    expect(sameChoice(false, undefined)).toBe(false);
  });

  it("keeps only what differs from the defaults", () => {
    const defaults = { show: "open", sort: "manual", folds: {} };
    expect(
      changedChoices({ show: "all" }, { sort: "name", folds: {} }, defaults),
    ).toEqual({ show: "all", sort: "name" });
    expect(changedChoices({ show: "all" }, { show: "open" }, defaults)).toEqual(
      {},
    );
    expect(
      choicesChange({ show: "open", sort: "name", folds: {} }, defaults),
    ).toEqual({ show: null, sort: "name", folds: null });
    expect(
      mergeChoices(
        { show: "all", sort: "name" },
        { show: null, layout: "list" },
      ),
    ).toEqual({ sort: "name", layout: "list" });
  });
});
