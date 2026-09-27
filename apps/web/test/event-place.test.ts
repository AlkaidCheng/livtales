// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rememberEventPlace, rememberedEventPlace } from "../lib/event-place";

const ana = "01a0b355-cad8-73d2-89f8-0a12abf66a01";
const ben = "01a0b355-cad8-73d2-89f8-0a12abf66a02";
const kyoto = "01a0b355-cad8-73d2-89f8-0a12abf666a8";
const lisbon = "01a0b355-cad8-73d2-89f8-0a12abf666a9";
const page = "01a0b355-cad8-73d2-89f8-0a12abf66601";

// The test environment's local storage is the session storage it provides.
beforeEach(() => {
  vi.stubGlobal("localStorage", window.sessionStorage);
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("where an event was left", () => {
  it("keeps a view or a page per account and event", () => {
    expect(rememberedEventPlace(ana, kyoto)).toBeNull();
    rememberEventPlace(ana, kyoto, { view: "calendar" });
    rememberEventPlace(ana, lisbon, { page });
    rememberEventPlace(ben, kyoto, { view: "expenses" });
    expect(rememberedEventPlace(ana, kyoto)).toEqual({ view: "calendar" });
    expect(rememberedEventPlace(ana, lisbon)).toEqual({ page });
    expect(rememberedEventPlace(ben, kyoto)).toEqual({ view: "expenses" });
    rememberEventPlace(ana, kyoto, { page });
    expect(rememberedEventPlace(ana, kyoto)).toEqual({ page });
  });

  it("keeps the fifty most recent events", () => {
    const events = Array.from(
      { length: 51 },
      (_, index) =>
        `01a0b355-cad8-73d2-89f8-${index.toString(16).padStart(12, "0")}`,
    );
    for (const event of events)
      rememberEventPlace(ana, event, { view: "todos" });
    expect(rememberedEventPlace(ana, events[0] ?? "")).toBeNull();
    expect(rememberedEventPlace(ana, events[1] ?? "")).toEqual({
      view: "todos",
    });
    // Returning to an event makes it the most recent again.
    rememberEventPlace(ana, events[1] ?? "", { view: "notes" });
    rememberEventPlace(ana, kyoto, { view: "todos" });
    expect(rememberedEventPlace(ana, events[1] ?? "")).toEqual({
      view: "notes",
    });
    expect(rememberedEventPlace(ana, events[2] ?? "")).toBeNull();
  });

  it("drops what it cannot read", () => {
    window.localStorage.setItem(
      "chronelle.event-places",
      JSON.stringify([
        [`${ana}:${kyoto}`, { view: "pages" }],
        [`${ana}:${lisbon}`, { page: "not-a-page" }],
        [`${ben}:${kyoto}`, { view: "__proto__" }],
        [`${ben}:${lisbon}`, { view: "timeline" }],
        "stray",
      ]),
    );
    expect(rememberedEventPlace(ana, kyoto)).toBeNull();
    expect(rememberedEventPlace(ana, lisbon)).toBeNull();
    expect(rememberedEventPlace(ben, kyoto)).toBeNull();
    expect(rememberedEventPlace(ben, lisbon)).toEqual({ view: "timeline" });
    window.localStorage.setItem("chronelle.event-places", "{");
    expect(rememberedEventPlace(ben, lisbon)).toBeNull();
  });

  it("keeps nothing when storage is blocked", () => {
    const blocked = () => {
      throw new DOMException("blocked", "SecurityError");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked });
    expect(() =>
      rememberEventPlace(ana, kyoto, { view: "calendar" }),
    ).not.toThrow();
    expect(rememberedEventPlace(ana, kyoto)).toBeNull();
  });
});
