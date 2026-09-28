import { LivTalesApiClient } from "@livtales/api-client";
import type { EventPage } from "@livtales/schemas";
import { assert, beforeEach, describe, expect, it } from "vitest";
import { SandboxStore, sandboxWorkspaceId } from "../sandbox/store";

let raw: string | null;
let store: SandboxStore;

/** A client of the sample store as the given role previews it. */
function clientOf(role: "owner" | "viewer" = "owner", from = store) {
  return new LivTalesApiClient({
    getCredential: () => ({
      accessToken: "sample",
      workspaceId: sandboxWorkspaceId,
    }),
    fetch: (input, options) => from.fetch(input, options, role),
  });
}

async function sampleEvent() {
  const event = (await clientOf().listEvents({})).items.find(
    (candidate) => candidate.displayName === "Autumn gathering",
  );
  assert(event);
  return event;
}

function page(
  name: string,
  kinds: readonly EventPage["components"][number]["kind"][],
): EventPage {
  return {
    id: crypto.randomUUID(),
    name,
    components: kinds.map((kind) => ({ id: crypto.randomUUID(), kind })),
  };
}

beforeEach(() => {
  raw = null;
  store = new SandboxStore({
    getItem: () => raw,
    setItem: (_key, value) => {
      raw = value;
    },
  });
});

describe("the sample account's own views", () => {
  it("reads the event's defaults until a save keeps a copy of them", async () => {
    const client = clientOf();
    const event = await sampleEvent();
    const plan = page("Plan", ["todos", "calendar"]);
    const day = page("Day", []);
    await client.updateEventLayout(event.id, {
      expectedVersion: 0,
      pages: [plan, day],
    });
    const [tasks, calendar] = plan.components.map((component) => component.id);
    assert(tasks !== undefined && calendar !== undefined);
    const read = await client.getEventLayoutWithView(event.id);
    expect(read.pages).toEqual([plan, day]);
    expect(read.yours).toEqual({
      stored: false,
      place: null,
      tabs: {},
      pages: [plan.id, day.id],
      layouts: { [tasks]: null, [calendar]: null },
      choices: {},
    });
    // The layout read without the view stays as it was.
    expect(await client.getEventLayout(event.id)).not.toHaveProperty("yours");

    const saved = await client.updateEventView(event.id, {
      place: { page: day.id },
      pages: [day.id],
      layouts: { [calendar]: "month", [crypto.randomUUID()]: "list" },
      choices: { todos: { sort: "name" }, [crypto.randomUUID()]: { a: 1 } },
    });
    expect(saved).toEqual({
      stored: true,
      place: { page: day.id },
      tabs: {},
      pages: [day.id, plan.id],
      layouts: { [tasks]: null, [calendar]: "month" },
      choices: { todos: { sort: "name" } },
    });

    // The event's order changes; the kept copy does not, and a new page
    // joins it after the nearest page before it.
    const extra = page("Extra", []);
    await client.updateEventLayout(event.id, {
      expectedVersion: 1,
      pages: [plan, extra, day],
    });
    expect((await client.getEventLayoutWithView(event.id)).yours.pages).toEqual(
      [day.id, plan.id, extra.id],
    );

    // Choices merge per component; null or nothing returns one to its defaults.
    expect(
      (
        await client.updateEventView(event.id, {
          choices: { todos: null, [tasks]: { show: "all" } },
        })
      ).choices,
    ).toEqual({ [tasks]: { show: "all" } });
    // The view outlives a reload of the sample.
    expect(
      (
        await clientOf(
          "owner",
          new SandboxStore({ getItem: () => raw, setItem: () => {} }),
        ).getEventLayoutWithView(event.id)
      ).yours.choices,
    ).toEqual({ [tasks]: { show: "all" } });
  });

  it("lets the Viewer preview keep its own view and page choices, not the event's", async () => {
    const viewer = clientOf("viewer");
    const event = await sampleEvent();
    expect(
      (await viewer.updateEventView(event.id, { place: { view: "notes" } }))
        .place,
    ).toEqual({ view: "notes" });
    expect(
      await viewer.updatePageChoices("people", {
        choices: { layout: "cards" },
      }),
    ).toEqual({ page: "people", choices: { layout: "cards" } });
    await expect(
      viewer.updateEventLayout(event.id, { expectedVersion: 0, pages: [] }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("merges a page's choices by name, null returning one to its default", async () => {
    const client = clientOf();
    expect(await client.getPageChoices("events")).toEqual({
      page: "events",
      choices: {},
    });
    await client.updatePageChoices("events", {
      choices: {
        layout: "list",
        scope: "mine",
        "folds.past": { "2025": false },
      },
    });
    expect(
      await client.updatePageChoices("events", {
        choices: { scope: null, sort: "name" },
      }),
    ).toEqual({
      page: "events",
      choices: {
        layout: "list",
        sort: "name",
        "folds.past": { "2025": false },
      },
    });
    expect((await client.getPageChoices("tasks")).choices).toEqual({});
    // A page keeps up to forty choices.
    await expect(
      client.updatePageChoices("tasks", {
        choices: Object.fromEntries(
          Array.from({ length: 41 }, (_, index) => [`c${index}`, true]),
        ),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
