import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  createId,
  objects,
  resourceGrants,
  userComponentChoices,
  userEventViews,
  userPageChoices,
  users,
  workspaceMembers,
} from "@livtales/db";
import type {
  EventComponentKind,
  EventComponentView,
  EventPage,
  EventViewStateUpdate,
} from "@livtales/schemas";
import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBasePersonalViewRepository } from "../src/cloudbase-personal-view-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";
import { EventLayoutService } from "../src/event-layout-service.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import {
  componentChoicesLimit,
  eventViewLimit,
  planEventViewSave,
} from "../src/personal-view-state.js";
import {
  type PersonalViewReadRepository,
  type PersonalViewWriteRepository,
  PersonalViewService,
  PostgresPersonalViewRepository,
} from "../src/personal-views.js";
import {
  createWriteHarness,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// Each account's view of an event must read and save alike through the
// Drizzle repository and through the chronelle_user_event_view_* and
// chronelle_user_page_choices_* functions, so every case runs on both
// paths. Each case works in its own Events and with its own accounts.

type Repository = PersonalViewReadRepository & PersonalViewWriteRepository;

let harness: WriteHarness;
let events: EventPlanningObjectService;
let layouts: EventLayoutService;
const paths = new Map<
  string,
  { readonly views: PersonalViewService; readonly repository: Repository }
>();

beforeAll(async () => {
  harness = await createWriteHarness("Personal views");
  const db = harness.database.connection.db;
  events = new EventPlanningObjectService(db);
  layouts = new EventLayoutService(db);
  for (const [name, repository] of [
    ["postgres", new PostgresPersonalViewRepository(db)],
    ["cloudbase", new CloudBasePersonalViewRepository(harness)],
  ] as const)
    paths.set(name, {
      views: new PersonalViewService(layouts, repository, repository),
      repository,
    });
});

afterAll(async () => {
  await harness?.database.close();
});

function page(
  id: string,
  components: readonly {
    readonly id: string;
    readonly kind?: EventComponentKind;
    readonly view?: EventComponentView;
  }[] = [],
): EventPage {
  return {
    id,
    name: "Page",
    components: components.map((component) => ({
      kind: "todos",
      ...component,
    })),
  };
}

const owner = (): UserPrincipal => ({
  type: "user",
  userId: harness.ownerId,
  workspaceId: harness.workspaceId,
});

async function member(role: "editor" | "viewer" = "editor") {
  const userId = createId();
  const db = harness.database.connection.db;
  await db.insert(users).values({
    id: userId,
    identityProvider: "test",
    providerSubject: userId,
    displayName: "Planner",
  });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId: harness.workspaceId, userId, role });
  return {
    type: "user" as const,
    userId,
    workspaceId: harness.workspaceId,
  };
}

async function setLayout(eventId: string, pages: readonly EventPage[]) {
  const { version } = await layouts.get(owner(), eventId);
  await layouts.update(mutationContext(harness), eventId, {
    expectedVersion: version,
    pages: [...pages],
  });
}

async function newEvent(pages: readonly EventPage[] = []) {
  const event = await events.createEvent(mutationContext(harness), {
    displayName: "Kyoto in November",
  });
  if (pages.length > 0) await setLayout(event.id, pages);
  return event.id;
}

async function storedRow(userId: string, eventId: string) {
  const [row] = await harness.database.connection.db
    .select()
    .from(userEventViews)
    .where(
      and(
        eq(userEventViews.userId, userId),
        eq(userEventViews.eventId, eventId),
      ),
    );
  return row;
}

async function choiceRows(userId: string, eventId: string) {
  const rows = await harness.database.connection.db
    .select({
      component: userComponentChoices.component,
      choices: userComponentChoices.choices,
    })
    .from(userComponentChoices)
    .where(
      and(
        eq(userComponentChoices.userId, userId),
        eq(userComponentChoices.eventId, eventId),
      ),
    )
    .orderBy(asc(userComponentChoices.component));
  return Object.fromEntries(rows.map((row) => [row.component, row.choices]));
}

describe.each(["postgres", "cloudbase"])("personal views (%s)", (path) => {
  const views = () => paths.get(path)?.views as PersonalViewService;
  const repository = () => paths.get(path)?.repository as Repository;

  it("reads the event's defaults before the first save and writes nothing", async () => {
    const [first, second, board, notes] = [
      createId(),
      createId(),
      createId(),
      createId(),
    ];
    const eventId = await newEvent([
      page(first, [{ id: board, view: "board" }]),
      page(second, [{ id: notes, kind: "notes" }]),
    ]);
    const read = await views().getEventLayoutWithView(owner(), eventId);
    expect(read).toMatchObject({ eventId, version: 1 });
    expect(read.pages.map((listed) => listed.id)).toEqual([first, second]);
    expect(read.yours).toEqual({
      stored: false,
      place: null,
      tabs: {},
      pages: [first, second],
      layouts: { [board]: "board", [notes]: null },
      choices: {},
    });
    expect(await storedRow(harness.ownerId, eventId)).toBeUndefined();

    const bare = await newEvent();
    expect((await views().getEventLayoutWithView(owner(), bare)).yours).toEqual(
      {
        stored: false,
        place: null,
        tabs: {},
        pages: [],
        layouts: {},
        choices: {},
      },
    );
  });

  it("keeps the event's defaults as they were at the first save", async () => {
    const person = await member();
    const [first, second, board, notes] = [
      createId(),
      createId(),
      createId(),
      createId(),
    ];
    const eventId = await newEvent([
      page(first, [{ id: board, view: "board" }]),
      page(second, [{ id: notes, kind: "notes" }]),
    ]);
    expect(
      await views().updateEventView(person, eventId, {
        place: { view: "todos" },
      }),
    ).toEqual({
      stored: true,
      place: { view: "todos" },
      tabs: {},
      pages: [first, second],
      layouts: { [board]: "board", [notes]: null },
      choices: {},
    });
    await setLayout(eventId, [
      page(second, [{ id: notes, kind: "notes", view: "list" }]),
      page(first, [{ id: board, view: "week" }]),
    ]);
    expect(
      (await views().getEventLayoutWithView(person, eventId)).yours,
    ).toMatchObject({
      pages: [first, second],
      layouts: { [board]: "board", [notes]: null },
    });
    // Someone who has not saved sees the event's defaults as they are now.
    const newcomer = await member("viewer");
    expect(
      (await views().getEventLayoutWithView(newcomer, eventId)).yours,
    ).toMatchObject({
      stored: false,
      pages: [second, first],
      layouts: { [board]: "week", [notes]: "list" },
    });
  });

  it("places a page added since after the page before it, else last, and keeps it there once saved", async () => {
    const person = await member();
    const [lead, first, middle, last] = [
      createId(),
      createId(),
      createId(),
      createId(),
    ];
    const eventId = await newEvent([page(first), page(last)]);
    await views().updateEventView(person, eventId, { pages: [last, first] });
    await setLayout(eventId, [
      page(lead),
      page(first),
      page(middle),
      page(last),
    ]);
    expect(
      (await views().getEventLayoutWithView(person, eventId)).yours.pages,
    ).toEqual([last, first, middle, lead]);
    // Reading never writes: the stored copy is brought up at the next save.
    expect((await storedRow(person.userId, eventId))?.pages).toEqual([
      last,
      first,
    ]);
    await views().updateEventView(person, eventId, {
      place: { view: "calendar" },
    });
    expect((await storedRow(person.userId, eventId))?.pages).toEqual([
      last,
      first,
      middle,
      lead,
    ]);
    await setLayout(eventId, [
      page(middle),
      page(last),
      page(first),
      page(lead),
    ]);
    expect(
      (await views().getEventLayoutWithView(person, eventId)).yours.pages,
    ).toEqual([last, first, middle, lead]);
  });

  it("leaves out pages and components the event no longer has, and a place on them", async () => {
    const person = await member();
    const [kept, removed, keptTodos, removedTodos] = [
      createId(),
      createId(),
      createId(),
      createId(),
    ];
    const eventId = await newEvent([
      page(kept, [{ id: keptTodos }]),
      page(removed, [{ id: removedTodos }]),
    ]);
    const saved = await views().updateEventView(person, eventId, {
      place: { page: removed },
      tabs: { order: ["todos"], hidden: [removed, "sharing"] },
      layouts: { [removedTodos]: "board" },
      choices: {
        todos: { sort: "due" },
        [keptTodos]: { show: "mine" },
        [removedTodos]: { show: "all" },
      },
    });
    expect(saved).toMatchObject({
      place: { page: removed },
      tabs: { hidden: [removed, "sharing"] },
      layouts: { [keptTodos]: null, [removedTodos]: "board" },
    });
    await setLayout(eventId, [page(kept, [{ id: keptTodos }])]);
    expect(
      (await views().getEventLayoutWithView(person, eventId)).yours,
    ).toEqual({
      stored: true,
      place: null,
      tabs: { order: ["todos"], hidden: ["sharing"] },
      pages: [kept],
      layouts: { [keptTodos]: null },
      choices: { todos: { sort: "due" }, [keptTodos]: { show: "mine" } },
    });
    expect(Object.keys(await choiceRows(person.userId, eventId))).toHaveLength(
      3,
    );
    // The next save stores the copy without them and removes their choices.
    await views().updateEventView(person, eventId, {
      choices: { todos: { sort: "title" } },
    });
    expect(await storedRow(person.userId, eventId)).toMatchObject({
      tabs: { order: ["todos"], hidden: ["sharing"] },
      pages: [kept],
      layouts: { [keptTodos]: null },
    });
    expect(await choiceRows(person.userId, eventId)).toEqual({
      todos: { sort: "title" },
      [keptTodos]: { show: "mine" },
    });
  });

  it("saves each component's layout and choices on their own and ignores ids the event does not have", async () => {
    const person = await member();
    const [only, todos, notes, ghostPage, ghostComponent] = [
      createId(),
      createId(),
      createId(),
      createId(),
      createId(),
    ];
    const eventId = await newEvent([
      page(only, [{ id: todos }, { id: notes, kind: "notes" }]),
    ]);
    const saved = await views().updateEventView(person, eventId, {
      place: { page: ghostPage },
      pages: [ghostPage, only],
      tabs: { hidden: [ghostPage, "files"] },
      layouts: { [todos]: "list", [ghostComponent]: "week" },
      choices: {
        [todos]: { show: "all" },
        [ghostComponent]: { show: "mine" },
        [ghostPage]: { sort: "due" },
        calendar: { mode: "week", folds: { "2025": true } },
      },
    });
    expect(saved).toEqual({
      stored: true,
      place: null,
      tabs: { hidden: ["files"] },
      pages: [only],
      layouts: { [todos]: "list", [notes]: null },
      choices: {
        [todos]: { show: "all" },
        calendar: { mode: "week", folds: { "2025": true } },
      },
    });
    expect((await storedRow(person.userId, eventId))?.place).toBeNull();
    const next = await views().updateEventView(person, eventId, {
      layouts: { [notes]: "list", [todos]: null },
      choices: { [todos]: null, calendar: {} },
    });
    expect(next.layouts).toEqual({ [todos]: null, [notes]: "list" });
    expect(next.choices).toEqual({});
    expect(await choiceRows(person.userId, eventId)).toEqual({});
  });

  it("keeps what each of two racing saves changed", async () => {
    const person = await member();
    const [first, second, added, todos, notes] = [
      createId(),
      createId(),
      createId(),
      createId(),
      createId(),
    ];
    const eventId = await newEvent([
      page(first, [{ id: todos }, { id: notes, kind: "notes" }]),
      page(second),
    ]);
    await views().updateEventView(person, eventId, {
      place: { view: "overview" },
    });
    // Saves planned from the same read, written one after another.
    const layout = (await layouts.get(person, eventId)).pages;
    const stale = await repository().readEventView(person, eventId);
    const changes: EventViewStateUpdate[] = [
      { place: { view: "calendar" } },
      { tabs: { order: ["notes"] } },
      { layouts: { [todos]: "list" } },
      { layouts: { [notes]: "week" } },
      { choices: { todos: { sort: "due" } } },
      { choices: { notes: { sort: "title" } } },
    ];
    for (const change of changes)
      await repository().writeEventView(
        person,
        eventId,
        planEventViewSave(layout, stale, change),
      );
    expect(
      (await views().getEventLayoutWithView(person, eventId)).yours,
    ).toEqual({
      stored: true,
      place: { view: "calendar" },
      tabs: { order: ["notes"] },
      pages: [first, second],
      layouts: { [todos]: "list", [notes]: "week" },
      choices: { todos: { sort: "due" }, notes: { sort: "title" } },
    });

    // Bringing a stale copy up to the layout never undoes a newer order.
    await setLayout(eventId, [
      page(first, [{ id: todos }, { id: notes, kind: "notes" }]),
      page(added),
      page(second),
    ]);
    const grown = (await layouts.get(person, eventId)).pages;
    const before = await repository().readEventView(person, eventId);
    await repository().writeEventView(
      person,
      eventId,
      planEventViewSave(grown, before, { pages: [second, first] }),
    );
    await repository().writeEventView(
      person,
      eventId,
      planEventViewSave(grown, before, { place: { view: "notes" } }),
    );
    expect(await storedRow(person.userId, eventId)).toMatchObject({
      place: { view: "notes" },
      pages: [second, first, added],
    });

    // Saves through the service at once, the first ones included.
    const fresh = await newEvent([page(first)]);
    for (const target of [eventId, fresh])
      await Promise.all([
        views().updateEventView(person, target, { place: { view: "files" } }),
        views().updateEventView(person, target, {
          tabs: { removed: ["files"] },
        }),
        views().updateEventView(person, target, {
          choices: { files: { sort: "name" } },
        }),
      ]);
    for (const target of [eventId, fresh])
      expect(
        (await views().getEventLayoutWithView(person, target)).yours,
      ).toMatchObject({
        place: { view: "files" },
        tabs: { removed: ["files"] },
        choices: { files: { sort: "name" } },
      });
  });

  it("keeps the 200 most recently opened events and the 1,000 most recently changed choices", async () => {
    const person = await member();
    const sql = harness.database.connection.sql;
    // Earlier views, each opened a minute before the next; the choices
    // belong to the 100 most recent of them.
    await sql`
      WITH created AS (
        INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id)
        SELECT id, ${harness.workspaceId}, 'event', 'Earlier', ${harness.ownerId}, id
        FROM (SELECT chronelle_uuidv7() AS id FROM generate_series(1, ${eventViewLimit})) g
        RETURNING id
      ), typed AS (
        INSERT INTO events (object_id, workspace_id)
        SELECT id, ${harness.workspaceId} FROM created
        RETURNING object_id
      )
      INSERT INTO user_event_views (user_id, event_id, opened_at)
      SELECT ${person.userId}, object_id,
        now() - interval '1 day' - row_number() OVER (ORDER BY object_id) * interval '1 minute'
      FROM typed
    `;
    await sql`
      INSERT INTO user_component_choices (user_id, event_id, component, choices, updated_at)
      SELECT ${person.userId}, v.event_id, 'view' || n, '{"sort": "due"}'::jsonb,
        now() - interval '1 day' - ((v.recency - 1) * 10 + n) * interval '1 second'
      FROM (
        SELECT event_id, row_number() OVER (ORDER BY opened_at DESC) AS recency
        FROM user_event_views WHERE user_id = ${person.userId}
      ) v
      CROSS JOIN generate_series(1, 10) n
      WHERE v.recency <= ${componentChoicesLimit / 10}
    `;
    const [oldestView] = await sql<{ event_id: string }[]>`
      SELECT event_id FROM user_event_views WHERE user_id = ${person.userId}
      ORDER BY opened_at ASC LIMIT 1
    `;
    const [oldestChoice] = await sql<{ event_id: string; component: string }[]>`
      SELECT event_id, component FROM user_component_choices WHERE user_id = ${person.userId}
      ORDER BY updated_at ASC LIMIT 1
    `;

    const eventId = await newEvent();
    await views().updateEventView(person, eventId, {
      place: { view: "todos" },
      choices: { todos: { sort: "due" } },
    });
    const [counted] = await sql<{ views: number; choices: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM user_event_views WHERE user_id = ${person.userId}) AS views,
        (SELECT count(*)::integer FROM user_component_choices WHERE user_id = ${person.userId}) AS choices
    `;
    expect(counted).toEqual({
      views: eventViewLimit,
      choices: componentChoicesLimit,
    });
    expect(await storedRow(person.userId, eventId)).toBeDefined();
    expect(
      await storedRow(person.userId, oldestView?.event_id ?? ""),
    ).toBeUndefined();
    expect(await choiceRows(person.userId, eventId)).toEqual({
      todos: { sort: "due" },
    });
    expect(
      await sql`
        SELECT 1 FROM user_component_choices
        WHERE user_id = ${person.userId} AND event_id = ${oldestChoice?.event_id ?? ""}
          AND component = ${oldestChoice?.component ?? ""}
      `,
    ).toHaveLength(0);
    // Saving an event opened long ago keeps it.
    const [stalest] = await sql<{ event_id: string }[]>`
      SELECT event_id FROM user_event_views WHERE user_id = ${person.userId}
      ORDER BY opened_at ASC LIMIT 1
    `;
    await views().updateEventView(person, stalest?.event_id ?? "", {
      tabs: { order: ["notes"] },
    });
    expect(
      await storedRow(person.userId, stalest?.event_id ?? ""),
    ).toMatchObject({ tabs: { order: ["notes"] } });
  });

  it("reads and saves only with view access to a live Event", async () => {
    const [only] = [createId()];
    const eventId = await newEvent([page(only)]);
    const stranger: UserPrincipal = {
      type: "user",
      userId: harness.viewerId,
      workspaceId: harness.workspaceId,
    };
    const plan = planEventViewSave([page(only)], null, {
      place: { view: "todos" },
    });
    for (const attempt of [
      () => views().getEventLayoutWithView(stranger, eventId),
      () =>
        views().updateEventView(stranger, eventId, {
          place: { view: "todos" },
        }),
      () => repository().readEventView(stranger, eventId),
      () => repository().writeEventView(stranger, eventId, plan),
    ])
      await expect(attempt()).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(await storedRow(harness.viewerId, eventId)).toBeUndefined();

    // A share of the Event is enough, from the Event's workspace.
    await harness.database.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: harness.workspaceId,
      resourceId: eventId,
      principalId: harness.viewerId,
      role: "viewer",
      grantedBy: harness.ownerId,
    });
    expect(
      await views().updateEventView(stranger, eventId, {
        place: { page: only },
      }),
    ).toMatchObject({ stored: true, place: { page: only } });

    // Only Events have views.
    const task = await events.createTask(mutationContext(harness), {
      displayName: "Book the ryokan",
    });
    await expect(
      views().updateEventView(owner(), task.id, { place: { view: "todos" } }),
    ).rejects.toBeInstanceOf(InvalidObjectStateError);
    await expect(
      repository().writeEventView(owner(), task.id, plan),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    // An Event in Trash is unavailable, its views kept.
    await harness.database.connection.db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, eventId));
    await expect(
      views().getEventLayoutWithView(stranger, eventId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      repository().writeEventView(stranger, eventId, plan),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    expect(await storedRow(harness.viewerId, eventId)).toBeDefined();
  });

  it("merges a page's choices by name and keeps them within bounds", async () => {
    const person = await member("viewer");
    const other = await member("viewer");
    expect(await views().getPageChoices(person, "events")).toEqual({});
    expect(
      await views().updatePageChoices(person, "events", {
        choices: { layout: "list", sort: "start", scope: "mine" },
      }),
    ).toEqual({ layout: "list", sort: "start", scope: "mine" });
    expect(
      await views().updatePageChoices(person, "events", {
        choices: {
          sort: null,
          "folds.past": { "2025": true, "2025-10": false },
        },
      }),
    ).toEqual({
      layout: "list",
      scope: "mine",
      "folds.past": { "2025": true, "2025-10": false },
    });
    expect(await views().getPageChoices(person, "events")).toEqual({
      layout: "list",
      scope: "mine",
      "folds.past": { "2025": true, "2025-10": false },
    });
    // Each page and each account keeps its own.
    expect(await views().getPageChoices(person, "tasks")).toEqual({});
    expect(await views().getPageChoices(other, "events")).toEqual({});

    const many = Object.fromEntries(
      Array.from({ length: 38 }, (_, index) => [`c${index}`, true]),
    );
    await expect(
      views().updatePageChoices(person, "events", { choices: many }),
    ).rejects.toBeInstanceOf(InvalidObjectStateError);
    const large = Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [
        `list${index}`,
        Array.from({ length: 10 }, () => "x".repeat(200)),
      ]),
    );
    await expect(
      views().updatePageChoices(person, "people", { choices: large }),
    ).rejects.toBeInstanceOf(InvalidObjectStateError);
    expect(await views().getPageChoices(person, "events")).toEqual({
      layout: "list",
      scope: "mine",
      "folds.past": { "2025": true, "2025-10": false },
    });
    expect(await views().getPageChoices(person, "people")).toEqual({});

    expect(
      await views().updatePageChoices(person, "events", {
        choices: { layout: null, scope: null, "folds.past": null },
      }),
    ).toEqual({});
    expect(
      await harness.database.connection.db
        .select()
        .from(userPageChoices)
        .where(eq(userPageChoices.userId, person.userId)),
    ).toEqual([]);
  });
});
