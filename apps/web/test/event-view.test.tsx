// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { parseEventView } from "../lib/event-views";
import {
  landOnEventPlace,
  useEventAddress,
  useEventPage,
  useEventView,
} from "../lib/use-event-view";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/events");
});

describe("event view navigation", () => {
  it("restores bookmarked views and preserves unrelated URL state", () => {
    window.history.replaceState(
      null,
      "",
      "/events/plan?view=calendar&ref=collection",
    );
    const { result } = renderHook(useEventView);
    expect(result.current[0]).toBe("calendar");
    act(() => result.current[1]("todos"));
    expect(result.current[0]).toBe("todos");
    expect(window.location.search).toBe("?view=todos&ref=collection");
    // The Pages view without a page is named, so the address never reads
    // as an event just opened.
    act(() => result.current[1]("pages"));
    expect(window.location.search).toBe("?view=pages&ref=collection");
    act(() => {
      window.history.replaceState(null, "", "/events/plan?view=files");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current[0]).toBe("files");
  });
  it("opens event pages for an unselected or unknown view", () => {
    expect(parseEventView("__proto__")).toBe("pages");
    expect(parseEventView(null)).toBe("pages");
  });
  it("preserves the selected page across views and history changes", () => {
    window.history.replaceState(
      null,
      "",
      "/events/plan?page=preparation&ref=collection",
    );
    const { result } = renderHook(() => ({
      view: useEventView(),
      page: useEventPage(),
    }));
    expect(result.current.page[0]).toBe("preparation");
    act(() => result.current.view[1]("calendar"));
    expect(result.current.page[0]).toBe("preparation");
    act(() => result.current.page[1]("travel"));
    expect(result.current.view[0]).toBe("calendar");
    expect(new URLSearchParams(window.location.search).get("ref")).toBe(
      "collection",
    );
    act(() => result.current.view[1]("pages"));
    expect(window.location.search).toBe("?page=travel&ref=collection");
    act(() => {
      window.history.replaceState(null, "", "/events/plan?page=preparation");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current.page[0]).toBe("preparation");
  });
  it("ignores delayed selections after leaving an event", () => {
    window.history.replaceState(null, "", "/events/first");
    const { result } = renderHook(useEventPage);
    const select = result.current[1];
    window.history.replaceState(null, "", "/events/second");
    act(() => select("previous-event-page"));
    expect(window.location.pathname).toBe("/events/second");
    expect(window.location.search).toBe("");
  });
  it("does not add a history entry for an unchanged selection", () => {
    window.history.replaceState(null, "", "/events/plan?page=preparation");
    const { result } = renderHook(useEventPage);
    const length = window.history.length;
    act(() => result.current[1]("preparation"));
    expect(window.history.length).toBe(length);
  });
  it("reads an event's address as just opened, placed, or left", () => {
    window.history.replaceState(null, "", "/events/plan?ref=collection");
    const { result } = renderHook(() => useEventAddress("plan"));
    expect(result.current).toBe("bare");
    act(() => {
      window.history.replaceState(null, "", "/events/plan?view=calendar");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toBe("placed");
    act(() => {
      window.history.replaceState(null, "", "/events/plan?page=travel");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toBe("placed");
    // The Events list names neither, but it is not the event.
    act(() => {
      window.history.replaceState(null, "", "/events");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(result.current).toBe("away");
  });
  it("names a chosen page alone, without the Pages view beside it", () => {
    window.history.replaceState(null, "", "/events/plan?view=pages");
    const { result } = renderHook(useEventPage);
    act(() => result.current[1]("travel"));
    expect(window.location.search).toBe("?page=travel");
  });
  it("lands on a place in place of the bare address, without a history entry", () => {
    window.history.replaceState(null, "", "/events/plan?ref=collection");
    const length = window.history.length;
    act(() => landOnEventPlace({ view: "calendar" }));
    expect(window.location.search).toBe("?ref=collection&view=calendar");
    window.history.replaceState(null, "", "/events/plan");
    act(() =>
      landOnEventPlace({ page: "01a0b355-cad8-73d2-89f8-0a12abf66601" }),
    );
    expect(window.location.search).toBe(
      "?page=01a0b355-cad8-73d2-89f8-0a12abf66601",
    );
    expect(window.history.length).toBe(length);
  });
});
