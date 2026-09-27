// @vitest-environment jsdom

import { LivTalesApiClient } from "@livtales/api-client";
import {
  act,
  cleanup,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { Providers } from "../app/providers";
import {
  type StoredChoices,
  usePageChoices,
  useViewChoices,
  ViewChoicesScope,
} from "../lib/view-choices";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

type Choices = { readonly sort: string; readonly overdue: boolean };
const defaults: Choices = { sort: "manual", overdue: false };
const read = (stored: StoredChoices): Choices => ({
  sort: typeof stored.sort === "string" ? stored.sort : defaults.sort,
  overdue: stored.overdue === true,
});

let store: SandboxStore;
let client: LivTalesApiClient;
let eventId: string;
/** A status every write is answered with, instead of the sample store. */
let refuse: number | null;

beforeEach(async () => {
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
  const event = (await client.listEvents({})).items[0];
  assert(event);
  eventId = event.id;
  refuse = null;
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async (input, options) =>
      refuse !== null && options?.method === "PATCH"
        ? Response.json(
            { error: { code: "unavailable", message: "Choices unavailable" } },
            { status: refuse },
          )
        : store.fetch(input, options),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

/** The Tasks tab of the sample event, as the event page scopes it. */
function inTasksTab({ children }: { readonly children: ReactNode }) {
  return (
    <Providers>
      <ViewChoicesScope eventId={eventId} choicesKey="todos">
        {children}
      </ViewChoicesScope>
    </Providers>
  );
}

async function keptForTasks() {
  return (await client.getEventLayoutWithView(eventId)).yours.choices.todos;
}

describe("a view's choices", () => {
  it("keeps a tab's choices in the account's view of the event, only what differs from the defaults", async () => {
    await client.updateEventView(eventId, {
      choices: { todos: { sort: "due", overdue: "yes" } },
    });
    const { result } = renderHook(() => useViewChoices(defaults, read), {
      wrapper: inTasksTab,
    });
    await waitFor(() =>
      expect(result.current[0]).toEqual({ sort: "due", overdue: false }),
    );
    act(() => result.current[1]({ overdue: true }));
    await waitFor(() =>
      expect(result.current[0]).toEqual({ sort: "due", overdue: true }),
    );
    await waitFor(async () =>
      expect(await keptForTasks()).toEqual({
        sort: "due",
        overdue: true,
      }),
    );
    // Back to the defaults, the tab keeps nothing.
    act(() => result.current[1]({ sort: "manual", overdue: false }));
    await waitFor(async () => expect(await keptForTasks()).toBeUndefined());
    expect(result.current[0]).toEqual(defaults);
  });

  it("takes a refused change back and says so", async () => {
    await client.updateEventView(eventId, {
      choices: { todos: { overdue: true } },
    });
    const { result } = renderHook(() => useViewChoices(defaults, read), {
      wrapper: inTasksTab,
    });
    const kept = { sort: "manual", overdue: true };
    await waitFor(() => expect(result.current[0]).toEqual(kept));
    refuse = 503;
    act(() => result.current[1]({ sort: "name" }));
    expect(await screen.findByText("Choices unavailable")).toBeVisible();
    await waitFor(() => expect(result.current[0]).toEqual(kept));
    expect(await keptForTasks()).toEqual({ overdue: true });
  });

  it("holds the choices in the component alone outside an event", () => {
    const { result, unmount } = renderHook(() =>
      useViewChoices(defaults, read),
    );
    act(() => result.current[1]({ sort: "name" }));
    expect(result.current[0]).toEqual({ sort: "name", overdue: false });
    unmount();
    const again = renderHook(() => useViewChoices(defaults, read));
    expect(again.result.current[0]).toBe(defaults);
  });
});

describe("a collection page's choices", () => {
  it("holds while they load, then keeps only what differs from the defaults, by name", async () => {
    await client.updatePageChoices("tasks", {
      choices: { overdue: true, layout: "board" },
    });
    const { result } = renderHook(
      () => usePageChoices("tasks", defaults, read),
      { wrapper: Providers },
    );
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.choices).toEqual({ sort: "manual", overdue: true });
    act(() => result.current.change({ sort: "name", overdue: false }));
    await waitFor(() =>
      expect(result.current.choices).toEqual({ sort: "name", overdue: false }),
    );
    // A name the page does not know stays with the account.
    await waitFor(async () =>
      expect((await client.getPageChoices("tasks")).choices).toEqual({
        sort: "name",
        layout: "board",
      }),
    );
    refuse = 403;
    act(() => result.current.change({ sort: "due" }));
    expect(await screen.findByText("Choices unavailable")).toBeVisible();
    await waitFor(() => expect(result.current.choices.sort).toBe("name"));
  });
});
