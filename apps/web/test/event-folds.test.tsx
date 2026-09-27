// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type EventFoldList,
  eventFoldStorageKey,
  foldedByDefault,
  useEventFolds,
} from "../lib/event-folds";

const session = vi.hoisted(() => ({
  account: "019d6e7d-0000-7000-8000-000000000001" as string | null,
}));

vi.mock("../lib/auth-session", () => ({
  useAuthSession: () => ({
    credential:
      session.account === null
        ? null
        : { homeWorkspaceId: session.account, workspaceId: session.account },
  }),
}));

const mei = "019d6e7d-0000-7000-8000-000000000001";
const kai = "019d6e7d-0000-7000-8000-000000000002";

function render(list: EventFoldList, query = "") {
  return renderHook(({ list, query }) => useEventFolds(list, "2026", query), {
    initialProps: { list, query },
  });
}

describe("the Events list's folds", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", window.sessionStorage);
    session.account = mei;
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("starts the years before this one folded in Past and All", () => {
    expect(foldedByDefault("past", "2025", "2026")).toBe(true);
    expect(foldedByDefault("all", "2025", "2026")).toBe(true);
    expect(foldedByDefault("past", "2026", "2026")).toBe(false);
    expect(foldedByDefault("all", "2027", "2026")).toBe(false);
    expect(foldedByDefault("past", "2025-12", "2026")).toBe(false);
    expect(foldedByDefault("all", "undated", "2026")).toBe(false);
    expect(foldedByDefault("upcoming", "2025", "2026")).toBe(false);
    expect(foldedByDefault("unscheduled", "2025", "2026")).toBe(false);
    expect(foldedByDefault("past", "2025", null)).toBe(false);
  });

  it("keeps each list's folds for the account in this browser", () => {
    const past = render("past");
    expect(past.result.current.isFolded("2025")).toBe(true);
    act(() => past.result.current.toggle("2025"));
    act(() => past.result.current.toggle("2026-08"));
    expect(past.result.current.isFolded("2025")).toBe(false);
    expect(past.result.current.isFolded("2026-08")).toBe(true);
    expect(eventFoldStorageKey(mei)).toBe(`livtales.event-folds.${mei}`);
    expect(
      JSON.parse(window.localStorage.getItem(eventFoldStorageKey(mei)) ?? ""),
    ).toEqual({ past: { "2025": false, "2026-08": true } });

    // Upcoming keeps its own folds.
    past.rerender({ list: "upcoming", query: "" });
    expect(past.result.current.isFolded("2026-08")).toBe(false);

    // A reload reads them back; another account starts from the defaults.
    past.unmount();
    const reloaded = render("past");
    expect(reloaded.result.current.isFolded("2025")).toBe(false);
    expect(reloaded.result.current.isFolded("2026-08")).toBe(true);
    reloaded.unmount();
    session.account = kai;
    const other = render("past");
    expect(other.result.current.isFolded("2025")).toBe(true);
    expect(other.result.current.isFolded("2026-08")).toBe(false);
  });

  it("stores only what differs from the default", () => {
    const past = render("past");
    act(() => past.result.current.toggle("2026-08"));
    act(() => past.result.current.toggle("2026-08"));
    expect(window.localStorage.getItem(eventFoldStorageKey(mei))).toBeNull();
  });

  it("opens every heading while a name is typed and forgets those folds with the name", () => {
    const past = render("past");
    act(() => past.result.current.toggle("2026-08"));
    past.rerender({ list: "past", query: "kyoto" });
    expect(past.result.current.isFolded("2025")).toBe(false);
    expect(past.result.current.isFolded("2026-08")).toBe(false);
    act(() => past.result.current.toggle("2024"));
    expect(past.result.current.isFolded("2024")).toBe(true);
    past.rerender({ list: "past", query: "kyo" });
    expect(past.result.current.isFolded("2024")).toBe(false);
    past.rerender({ list: "past", query: "" });
    expect(past.result.current.isFolded("2024")).toBe(true);
    expect(past.result.current.isFolded("2026-08")).toBe(true);
    expect(
      JSON.parse(window.localStorage.getItem(eventFoldStorageKey(mei)) ?? ""),
    ).toEqual({ past: { "2026-08": true } });
  });

  it("folds for the visit alone when browser storage is blocked or holds nonsense", () => {
    window.localStorage.setItem(eventFoldStorageKey(mei), "{not json");
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const garbled = render("past");
    expect(garbled.result.current.isFolded("2025")).toBe(true);
    garbled.unmount();
    vi.stubGlobal("localStorage", blocked);
    const past = render("past");
    act(() => past.result.current.toggle("2025"));
    expect(past.result.current.isFolded("2025")).toBe(false);
  });
});
