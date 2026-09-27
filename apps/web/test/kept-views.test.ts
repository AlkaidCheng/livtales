// @vitest-environment jsdom

import { LivTalesApiClient } from "@livtales/api-client";
import type { EventResponse } from "@livtales/schemas";
import {
  afterEach,
  assert,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  hasKeptViews,
  keptViewStores,
  moveKeptEventView,
  moveKeptEventViews,
  moveKeptPageChoices,
} from "../lib/kept-views";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

const me = "00000000-0000-4000-8000-000000000002";
const other = "019d6e7d-0000-7000-8000-0000000000ee";
const home = "019d6e7d-0000-7000-8000-0000000000aa";
const owner = { accountId: me, foldAccount: home };

let store: SandboxStore;
let client: LivTalesApiClient;
let event: EventResponse;
let requests: string[];

/** A client of the sample store; `refuse` answers a write with that status. */
function clientOf(refuse?: number) {
  return new LivTalesApiClient({
    getCredential: () => ({
      accessToken: "sample",
      workspaceId: sandboxWorkspaceId,
    }),
    fetch: async (input, options) => {
      requests.push(`${options?.method ?? "GET"} ${String(input)}`);
      if (refuse !== undefined && options?.method === "PATCH")
        return Response.json(
          { error: { code: "unavailable", message: "Try again" } },
          { status: refuse },
        );
      return store.fetch(input, options);
    },
  });
}

function keep(key: string, value: unknown) {
  window.localStorage.setItem(
    key,
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

function entries(key: string): [string, unknown][] {
  return JSON.parse(window.localStorage.getItem(key) ?? "[]");
}

beforeEach(async () => {
  // The test environment's local storage is the session storage it provides.
  vi.stubGlobal("localStorage", window.sessionStorage);
  let saved: string | null = null;
  store = new SandboxStore({
    getItem: () => saved,
    setItem: (_key, value) => {
      saved = value;
    },
  });
  requests = [];
  client = clientOf();
  const found = (await client.listEvents({})).items.find(
    (candidate) => candidate.displayName === "Autumn gathering",
  );
  assert(found);
  event = await client.getEvent(found.id);
  requests = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

describe("the one-time move of what this browser kept", () => {
  it("saves an event's place and the tab choices the account lacks once, then forgets them", async () => {
    await client.updateEventView(event.id, {
      choices: { notes: { layout: "list" } },
    });
    keep(keptViewStores.places, [
      [`${other}:${event.id}`, { view: "notes" }],
      [`${me}:${event.id}`, { view: "calendar" }],
    ]);
    keep(keptViewStores.choices, [
      [
        `${me}:${event.id}:todos`,
        { sort: "name", show: "open", layout: null, overdue: false },
      ],
      [`${me}:${event.id}:notes`, { noteSort: "title" }],
      [`${me}:${event.id}:calendar`, { layout: "month", noteSort: "edited" }],
      [`${me}:tasks`, { show: "all" }],
    ]);
    expect(hasKeptViews(owner)).toBe(true);
    requests = [];

    const view = await moveKeptEventView(
      client,
      me,
      await client.getEventLayoutWithView(event.id),
    );
    // Only what differs from the defaults moves, and the account's own
    // Notes choices stay.
    expect(view).toMatchObject({
      stored: true,
      place: { view: "calendar" },
      choices: {
        todos: { sort: "name" },
        notes: { layout: "list" },
        calendar: { layout: "month" },
      },
    });
    expect(requests.filter((line) => line.startsWith("PATCH"))).toHaveLength(1);
    // The browser forgets this account's event; the rest stays.
    expect(entries(keptViewStores.places)).toEqual([
      [`${other}:${event.id}`, { view: "notes" }],
    ]);
    expect(entries(keptViewStores.choices)).toEqual([
      [`${me}:tasks`, { show: "all" }],
    ]);

    // A second read finds nothing to move.
    requests = [];
    await moveKeptEventView(
      client,
      me,
      await client.getEventLayoutWithView(event.id),
    );
    expect(requests.filter((line) => line.startsWith("PATCH"))).toEqual([]);
  });

  it("keeps the account's place, and moves no place on a page that is gone", async () => {
    await client.updateEventView(event.id, { place: { view: "notes" } });
    keep(keptViewStores.places, [[`${me}:${event.id}`, { view: "calendar" }]]);
    expect(
      (
        await moveKeptEventView(
          client,
          me,
          await client.getEventLayoutWithView(event.id),
        )
      ).place,
    ).toEqual({ view: "notes" });

    const fresh = (await client.listEvents({})).items.find(
      (candidate) => candidate.id !== event.id,
    );
    assert(fresh);
    keep(keptViewStores.places, [
      [`${me}:${fresh.id}`, { page: crypto.randomUUID() }],
    ]);
    requests = [];
    const view = await moveKeptEventView(
      client,
      me,
      await client.getEventLayoutWithView(fresh.id),
    );
    expect(view.stored).toBe(false);
    expect(requests.filter((line) => line.startsWith("PATCH"))).toEqual([]);
    expect(window.localStorage.getItem(keptViewStores.places)).toBeNull();
  });

  it("puts the entries back when the save fails for a while, and drops them when it is refused", async () => {
    const kept = [[`${me}:${event.id}`, { view: "calendar" }]];
    keep(keptViewStores.places, kept);
    const layout = await client.getEventLayoutWithView(event.id);
    expect(await moveKeptEventView(clientOf(503), me, layout)).toEqual(
      layout.yours,
    );
    expect(entries(keptViewStores.places)).toEqual(kept);
    await moveKeptEventView(clientOf(403), me, layout);
    expect(window.localStorage.getItem(keptViewStores.places)).toBeNull();
  });

  it("moves every kept event but those being read, and forgets an event that is gone", async () => {
    const gone = crypto.randomUUID();
    const read = (await client.listEvents({})).items.find(
      (candidate) => candidate.id !== event.id,
    );
    assert(read);
    keep(keptViewStores.places, [
      [`${me}:${event.id}`, { view: "calendar" }],
      [`${me}:${gone}`, { view: "notes" }],
      [`${me}:${read.id}`, { view: "notes" }],
    ]);
    await moveKeptEventViews(client, me, (eventId) => eventId === read.id);
    expect((await client.getEventLayoutWithView(event.id)).yours.place).toEqual(
      { view: "calendar" },
    );
    expect(entries(keptViewStores.places)).toEqual([
      [`${me}:${read.id}`, { view: "notes" }],
    ]);
  });

  it("saves each collection page's kept choices while the account keeps none, and forgets them", async () => {
    await client.updatePageChoices("people", {
      choices: { sort: "updated" },
    });
    keep(keptViewStores.eventLayout, "list");
    keep(keptViewStores.folds(home), {
      past: { "2025": false, bad: "yes" },
      upcoming: {},
    });
    keep(keptViewStores.taskView, "month");
    keep(keptViewStores.choices, [
      [`${me}:tasks`, { show: "all", sort: "manual", fromName: "" }],
      [`${other}:tasks`, { show: "done" }],
    ]);
    keep(keptViewStores.peopleLayout, "cards");

    for (const page of ["events", "tasks", "people"] as const)
      await moveKeptPageChoices(
        client,
        owner,
        await client.getPageChoices(page),
      );
    expect((await client.getPageChoices("events")).choices).toEqual({
      layout: "list",
      "folds.past": { "2025": false },
    });
    expect((await client.getPageChoices("tasks")).choices).toEqual({
      show: "all",
      layout: "month",
    });
    // The account already keeps the People page's choices.
    expect((await client.getPageChoices("people")).choices).toEqual({
      sort: "updated",
    });
    for (const key of [
      keptViewStores.eventLayout,
      keptViewStores.folds(home),
      keptViewStores.taskView,
      keptViewStores.peopleLayout,
    ])
      expect(window.localStorage.getItem(key)).toBeNull();
    expect(entries(keptViewStores.choices)).toEqual([
      [`${other}:tasks`, { show: "done" }],
    ]);
    expect(hasKeptViews(owner)).toBe(false);
  });
});
