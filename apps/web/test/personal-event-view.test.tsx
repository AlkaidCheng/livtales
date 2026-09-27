// @vitest-environment jsdom

import { LivTalesApiClient } from "@livtales/api-client";
import type { EventPage } from "@livtales/schemas";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { EventWorkspace } from "../features/events/event-workspace";
import { placeSettleMs } from "../features/events/use-event-place";
import { keptViewStores } from "../lib/kept-views";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/events",
}));

/** The sample account, as the sandbox session names it. */
const accountId = "00000000-0000-4000-8000-000000000002";

let store: SandboxStore;
let client: LivTalesApiClient;
let eventId: string;
let plan: EventPage;
let day: EventPage;
/** The role the sample store answers as: the owner edits, a viewer does not. */
let role: "owner" | "viewer";
/** The saves of the account's view, as sent. */
let saves: { readonly change: unknown; readonly keepalive: boolean }[];
/** Whether the account may also delete the event, which the sample store never grants. */
let grantDelete: boolean;

beforeEach(async () => {
  vi.stubGlobal("localStorage", window.sessionStorage);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  for (const method of ["showModal", "close"] as const)
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
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
  const event = (await client.listEvents({})).items.find(
    (candidate) => candidate.displayName === "Autumn gathering",
  );
  assert(event);
  eventId = event.id;
  plan = {
    id: crypto.randomUUID(),
    name: "Plan",
    components: [{ id: crypto.randomUUID(), kind: "todos" }],
  };
  day = { id: crypto.randomUUID(), name: "Day", components: [] };
  await client.updateEventLayout(eventId, {
    expectedVersion: 0,
    pages: [plan, day],
  });
  role = "owner";
  saves = [];
  grantDelete = false;
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async (input, options) => {
      const url = String(input);
      if (options?.method === "PATCH" && url.endsWith("/view"))
        saves.push({
          change: JSON.parse(String(options.body)),
          keepalive: options.keepalive === true,
        });
      if (grantDelete && url.endsWith(`/${eventId}/access`)) {
        const access = await (await store.fetch(input, options, role)).json();
        return Response.json({
          ...access,
          actions: [...access.actions, "delete"],
        });
      }
      return store.fetch(input, options, role);
    }),
  );
  window.history.replaceState(null, "", `/events/${eventId}`);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function renderEvent() {
  return render(
    <Providers>
      <EventWorkspace eventId={eventId} />
    </Providers>,
  );
}

const yours = async () => (await client.getEventLayoutWithView(eventId)).yours;
const address = () => new URLSearchParams(window.location.search);
const tabNames = () =>
  screen.getAllByRole("tab").map((tab) => tab.firstChild?.textContent);
const settle = () =>
  act(() => new Promise((resolve) => setTimeout(resolve, placeSettleMs + 300)));

describe("the account's own view of an event", () => {
  it("opens where the account left it and keeps a place once the account settles there", async () => {
    await client.updateEventView(eventId, { place: { view: "notes" } });
    const user = userEvent.setup();
    const first = renderEvent();
    await waitFor(() => expect(address().get("view")).toBe("notes"));
    await screen.findByRole("tab", { name: "Notes", selected: true });

    // Moving on through the tabs keeps only where the account stays.
    await user.click(screen.getByRole("tab", { name: "Tasks" }));
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("tab", { name: "Tasks" }));
    expect(saves).toEqual([]);
    await settle();
    expect(saves).toEqual([
      { change: { place: { view: "todos" } }, keepalive: false },
    ]);

    // Leaving the page keeps where the account was, at once.
    await user.click(screen.getByRole("button", { name: "Plan" }));
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    await waitFor(() =>
      expect(saves.at(-1)).toEqual({
        change: { place: { page: plan.id } },
        keepalive: true,
      }),
    );

    // Leaving the event for another page of the app does too.
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    first.rerender(<Providers>{null}</Providers>);
    await waitFor(() =>
      expect(saves.at(-1)).toEqual({
        change: { place: { view: "overview" } },
        keepalive: false,
      }),
    );
    expect(saves).toHaveLength(3);
    await waitFor(async () =>
      expect((await yours()).place).toEqual({ view: "overview" }),
    );
  }, 10_000);

  it("opens on a page it was left on, and on the Overview once that page is gone", async () => {
    await client.updateEventView(eventId, { place: { page: day.id } });
    const first = renderEvent();
    await waitFor(() => expect(address().get("page")).toBe(day.id));
    expect(await screen.findByRole("button", { name: "Day" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    first.unmount();
    await client.updateEventLayout(eventId, {
      expectedVersion: 1,
      pages: [plan],
    });
    window.history.replaceState(null, "", `/events/${eventId}`);
    renderEvent();
    await waitFor(() => expect(address().get("view")).toBe("overview"));
  });

  it("moves the place this browser kept to the account and opens there", async () => {
    window.localStorage.setItem(
      keptViewStores.places,
      JSON.stringify([[`${accountId}:${eventId}`, { page: day.id }]]),
    );
    renderEvent();
    await waitFor(() => expect(address().get("page")).toBe(day.id));
    expect((await yours()).place).toEqual({ page: day.id });
    expect(window.localStorage.getItem(keptViewStores.places)).toBeNull();
  });

  it("shows the new event's strip for a view kept with a place alone", async () => {
    await client.updateEventView(eventId, { place: { view: "todos" } });
    renderEvent();
    await screen.findByRole("tab", { name: "Tasks", selected: true });
    expect(tabNames()).toEqual(["Overview", "Tasks"]);
    expect((await yours()).stored).toBe(true);
  });

  it("keeps an editor's page order for the event too, and a viewer's for the viewer alone", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", `/events/${eventId}?view=overview`);
    const openManageTabs = async () => {
      await user.click(
        await screen.findByRole("button", {
          name: "Actions for Autumn gathering",
        }),
      );
      await user.click(screen.getByRole("menuitem", { name: "Manage tabs" }));
      return within(await screen.findByRole("dialog", { name: "Manage tabs" }));
    };
    const stripPages = () =>
      [...document.querySelectorAll(".event-strip-pages [data-page-id]")].map(
        (page) => page.textContent,
      );

    const editor = renderEvent();
    await screen.findByRole("button", { name: "Day" });
    const manage = await openManageTabs();
    manage.getByRole("button", { name: "Move Day" }).focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(async () =>
      expect(
        (await client.getEventLayout(eventId)).pages.map((page) => page.name),
      ).toEqual(["Day", "Plan"]),
    );
    expect((await yours()).pages).toEqual([day.id, plan.id]);
    expect(stripPages()).toEqual(["Day", "Plan"]);
    editor.unmount();

    role = "viewer";
    renderEvent();
    await screen.findByRole("button", { name: "Day" });
    const viewing = await openManageTabs();
    expect(viewing.queryByRole("button", { name: "New page" })).toBeNull();
    viewing.getByRole("button", { name: "Move Plan" }).focus();
    await user.keyboard("{ArrowUp}");
    await waitFor(() => expect(stripPages()).toEqual(["Plan", "Day"]));
    await waitFor(async () =>
      expect((await yours()).pages).toEqual([plan.id, day.id]),
    );
    const layout = await client.getEventLayout(eventId);
    expect(layout.version).toBe(2);
    expect(layout.pages.map((page) => page.name)).toEqual(["Day", "Plan"]);
  });

  it("keeps a place still waiting before the event can go to Trash", async () => {
    const user = userEvent.setup();
    grantDelete = true;
    window.history.replaceState(null, "", `/events/${eventId}?view=overview`);
    renderEvent();
    await screen.findByRole("tab", { name: "Overview", selected: true });
    await user.click(screen.getByRole("tab", { name: "Tasks" }));
    await user.click(
      screen.getByRole("button", { name: "Actions for Autumn gathering" }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Move to Trash" }));
    // Saved at once, long before the place would settle.
    await waitFor(
      () =>
        expect(saves).toEqual([
          { change: { place: { view: "todos" } }, keepalive: false },
        ]),
      { timeout: placeSettleMs / 3 },
    );
    expect(await screen.findByRole("dialog")).toBeVisible();
  });

  it("keeps a page component's choices for the account", async () => {
    const user = userEvent.setup();
    const [component] = plan.components;
    assert(component);
    window.history.replaceState(null, "", `/events/${eventId}?page=${plan.id}`);
    const first = renderEvent();
    await screen.findByText("Confirm the garden venue");
    await user.click(screen.getByRole("button", { name: /^Sort/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "By name" }));
    await waitFor(async () =>
      expect((await yours()).choices).toEqual({
        [component.id]: { sort: "name" },
      }),
    );
    first.unmount();

    // Back on the page, the component is as it was left.
    renderEvent();
    await screen.findByText("Confirm the garden venue");
    await user.click(screen.getByRole("button", { name: /^Sort/ }));
    expect(
      screen.getByRole("menuitemradio", { name: "By name" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
