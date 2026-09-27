// @vitest-environment jsdom

import { LivTalesApiClient } from "@livtales/api-client";
import type { EventResponse } from "@livtales/schemas";
import {
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
import { phoneQuery } from "../lib/use-media";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/events",
}));

let store: SandboxStore;
let client: LivTalesApiClient;
let event: EventResponse;

/** Answers the phone's media query, as a phone or a wide screen. */
function onPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: phone && query === phoneQuery,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(async () => {
  let snapshot: string | null = null;
  store = new SandboxStore({
    getItem: () => snapshot,
    setItem: (_key, value) => {
      snapshot = value;
    },
  });
  client = new LivTalesApiClient({
    getCredential: () => ({
      accessToken: "sample",
      workspaceId: sandboxWorkspaceId,
    }),
    fetch: (input, options) => store.fetch(input, options),
  });
  const events = await client.listEvents({});
  const found = events.items.find(
    (candidate) => candidate.displayName === "Autumn gathering",
  );
  assert(found);
  event = found;
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "sample", workspaceId: sandboxWorkspaceId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>((input, options) =>
      store.fetch(input, options),
    ),
  );
  window.history.replaceState(null, "", `/events/${event.id}?view=todos`);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function renderEvent() {
  return render(
    <Providers>
      <EventWorkspace eventId={event.id} />
    </Providers>,
  );
}

/** The strip under the title, where the tabs and the view's controls sit. */
const strip = () => {
  const element = document.querySelector<HTMLElement>(".event-strip");
  assert(element);
  return within(element);
};

describe("a tab's options on the strip", () => {
  it("puts the view's controls at the strip's end, its count on its tab, and its heading off the screen", async () => {
    onPhone(false);
    renderEvent();
    await screen.findByText("Confirm the garden venue");
    const tab = screen.getByRole("tab", { name: "Tasks", selected: true });
    expect(tab).toHaveTextContent("Tasks1");
    expect(tab).toHaveAccessibleDescription("1 open");
    for (const name of ["Sort", "Filter", "Layout: List", "Export"])
      expect(strip().getByRole("button", { name })).toBeVisible();
    expect(
      screen
        .getByRole("heading", { level: 2, name: "Tasks" })
        .closest("header"),
    ).toHaveClass("off-screen");
    // The finished task waits behind the list's foot.
    expect(screen.queryByText("Send invitations")).toBeNull();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: /1 finished/ }));
    expect(screen.getByText("Send invitations")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Finished · 1" })).toBeVisible();
    // The Overview has no controls on the strip.
    await userEvent
      .setup()
      .click(screen.getByRole("tab", { name: "Overview" }));
    expect(strip().queryByRole("button", { name: "Filter" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Tasks" })).toHaveTextContent(
      /^Tasks$/,
    );
  });

  it("keeps the tab's choices in the account's view of the event, and shows them as chips", async () => {
    onPhone(false);
    const user = userEvent.setup();
    const first = renderEvent();
    await screen.findByText("Confirm the garden venue");
    await user.click(strip().getByRole("button", { name: "Sort" }));
    await user.click(screen.getByRole("menuitemradio", { name: "By name" }));
    await user.click(strip().getByRole("button", { name: "Filter" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Filter" })).getByRole(
        "radio",
        { name: "All" },
      ),
    );
    await user.keyboard("{Escape}");
    const chips = () =>
      screen
        .queryAllByRole("button", { name: /, remove$/ })
        .map((chip) => chip.getAttribute("aria-label"));
    expect(chips()).toEqual([
      "Showing finished, remove",
      "Sorted by name, remove",
    ]);
    expect(screen.getByRole("button", { name: "Clear all" })).toBeVisible();
    await waitFor(async () =>
      expect(
        (await client.getEventLayoutWithView(event.id)).yours.choices,
      ).toEqual({ todos: { sort: "name", show: "all" } }),
    );
    first.unmount();

    // Opened again, the tab is as it was left.
    renderEvent();
    await screen.findByText("Send invitations");
    expect(chips()).toEqual([
      "Showing finished, remove",
      "Sorted by name, remove",
    ]);
    await user.click(screen.getByRole("button", { name: "Clear all" }));
    expect(chips()).toEqual([]);
    expect(screen.queryByText("Send invitations")).toBeNull();
  });

  it("gathers the options in one pop-up on a phone, marked while any is on", async () => {
    onPhone(true);
    const user = userEvent.setup();
    renderEvent();
    await screen.findByText("Confirm the garden venue");
    expect(strip().queryByRole("button", { name: "Filter" })).toBeNull();
    const options = strip().getByRole("button", { name: "Tasks options" });
    expect(options.querySelector(".view-options-dot")).toBeNull();
    await user.click(options);
    const popup = within(screen.getByRole("dialog", { name: "Tasks options" }));
    expect(popup.getByRole("heading", { name: "Tasks" })).toBeVisible();
    // The rows in order: Layout, Show, Sort, the Filter group, and Export
    // (Share follows for whoever may share the event).
    expect(
      [
        ...screen
          .getByRole("dialog", { name: "Tasks options" })
          .querySelectorAll(".view-option, .view-option-heading"),
      ].map((row) => row.firstElementChild?.textContent ?? row.textContent),
    ).toEqual([
      "Layout",
      "Show",
      "Sort",
      "Filter",
      "Assigned to",
      "Label",
      "Has a time",
      "Overdue only",
      "Export",
    ]);
    // Arrow keys move Show along its choices, applying each at once.
    const show = popup.getByRole("radiogroup", { name: "Show" });
    within(show).getByRole("radio", { name: "Open" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(within(show).getByRole("radio", { name: "All" })).toHaveFocus();
    expect(screen.getByText("Send invitations")).toBeInTheDocument();
    // Sort opens its list in the pop-up; Escape comes back to the row.
    await user.click(popup.getByRole("button", { name: /^Sort/ }));
    expect(popup.getByRole("option", { name: "Manual" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Escape}");
    expect(popup.getByRole("button", { name: /^Sort/ })).toHaveFocus();
    await user.click(popup.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Tasks options" })).toBeNull();
    expect(options).toHaveFocus();
    expect(options.querySelector(".view-options-dot")).not.toBeNull();
  });
});
