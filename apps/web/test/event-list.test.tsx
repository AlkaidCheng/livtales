// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PageChoicesUpdate, ViewChoices } from "@livtales/schemas";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import { Providers } from "../app/providers";
import { EventList } from "../features/events/event-list";
import { mergeChoices } from "../lib/personal-views";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const event = {
  id: "019d6e7d-0000-7000-8000-000000000010",
  workspaceId,
  createdBy: workspaceId,
  permissionScopeId: "019d6e7d-0000-7000-8000-000000000010",
  objectType: "event",
  displayName: "Garden gathering",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  startsAt: null,
  endsAt: null,
  timezone: null,
  isAllDay: false,
};
const another = {
  ...event,
  id: "019d6e7d-0000-7000-8000-000000000011",
  displayName: "Another plan",
};
const own = { sharedBy: null, role: null, sharedWith: 0 };
const page = (items: (typeof event)[], nextCursor: string | null = null) =>
  Response.json({
    items: items.map((item) => ({ ...item, access: own })),
    nextCursor,
    asOf: "2026-09-07T00:00:00.000000Z",
  });

/**
 * Answers the Events page's kept choices from memory, as the account keeps
 * them, and every other request with `list`; returns the choices kept.
 */
function serveEvents(
  list: Mock<typeof globalThis.fetch>,
  kept: Record<string, ViewChoices[string]> = {},
) {
  const choices = { current: kept as ViewChoices };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (String(input) !== "/api/account/pages/events")
        return list(input, init);
      if (init?.method === "PATCH")
        choices.current = mergeChoices(
          choices.current,
          (JSON.parse(String(init.body)) as PageChoicesUpdate).choices,
        );
      return Response.json({ page: "events", choices: choices.current });
    }),
  );
  return choices;
}

describe("EventList", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("loads canonical pages, resets for server filters and refreshes from the first page", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page([event], "next_page"))
      .mockResolvedValueOnce(
        page([{ ...event, displayName: "Updated gathering" }, another]),
      )
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(page([event]));
    serveEvents(fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    expect(await screen.findByText("2 events loaded")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /Updated gathering/ }),
    ).toHaveAttribute("href", `/events/${event.id}`);
    expect(
      screen.queryByRole("link", { name: /Garden gathering/ }),
    ).not.toBeInTheDocument();
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/events?query=&scope=all&filter=all&sort=date&cursor=next_page",
    );
    await user.click(screen.getByRole("button", { name: "Sort events" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Name A-Z" }));
    expect(await screen.findByText("No events yet")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Refresh events" }));
    expect(await screen.findByText("1 event loaded")).toBeVisible();
    expect(fetch.mock.calls.slice(2).map(([url]) => url)).toEqual(
      Array(2).fill("/api/events?query=&scope=all&filter=all&sort=name"),
    );
  });

  it("debounces name requests and distinguishes filtered empty results", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page([event]))
      .mockImplementation(async () => page([]));
    serveEvents(fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await screen.findByText("Garden gathering");
    await user.type(screen.getByLabelText("Filter events by name"), "missing");
    expect(screen.queryByText("Garden gathering")).not.toBeInTheDocument();
    expect(await screen.findByText("No matching events")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/events?query=missing&scope=all&filter=all&sort=date",
    );
    await user.click(screen.getByRole("button", { name: "Filter events" }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "Upcoming & ongoing" }),
    );
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(fetch.mock.calls[2]?.[0]).toBe(
      "/api/events?query=missing&scope=all&filter=upcoming&sort=date",
    );
  });

  it("keeps loaded cards while retrying a failed continuation", async () => {
    const error = () =>
      Response.json(
        {
          error: {
            code: "internal_error",
            message: "Events unavailable",
            requestId: "test",
          },
        },
        { status: 500 },
      );
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page([event], "next_page"))
      .mockImplementationOnce(async () => error())
      .mockImplementationOnce(async () => error())
      .mockResolvedValueOnce(page([another]));
    serveEvents(fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await user.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    expect(
      await screen.findByRole("alert", {}, { timeout: 3000 }),
    ).toBeVisible();
    expect(screen.getByText("Garden gathering")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("2 events loaded")).toBeVisible();
    expect(fetch.mock.calls.slice(1).map(([url]) => url)).toEqual(
      Array(3).fill(
        "/api/events?query=&scope=all&filter=all&sort=date&cursor=next_page",
      ),
    );
  });

  it("retains private filters and loaded pages across a collection remount", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async (url) =>
        String(url).includes("cursor=")
          ? page([another])
          : page([event], "next_page"),
      );
    serveEvents(fetch);
    const user = userEvent.setup();
    const view = render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await screen.findByText("Garden gathering");
    await user.type(screen.getByLabelText("Filter events by name"), "Garden");
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await user.click(screen.getByRole("button", { name: "Sort events" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Name A-Z" }));
    await user.click(screen.getByRole("button", { name: "Filter events" }));
    await user.click(
      screen.getByRole("menuitemradio", { name: "Unscheduled" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Load more events" }),
    );
    await screen.findByText("2 events loaded");
    const requests = fetch.mock.calls.length;
    view.rerender(<Providers>{null}</Providers>);
    view.rerender(
      <Providers>
        <EventList />
      </Providers>,
    );
    expect(screen.getByLabelText("Filter events by name")).toHaveValue(
      "Garden",
    );
    expect(screen.getByRole("button", { name: "Sort events" })).toHaveAttribute(
      "data-value",
      "name",
    );
    expect(
      screen.getByRole("button", { name: "Filter events" }),
    ).toHaveAttribute("data-value", "unscheduled");
    expect(screen.getByText("2 events loaded")).toBeVisible();
    expect(fetch).toHaveBeenCalledTimes(requests);
    expect(window.location.href).not.toContain("Garden");
    expect(JSON.stringify(window.sessionStorage)).not.toContain("Garden");
  });

  it("groups date order by year and month, merging a month continued on the next page", async () => {
    const dated = (
      id: number,
      displayName: string,
      startsOn: string | null,
    ) => ({
      ...event,
      id: `019d6e7d-0000-7000-8000-0000000001${String(id).padStart(2, "0")}`,
      displayName,
      startsOn,
      location: id === 1 ? "Garden" : null,
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        page(
          [
            dated(1, "Autumn gathering", "2026-09-20"),
            dated(2, "Harvest supper", "2026-10-02"),
          ],
          "next_page",
        ),
      )
      .mockResolvedValueOnce(
        page([
          dated(3, "Lantern walk", "2026-10-24"),
          dated(4, "Winter cabin", "2027-01-09"),
          dated(5, "A quiet studio weekend", null),
        ]),
      );
    serveEvents(fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    const october = await screen.findByRole("button", {
      name: "October 1 event",
    });
    expect(october).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("heading", { level: 2, name: "2026" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 4, name: "Autumn gathering" }),
    ).toBeVisible();
    // Under its year's heading the card's dates leave the year out; an
    // unshared card has no sharing line.
    const autumn = screen.getByRole("link", { name: /Autumn gathering/ });
    expect(autumn).toHaveTextContent(/^Autumn gatheringSun, Sep 20 · Garden$/);
    expect(
      autumn.querySelector(".event-card-share-line"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more events" }));
    expect(
      await screen.findByRole("button", { name: "October 2 events" }),
    ).toBeVisible();
    expect(
      screen
        .getAllByRole("button", { expanded: true })
        .map((button) => button.textContent),
    ).toEqual([
      "2026",
      "September 1 event",
      "October 2 events",
      "2027",
      "January 1 event",
      "No date yet 1 event",
    ]);
    expect(
      screen.getByRole("heading", { level: 3, name: "A quiet studio weekend" }),
    ).toBeVisible();

    await user.click(screen.getByRole("button", { name: "October 2 events" }));
    expect(
      screen.getByRole("button", { name: "October 2 events" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByRole("link", { name: /Lantern walk/ }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "2026" }));
    const folded = screen.getByRole("button", { name: "2026 3 events" });
    expect(folded).toHaveAttribute("aria-expanded", "false");
    expect(folded).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: /September/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Winter cabin/ })).toBeVisible();
  });

  it("runs Past back from the most recent month with the earlier years folded", async () => {
    const past = (id: number, displayName: string, startsOn: string) => ({
      ...event,
      id: `019d6e7d-0000-7000-8000-0000000002${String(id).padStart(2, "0")}`,
      displayName,
      startsOn,
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(page([]))
      .mockResolvedValueOnce(
        page([
          past(1, "Summer picnic", "2026-08-16"),
          past(2, "Family reunion", "2026-07-04"),
          past(3, "New Year's Eve", "2025-12-31"),
          past(4, "Autumn walk", "2025-10-19"),
        ]),
      );
    serveEvents(fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await screen.findByText("No events yet");
    await user.click(screen.getByRole("button", { name: "Past" }));
    const earlier = await screen.findByRole("button", {
      name: "2025 2 events",
    });
    expect(earlier).toHaveAttribute("aria-expanded", "false");
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "/api/events?query=&scope=all&filter=past&sort=date",
    );
    expect(
      screen
        .getAllByRole("button", { name: /^(2026|2025|August|July)/ })
        .map((button) => button.textContent),
    ).toEqual(["2026", "August 1 event", "July 1 event", "2025 2 events"]);
    expect(
      screen.queryByRole("link", { name: /New Year's Eve/ }),
    ).not.toBeInTheDocument();
    await user.click(earlier);
    expect(
      await screen.findByRole("link", { name: /New Year's Eve/ }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /^(December|October)/ }),
    ).toHaveLength(2);
  });

  it("keeps a flat list when sorted by name or update", async () => {
    const dated = { ...event, startsOn: "2026-10-02" };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => page([dated, another]));
    serveEvents(fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await screen.findByRole("button", { name: "October 1 event" });
    await user.click(screen.getByRole("button", { name: "Sort events" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Name A-Z" }));
    expect(
      await screen.findByRole("heading", {
        level: 2,
        name: "Garden gathering",
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /October/ }),
    ).not.toBeInTheDocument();
    // Without a year's heading the card names the full date.
    expect(
      screen.getByRole("link", { name: /Garden gathering/ }),
    ).toHaveTextContent("Oct 2, 2026");
  });

  it("starts the years before this one folded in All", async () => {
    const earlierEvent = { ...event, startsOn: "2025-10-19" };
    const laterEvent = { ...another, startsOn: "2026-10-02" };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => page([earlierEvent, laterEvent]));
    serveEvents(fetch);
    const user = userEvent.setup();
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    const earlier = await screen.findByRole("button", {
      name: "2025 1 event",
    });
    expect(earlier).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "2026" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.queryByRole("link", { name: /Garden gathering/ }),
    ).not.toBeInTheDocument();
    await user.click(earlier);
    expect(
      await screen.findByRole("link", { name: /Garden gathering/ }),
    ).toBeVisible();
  });

  it("keeps the layout, the chips, the sort, and the folds on the account, never the name typed", async () => {
    const past = { ...event, startsOn: "2025-10-19" };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => page([past]));
    const kept = serveEvents(fetch);
    const user = userEvent.setup();
    const first = render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await user.click(await screen.findByRole("button", { name: "Mine" }));
    await user.click(screen.getByRole("button", { name: "Event layout" }));
    await user.click(screen.getByRole("menuitemradio", { name: "List" }));
    await user.click(
      await screen.findByRole("button", { name: "2025 1 event" }),
    );
    await user.type(screen.getByLabelText("Filter events by name"), "Garden");
    await waitFor(() =>
      expect(kept.current).toEqual({
        scope: "mine",
        layout: "list",
        "folds.all": { "2025": false },
      }),
    );
    first.unmount();

    // Another device reads them back; the name typed stays behind.
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    expect(await screen.findByRole("button", { name: "Mine" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("Filter events by name")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Event layout" }),
    ).toHaveAttribute("data-value", "list");
    expect(await screen.findByRole("button", { name: "2025" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(fetch.mock.calls.at(-1)?.[0]).toBe(
      "/api/events?query=&scope=mine&filter=all&sort=date",
    );

    // Back to the defaults, nothing is kept.
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Event layout" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Grid" }));
    await user.click(screen.getByRole("button", { name: "2025" }));
    await waitFor(() => expect(kept.current).toEqual({}));
  });

  it("waits for committed composition text before sending a name request", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementation(async () => page([]));
    serveEvents(fetch);
    render(
      <Providers>
        <EventList />
      </Providers>,
    );
    await screen.findByText("No events yet");
    const input = screen.getByLabelText("Filter events by name");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "zhong" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.change(input, { target: { value: "\u4e2d\u79cb" } });
    fireEvent.compositionEnd(input);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(
      new URL(
        String(fetch.mock.calls[1]?.[0]),
        "http://example.test",
      ).searchParams.get("query"),
    ).toBe("\u4e2d\u79cb");
  });
});
