// @vitest-environment jsdom

import { LivTalesApiClient } from "@livtales/api-client";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import {
  type EventFoldList,
  foldedByDefault,
  useEventFolds,
} from "../lib/event-folds";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let store: SandboxStore;
let client: LivTalesApiClient;

/** The folds of one list, rendered under a session of the sample account. */
function render(list: EventFoldList, query = "") {
  return renderHook(({ list, query }) => useEventFolds(list, "2026", query), {
    initialProps: { list, query },
    wrapper: Providers,
  });
}

/** The Events page's choices the sample account keeps. */
async function kept() {
  return (await client.getPageChoices("events")).choices;
}

describe("the Events list's folds", () => {
  beforeEach(() => {
    let saved: string | null = null;
    store = new SandboxStore({
      getItem: () => saved,
      setItem: (_key, value) => {
        saved = value;
      },
    });
    client = new LivTalesApiClient({
      getCredential: () => ({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
      fetch: (input, options) => store.fetch(input, options),
    });
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({
        accessToken: "sample",
        workspaceId: sandboxWorkspaceId,
      }),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>((input, options) =>
        store.fetch(input, options),
      ),
    );
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

  it("keeps each list's folds on the account", async () => {
    const past = render("past");
    expect(past.result.current.isFolded("2025")).toBe(true);
    // Two quick turns each start from the folds as they stand.
    act(() => past.result.current.toggle("2025"));
    act(() => past.result.current.toggle("2026-08"));
    await waitFor(() =>
      expect(past.result.current.isFolded("2026-08")).toBe(true),
    );
    expect(past.result.current.isFolded("2025")).toBe(false);
    await waitFor(async () =>
      expect(await kept()).toEqual({
        "folds.past": { "2025": false, "2026-08": true },
      }),
    );

    // Upcoming keeps its own folds.
    past.rerender({ list: "upcoming", query: "" });
    expect(past.result.current.isFolded("2026-08")).toBe(false);

    // Another session reads them back from the account.
    past.unmount();
    const reloaded = render("past");
    await waitFor(() =>
      expect(reloaded.result.current.isFolded("2026-08")).toBe(true),
    );
    expect(reloaded.result.current.isFolded("2025")).toBe(false);
  });

  it("keeps only what differs from the default", async () => {
    const past = render("past");
    act(() => past.result.current.toggle("2026-08"));
    await waitFor(async () =>
      expect(await kept()).toEqual({ "folds.past": { "2026-08": true } }),
    );
    act(() => past.result.current.toggle("2026-08"));
    await waitFor(async () => expect(await kept()).toEqual({}));
  });

  it("opens every heading while a name is typed and forgets those folds with the name", async () => {
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
    await waitFor(async () =>
      expect(await kept()).toEqual({ "folds.past": { "2026-08": true } }),
    );
  });
});
