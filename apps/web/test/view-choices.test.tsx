// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  keepViewChoices,
  keptViewChoices,
  type StoredChoices,
  useViewChoices,
  viewChoicesKey,
  viewChoicesStorageKey,
} from "../lib/view-choices";

type Choices = { readonly sort: string; readonly overdue: boolean };
const defaults: Choices = { sort: "manual", overdue: false };
const read = (stored: StoredChoices): Choices => ({
  sort: typeof stored.sort === "string" ? stored.sort : defaults.sort,
  overdue: stored.overdue === true,
});

let stored: Record<string, string>;

beforeEach(() => {
  stored = {};
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored[key] ?? null,
    setItem: (key: string, value: string) => {
      stored[key] = value;
    },
    removeItem: (key: string) => {
      delete stored[key];
    },
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("view choices", () => {
  it("names a view's choices by the account, the event, and the view", () => {
    expect(viewChoicesKey("user-1", "event-2", "todos")).toBe(
      "user-1:event-2:todos",
    );
    expect(viewChoicesKey("user-1", "tasks")).toBe("user-1:tasks");
  });

  it("keeps each view's choices apart, merging changes, under the Chronelle key", () => {
    keepViewChoices("a:e:todos", { sort: "name" });
    keepViewChoices("a:e:calendar", { layout: "month" });
    keepViewChoices("a:e:todos", { overdue: true });
    expect(viewChoicesStorageKey).toBe("chronelle.view-choices");
    expect(keptViewChoices("a:e:todos")).toEqual({
      sort: "name",
      overdue: true,
    });
    expect(keptViewChoices("a:e:calendar")).toEqual({ layout: "month" });
    // The most recent view is kept last.
    expect(
      (JSON.parse(stored[viewChoicesStorageKey] ?? "[]") as [string][]).map(
        ([key]) => key,
      ),
    ).toEqual(["a:e:calendar", "a:e:todos"]);
  });

  it("keeps the most recent two hundred views and drops the oldest", () => {
    for (let index = 0; index < 205; index += 1)
      keepViewChoices(`a:event-${index}:todos`, { sort: "name" });
    const entries = JSON.parse(stored[viewChoicesStorageKey] ?? "[]") as [
      string,
    ][];
    expect(entries).toHaveLength(200);
    expect(entries[0]?.[0]).toBe("a:event-5:todos");
    expect(keptViewChoices("a:event-0:todos")).toBeUndefined();
  });

  it("reads nothing from storage it cannot parse", () => {
    stored[viewChoicesStorageKey] = "{not json";
    expect(keptViewChoices("a:e:todos")).toBeUndefined();
    stored[viewChoicesStorageKey] = JSON.stringify([
      ["a:e:todos", { sort: "due" }],
      ["broken"],
      [3, {}],
    ]);
    expect(keptViewChoices("a:e:todos")).toEqual({ sort: "due" });
  });

  it("applies a choice for the visit when storage refuses it", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    const { result } = renderHook(() =>
      useViewChoices("blocked:e:todos", defaults, read),
    );
    expect(result.current[0]).toBe(defaults);
    act(() => result.current[1]({ sort: "name" }));
    expect(result.current[0]).toEqual({ sort: "name", overdue: false });
  });

  it("reads the kept choices and follows a change, with defaults for the rest", () => {
    keepViewChoices("b:e:todos", { sort: "due", overdue: "yes" });
    const { result } = renderHook(() =>
      useViewChoices("b:e:todos", defaults, read),
    );
    expect(result.current[0]).toEqual({ sort: "due", overdue: false });
    act(() => result.current[1]({ overdue: true }));
    expect(result.current[0]).toEqual({ sort: "due", overdue: true });
    // A second reader of the same view hears the change.
    const other = renderHook(() => useViewChoices("b:e:todos", defaults, read));
    expect(other.result.current[0]).toEqual({ sort: "due", overdue: true });
  });

  it("holds the choices in the component alone without a key", () => {
    const { result, unmount } = renderHook(() =>
      useViewChoices(null, defaults, read),
    );
    act(() => result.current[1]({ sort: "name" }));
    expect(result.current[0]).toEqual({ sort: "name", overdue: false });
    expect(stored[viewChoicesStorageKey]).toBeUndefined();
    unmount();
    const again = renderHook(() => useViewChoices(null, defaults, read));
    expect(again.result.current[0]).toBe(defaults);
  });
});
