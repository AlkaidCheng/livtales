import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createId } from "../src/ids.js";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "../src/testing.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

let database: TestDatabase;
const temporaryDirectories: string[] = [];

beforeEach(async () => {
  database = await createTestDatabase();
});

afterEach(async () => {
  await database?.close();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/** Applies the migrations before 0079, so rows can exist when it runs. */
async function migrateBeforePersonalViews() {
  const directory = await mkdtemp(join(tmpdir(), "livtales-personal-views-"));
  temporaryDirectories.push(directory);
  await cp(migrationDirectory, directory, { recursive: true });
  for (const name of await readdir(migrationDirectory))
    if (name.endsWith(".sql") && name >= "0079_")
      await rm(join(directory, name));
  await applyMigrations({ DATABASE_URL: database.databaseUrl }, directory);
}

async function migrate() {
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    migrationDirectory,
  );
}

async function createUser(eventTabs: Record<string, unknown> = {}) {
  const userId = createId();
  await database.connection.sql`
    INSERT INTO users (id, identity_provider, provider_subject, display_name, event_tabs)
    VALUES (${userId}, 'test', ${userId}, 'Planner', ${JSON.stringify(eventTabs)}::jsonb)
  `;
  return userId;
}

async function createWorkspace(ownerId: string) {
  const workspaceId = createId();
  await database.connection.sql`
    INSERT INTO workspaces (id, display_name, created_by)
    VALUES (${workspaceId}, 'Space', ${ownerId})
  `;
  return workspaceId;
}

async function createObject(
  workspaceId: string,
  ownerId: string,
  objectType: "event" | "task",
  options: { deleted?: boolean; scopeId?: string } = {},
) {
  const id = createId();
  await database.connection.sql`
    INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id, deleted_at)
    VALUES (${id}, ${workspaceId}, ${objectType}, 'Record', ${ownerId}, ${options.scopeId ?? id},
      CASE WHEN ${options.deleted === true} THEN now() END)
  `;
  if (objectType === "event")
    await database.connection.sql`
      INSERT INTO events (object_id, workspace_id) VALUES (${id}, ${workspaceId})
    `;
  return id;
}

async function saveLayout(
  workspaceId: string,
  ownerId: string,
  eventId: string,
  version: number,
  pages: unknown[],
) {
  const auditEventId = createId();
  await database.connection.sql`
    INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id)
    VALUES (${auditEventId}, ${workspaceId}, 'user', ${ownerId}, 'event.layout_updated', ${eventId}, ${createId()})
  `;
  await database.connection.sql`
    INSERT INTO event_page_revisions (workspace_id, event_id, version, pages, audit_event_id)
    VALUES (${workspaceId}, ${eventId}, ${version}, ${JSON.stringify(pages)}::jsonb, ${auditEventId})
  `;
}

describe.sequential("each account's own view of an event", () => {
  it("copies the tabs kept for each live event with the event's current layout", async () => {
    await migrateBeforePersonalViews();
    const ownerId = await createUser();
    const workspaceId = await createWorkspace(ownerId);
    const planned = await createObject(workspaceId, ownerId, "event");
    const bare = await createObject(workspaceId, ownerId, "event");
    const trashed = await createObject(workspaceId, ownerId, "event", {
      deleted: true,
    });
    const task = await createObject(workspaceId, ownerId, "task", {
      scopeId: planned,
    });
    const [first, second, third] = [createId(), createId(), createId()];
    const [board, loose, notes] = [createId(), createId(), createId()];
    await saveLayout(workspaceId, ownerId, planned, 1, [
      { id: first, name: "Old", components: [] },
    ]);
    await saveLayout(workspaceId, ownerId, planned, 2, [
      {
        id: second,
        name: "Plan",
        components: [
          { id: board, kind: "todos", view: "board" },
          { id: loose, kind: "calendar" },
        ],
      },
      { id: third, name: "Notes", components: [{ id: notes, kind: "notes" }] },
    ]);
    const plannerId = await createUser({
      [planned]: { order: ["todos", "calendar"], hidden: [third, "sharing"] },
      [bare]: { removed: ["files"] },
      [trashed]: { hidden: ["todos"] },
      [task]: { hidden: ["todos"] },
      [createId()]: { order: ["notes"] },
    });
    const untouchedId = await createUser();

    await migrate();

    const rows = await database.connection.sql<
      {
        user_id: string;
        event_id: string;
        place: unknown;
        tabs: unknown;
        pages: unknown;
        layouts: unknown;
      }[]
    >`
      SELECT user_id, event_id, place, tabs, pages, layouts FROM user_event_views
      ORDER BY event_id
    `;
    expect(rows).toEqual(
      [
        {
          user_id: plannerId,
          event_id: planned,
          place: null,
          tabs: { order: ["todos", "calendar"], hidden: [third, "sharing"] },
          pages: [second, third],
          layouts: { [board]: "board", [loose]: null, [notes]: null },
        },
        {
          user_id: plannerId,
          event_id: bare,
          place: null,
          tabs: { removed: ["files"] },
          pages: [],
          layouts: {},
        },
      ].sort((a, b) => a.event_id.localeCompare(b.event_id)),
    );
    expect(rows.some((row) => row.user_id === untouchedId)).toBe(false);
    // The account keeps its tabs where they were until a later release.
    const [kept] = await database.connection.sql<{ event_tabs: object }[]>`
      SELECT event_tabs FROM users WHERE id = ${plannerId}
    `;
    expect(Object.keys(kept?.event_tabs ?? {})).toHaveLength(5);
  });

  it("refuses a view, a choice, or a page's choices of the wrong shape", async () => {
    await migrate();
    const sql = database.connection.sql;
    const userId = await createUser();
    const workspaceId = await createWorkspace(userId);
    const eventId = await createObject(workspaceId, userId, "event");
    const view = (fields: Record<string, unknown>) => sql`
      INSERT INTO user_event_views (user_id, event_id, place, tabs, pages, layouts)
      VALUES (${userId}, ${eventId},
        ${fields.place === undefined ? null : JSON.stringify(fields.place)}::jsonb,
        ${JSON.stringify(fields.tabs ?? {})}::jsonb,
        ${JSON.stringify(fields.pages ?? [])}::jsonb,
        ${JSON.stringify(fields.layouts ?? {})}::jsonb)
    `;
    for (const fields of [
      { place: { view: "todos", page: createId() } },
      { place: { view: 7 } },
      { place: { tab: "todos" } },
      { place: "todos" },
      { tabs: { order: "todos" } },
      { tabs: { hidden: [1] } },
      { tabs: { removed: Array.from({ length: 41 }, () => "files") } },
      { pages: ["plan"] },
      { pages: [1] },
      { pages: { first: createId() } },
      { pages: Array.from({ length: 21 }, () => createId()) },
      { layouts: { plan: "list" } },
      { layouts: { [createId()]: 1 } },
      { layouts: [] },
    ])
      await expect(view(fields), JSON.stringify(fields)).rejects.toMatchObject({
        code: "23514",
      });
    await view({
      place: { page: createId() },
      tabs: { order: ["todos"], hidden: [createId()] },
      pages: [createId()],
      layouts: { [createId()]: "list", [createId()]: null },
    });

    const choice = (component: string, choices: unknown) => sql`
      INSERT INTO user_component_choices (user_id, event_id, component, choices)
      VALUES (${userId}, ${eventId}, ${component}, ${JSON.stringify(choices)}::jsonb)
    `;
    await expect(choice("todos", {})).rejects.toMatchObject({
      code: "23514",
    });
    await expect(choice("", { sort: "due" })).rejects.toMatchObject({
      code: "23514",
    });
    await expect(choice("todos", ["due"])).rejects.toMatchObject({
      code: "23514",
    });
    await expect(
      sql`
        INSERT INTO user_component_choices (user_id, event_id, component, choices)
        VALUES (${userId}, ${createId()}, 'todos', '{"sort": "due"}')
      `,
    ).rejects.toMatchObject({ code: "23503" });
    await choice("todos", { sort: "due" });
    await expect(
      sql`
        INSERT INTO user_page_choices (user_id, page, choices)
        VALUES (${userId}, 'calendar', '{"sort": "due"}')
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("goes with its event and its account", async () => {
    await migrate();
    const sql = database.connection.sql;
    const userId = await createUser();
    const otherId = await createUser();
    const workspaceId = await createWorkspace(userId);
    // An Event without typed rows or history, so it can be removed.
    const eventId = createId();
    await sql`
      INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id)
      VALUES (${eventId}, ${workspaceId}, 'event', 'Gone', ${userId}, ${eventId})
    `;
    for (const id of [userId, otherId]) {
      await sql`INSERT INTO user_event_views (user_id, event_id) VALUES (${id}, ${eventId})`;
      await sql`
        INSERT INTO user_component_choices (user_id, event_id, component, choices)
        VALUES (${id}, ${eventId}, 'todos', '{"sort": "due"}')
      `;
    }
    await sql`
      INSERT INTO user_page_choices (user_id, page, choices)
      VALUES (${otherId}, 'events', '{"layout": "list"}')
    `;
    await sql`DELETE FROM user_event_views WHERE user_id = ${userId}`;
    expect(await sql`SELECT user_id FROM user_component_choices`).toEqual([
      { user_id: otherId },
    ]);
    await sql`DELETE FROM objects WHERE id = ${eventId}`;
    expect(await sql`SELECT 1 FROM user_event_views`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM user_component_choices`).toHaveLength(0);
    await sql`DELETE FROM users WHERE id = ${otherId}`;
    expect(await sql`SELECT 1 FROM user_page_choices`).toHaveLength(0);
  });
});
