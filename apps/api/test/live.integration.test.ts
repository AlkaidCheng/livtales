import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { disconnectedDatabase } from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseLiveReader,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import {
  developmentSignInResponseSchema,
  eventContextCreateResponseSchema,
  eventResponseSchema,
  type LiveChange,
  type LivePollResponse,
  livePollResponseSchema,
  sectionResponseSchema,
  shareResponseSchema,
  taskResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

// Every change is announced on both backends: the PostgreSQL app, and the
// app composed for the gateway with the rpc functions called locally.
const transportWrite = () =>
  Promise.reject(new Error("Writes go through the rpc functions."));
const backends = {
  postgres: (database: TestDatabase) =>
    createDevelopmentAppDependencies(database.connection),
  cloudbase: (database: TestDatabase) =>
    createDevelopmentAppDependencies(disconnectedDatabase("the live test"), {
      cloudBaseRdb: {
        ...createCloudBaseLiveReader(database.connection.db),
        rpc: createCloudBaseRpcDouble(database.connection.sql),
        insert: transportWrite,
        update: transportWrite,
        delete: transportWrite,
      },
      cloudBaseWrites: true,
    }),
};

let testDatabase: TestDatabase;
let app: FastifyInstance | undefined;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  await testDatabase?.close();
});

type Session = ReturnType<typeof developmentSignInResponseSchema.parse>;

function server(): FastifyInstance {
  if (app === undefined) throw new Error("The app is not built.");
  return app;
}

async function signIn(name: string): Promise<Session> {
  const response = await server().inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email: `${name.toLowerCase()}@example.com`, displayName: name },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

const aliceTab = "tab-alice-desk";

async function request(
  session: Session,
  options: Omit<InjectOptions, "headers">,
  expected = 200,
) {
  const response = await server().inject({
    ...options,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-workspace-id": session.workspace.id,
      "x-livtales-tab": aliceTab,
    },
  });
  expect(response.statusCode, response.body).toBe(expected);
  return response;
}

async function createEvent(session: Session, displayName = "Kyoto") {
  const response = await request(
    session,
    { method: "POST", url: "/api/events", payload: { displayName } },
    201,
  );
  return eventResponseSchema.parse(response.json());
}

async function include(
  session: Session,
  eventId: string,
  resource: Record<string, unknown>,
) {
  const response = await request(
    session,
    {
      method: "POST",
      url: `/api/events/${eventId}/resources`,
      payload: { commandId: randomUUID(), resource },
    },
    201,
  );
  return eventContextCreateResponseSchema.parse(response.json()).resource;
}

async function createSection(session: Session, eventId: string, name: string) {
  const response = await request(
    session,
    {
      method: "POST",
      url: `/api/events/${eventId}/sections`,
      payload: { view: "todos", name },
    },
    201,
  );
  return sectionResponseSchema.parse(response.json());
}

interface PollPage {
  readonly page: string;
  readonly since?: string | null;
  readonly here?: boolean;
  readonly place?: string | null;
}

const clients = new Map<string, string>();

/** A browser that polls, by a name the test gives it. */
function clientId(name: string): string {
  const id = clients.get(name) ?? randomUUID();
  clients.set(name, id);
  return id;
}

async function poll(
  session: Session,
  client: string,
  pages: readonly PollPage[],
): Promise<LivePollResponse> {
  const response = await request(session, {
    method: "POST",
    url: "/api/live/poll",
    payload: {
      client: clientId(client),
      pages: pages.map((page) => ({
        since: null,
        here: false,
        place: null,
        ...page,
      })),
    },
  });
  return livePollResponseSchema.parse(response.json());
}

/** The changes on a page after `since`, once `ready` holds for them. */
async function changesOn(
  session: Session,
  client: string,
  page: string,
  since: string,
  ready: (changes: readonly LiveChange[]) => boolean,
): Promise<LiveChange[]> {
  return vi.waitFor(
    async () => {
      const answer = await poll(session, client, [{ page, since }]);
      const changes = answer.changes.map(({ change }) => change);
      expect(ready(changes)).toBe(true);
      return changes;
    },
    { timeout: 5_000, interval: 20 },
  );
}

function objectsIn(
  changes: readonly LiveChange[],
): Extract<LiveChange, { kind: "objects" }>[] {
  return changes.filter(
    (change): change is Extract<LiveChange, { kind: "objects" }> =>
      change.kind === "objects",
  );
}

describe.each(Object.entries(backends))(
  "Live changes (%s)",
  (_name, compose) => {
    beforeEach(() => {
      app = buildApp(compose(testDatabase));
    });

    it("announces a confirmed change to each viewer of a page as far as they may see it", async () => {
      const alice = await signIn("Alice");
      const bea = await signIn("Bea");
      const cy = await signIn("Cy");
      const event = await createEvent(alice);
      const venue = await createSection(alice, event.id, "Venue");
      await request(
        alice,
        {
          method: "POST",
          url: "/api/shares",
          payload: {
            resourceId: event.id,
            principalEmail: "bea@example.com",
            role: "viewer",
            scope: { view: "todos", sectionId: venue.id },
          },
        },
        201,
      );
      const page = `event:${event.id}`;
      const tasks = `tasks:${alice.workspace.id}`;
      const aliceFirst = await poll(alice, "alice", [
        { page, here: true, place: "todos" },
        { page: tasks },
      ]);
      const beaFirst = await poll(bea, "bea", [{ page, here: true }]);
      expect(beaFirst.presence).toEqual([
        {
          page,
          people: [
            { userId: alice.user.id, displayName: "Alice", place: "todos" },
            { userId: bea.user.id, displayName: "Bea", place: null },
          ],
        },
      ]);
      expect(
        (await poll(cy, "cy", [{ page, here: true }])).unavailable,
      ).toEqual([page]);

      const hall = await include(alice, event.id, {
        objectType: "task",
        displayName: "Book the hall",
        sectionId: venue.id,
      });
      const cake = await include(alice, event.id, {
        objectType: "task",
        displayName: "Order the cake",
      });

      const seenByBea = objectsIn(
        await changesOn(
          bea,
          "bea",
          page,
          beaFirst.position,
          (changes) => changes.length === 2,
        ),
      );
      expect(seenByBea).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            page,
            cause: "created",
            actor: {
              userId: alice.user.id,
              displayName: "Alice",
              tabId: aliceTab,
            },
            objects: [
              expect.objectContaining({
                id: hall.id,
                displayName: "Book the hall",
              }),
            ],
            removed: [],
          }),
          expect.objectContaining({ objects: [], removed: [cake.id] }),
        ]),
      );
      const seenByAlice = objectsIn(
        await changesOn(
          alice,
          "alice",
          tasks,
          aliceFirst.position,
          (changes) => changes.length === 2,
        ),
      );
      expect(
        seenByAlice
          .flatMap((change) => change.objects.map(({ id }) => id))
          .sort(),
      ).toEqual([hall.id, cake.id].sort());

      const renamed = await request(alice, {
        method: "PATCH",
        url: `/api/tasks/${hall.id}`,
        payload: {
          expectedVersion: hall.version,
          displayName: "Book the town hall",
        },
      });
      const version = taskResponseSchema.parse(renamed.json()).version;
      const updates = objectsIn(
        await changesOn(
          bea,
          "bea",
          page,
          beaFirst.position,
          (changes) => changes.length === 3,
        ),
      );
      expect(
        updates.find((change) => change.cause === "updated")?.objects,
      ).toEqual([
        expect.objectContaining({
          id: hall.id,
          displayName: "Book the town hall",
          version,
        }),
      ]);
    });

    it("names how objects came to be: commands, Trash, recovery, and relations", async () => {
      const alice = await signIn("Alice");
      const event = await createEvent(alice);
      const page = `event:${event.id}`;
      const { position } = await poll(alice, "alice", [{ page }]);
      const hall = await include(alice, event.id, {
        objectType: "task",
        displayName: "Book the hall",
      });
      const call = await include(alice, event.id, {
        objectType: "task",
        displayName: "Call the hall",
        parentTaskId: hall.id,
      });
      // A change reads the objects as they stand when it is announced, so
      // the next request's change may already show in it; each step waits
      // for the change it caused rather than counting.
      const changeWith = async (cause: string) =>
        objectsIn(
          await changesOn(alice, "alice", page, position, (changes) =>
            objectsIn(changes).some((change) => change.cause === cause),
          ),
        ).find((change) => change.cause === cause);

      const executed = await request(alice, {
        method: "POST",
        url: "/api/commands",
        payload: {
          operationId: randomUUID(),
          expectedStackVersion: 0,
          edits: [
            {
              objectId: hall.id,
              objectType: "task",
              patch: { expectedVersion: hall.version, displayName: "Book it" },
            },
          ],
        },
      });
      const receipt = executed.json() as {
        commandId: string;
        stackVersion: number;
      };
      await request(alice, {
        method: "POST",
        url: "/api/commands/undo",
        payload: {
          operationId: randomUUID(),
          commandId: receipt.commandId,
          expectedStackVersion: receipt.stackVersion,
        },
      });
      expect((await changeWith("updated"))?.objects[0]?.displayName).toBe(
        "Book it",
      );
      const undone = (await changeWith("undone"))?.objects[0];
      expect(undone?.displayName).toBe("Book the hall");
      const latest = undone?.version;

      await request(alice, {
        method: "DELETE",
        url: `/api/objects/${hall.id}?expectedVersion=${latest}`,
      });
      const trashed = await changeWith("trashed");
      expect(
        trashed?.objects
          .map(({ id, deletedAt }) => [id, deletedAt !== null])
          .sort(),
      ).toEqual(
        [
          [hall.id, true],
          [call.id, true],
        ].sort(),
      );
      const tombstone = trashed?.objects.find(({ id }) => id === hall.id);
      await request(alice, {
        method: "POST",
        url: `/api/objects/${hall.id}/recover`,
        payload: { expectedVersion: tombstone?.version },
      });
      const recovered = await changeWith("recovered");
      expect(
        recovered?.objects.map(({ id, deletedAt }) => [id, deletedAt]).sort(),
      ).toEqual(
        [
          [hall.id, null],
          [call.id, null],
        ].sort(),
      );

      const loose = taskResponseSchema.parse(
        (
          await request(
            alice,
            {
              method: "POST",
              url: "/api/tasks",
              payload: { displayName: "Pack" },
            },
            201,
          )
        ).json(),
      );
      const relation = (
        await request(
          alice,
          {
            method: "POST",
            url: `/api/objects/${event.id}/relations`,
            payload: { relationType: "includes", targetObjectId: loose.id },
          },
          201,
        )
      ).json() as { id: string; version: number };
      const included = await changeWith("included");
      expect(included?.objects.map(({ id }) => id)).toContain(loose.id);
      await request(alice, {
        method: "DELETE",
        url: `/api/relations/${relation.id}?expectedVersion=${relation.version}`,
      });
      const excluded = await changeWith("excluded");
      expect(excluded?.removed).toEqual([loose.id]);
    });

    it("announces sections, labels, and the layout, and the account's own view to its other browsers", async () => {
      const alice = await signIn("Alice");
      const event = await createEvent(alice);
      const page = `event:${event.id}`;
      const { position } = await poll(alice, "desk", [{ page }]);
      await poll(alice, "phone", [{ page }]);
      const venue = await createSection(alice, event.id, "Venue");
      await request(
        alice,
        { method: "POST", url: "/api/labels", payload: { name: "Urgent" } },
        201,
      );
      await request(alice, {
        method: "PATCH",
        url: `/api/events/${event.id}/layout`,
        payload: {
          expectedVersion: 0,
          pages: [{ id: randomUUID(), name: "Plan", components: [] }],
        },
      });
      const changes = await changesOn(
        alice,
        "desk",
        page,
        position,
        (all) => all.length === 3,
      );
      expect(changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "sections",
            sections: [expect.objectContaining({ id: venue.id })],
          }),
          expect.objectContaining({
            kind: "labels",
            labels: [expect.objectContaining({ name: "Urgent" })],
          }),
          expect.objectContaining({ kind: "layout", version: 1 }),
        ]),
      );

      await request(alice, {
        method: "PATCH",
        url: `/api/events/${event.id}/view`,
        payload: { place: { view: "calendar" } },
      });
      await vi.waitFor(async () => {
        const answer = await poll(alice, "phone", [{ page }]);
        expect(answer.views).toEqual([
          { target: { event: event.id }, tabId: aliceTab },
        ]);
      });
    });

    it("asks a viewer whose access changed to read the page again", async () => {
      const alice = await signIn("Alice");
      const bea = await signIn("Bea");
      const event = await createEvent(alice);
      const share = shareResponseSchema.parse(
        (
          await request(
            alice,
            {
              method: "POST",
              url: "/api/shares",
              payload: {
                resourceId: event.id,
                principalEmail: "bea@example.com",
                role: "viewer",
              },
            },
            201,
          )
        ).json(),
      );
      const page = `event:${event.id}`;
      const first = await poll(bea, "bea", [{ page, here: true }]);
      expect(first.unavailable).toEqual([]);
      await request(alice, {
        method: "DELETE",
        url: `/api/shares/${share.id}`,
      });
      await vi.waitFor(async () => {
        const answer = await poll(bea, "bea", [
          { page, since: first.position },
        ]);
        expect([...answer.reset, ...answer.unavailable]).toContain(page);
      });
      expect((await poll(bea, "bea", [{ page }])).unavailable).toEqual([page]);
    });

    it("reads a page again when a change passed while nobody watched it", async () => {
      const alice = await signIn("Alice");
      const event = await createEvent(alice);
      const page = `event:${event.id}`;
      const { position } = await poll(alice, "alice", []);
      await include(alice, event.id, {
        objectType: "task",
        displayName: "Unseen",
      });
      await vi.waitFor(async () => {
        expect(
          (await poll(alice, "alice", [{ page, since: position }])).reset,
        ).toEqual([page]);
      });
    });

    it("streams changes and presence, and ends the stream when its session signs out", async () => {
      const alice = await signIn("Alice");
      const event = await createEvent(alice);
      const page = `event:${event.id}`;
      const address = await server().listen({ port: 0, host: "127.0.0.1" });
      const response = await fetch(`${address}/api/live`, {
        headers: { authorization: `Bearer ${alice.accessToken}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(
        "text/event-stream; charset=utf-8",
      );
      const stream = frames(response);
      const ready = (await stream.next("ready")) as {
        stream: string;
        position: string;
      };

      const watched = await request(alice, {
        method: "PUT",
        url: `/api/live/streams/${ready.stream}`,
        payload: {
          pages: [
            { page, since: ready.position, here: true, place: "overview" },
          ],
        },
      });
      expect(watched.json()).toEqual({ pages: [{ page, watching: true }] });
      expect(await stream.next("presence")).toEqual({
        page,
        people: [
          { userId: alice.user.id, displayName: "Alice", place: "overview" },
        ],
      });

      const hall = await include(alice, event.id, {
        objectType: "task",
        displayName: "Book the hall",
      });
      expect(await stream.next("change")).toEqual(
        expect.objectContaining({
          kind: "objects",
          cause: "created",
          objects: [expect.objectContaining({ id: hall.id })],
        }),
      );
      expect(stream.lastId()).toMatch(/^[0-9a-f]{8}\.\d+$/);

      await request(
        alice,
        {
          method: "PUT",
          url: `/api/live/streams/not-a-stream-of-alice`,
          payload: { pages: [] },
        },
        404,
      );
      await request(alice, { method: "DELETE", url: "/api/auth/session" });
      expect(await stream.ended()).toBe(true);
    });
  },
);

/** Reads server-sent events from a response, one named event at a time. */
function frames(response: Response) {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("The stream has no body.");
  const decoder = new TextDecoder();
  const queue: { event: string; data: unknown; id: string | null }[] = [];
  let text = "";
  let done = false;
  let last: string | null = null;
  async function fill(): Promise<void> {
    const chunk = await reader?.read();
    if (chunk === undefined || chunk.done) {
      done = true;
      return;
    }
    text += decoder.decode(chunk.value, { stream: true });
    let end = text.indexOf("\n\n");
    while (end !== -1) {
      const block = text.slice(0, end);
      text = text.slice(end + 2);
      const fields = new Map(
        block
          .split("\n")
          .filter((line) => line.length > 0 && !line.startsWith(":"))
          .map((line) => {
            const colon = line.indexOf(": ");
            return [line.slice(0, colon), line.slice(colon + 2)] as const;
          }),
      );
      const event = fields.get("event");
      const data = fields.get("data");
      if (event !== undefined && data !== undefined)
        queue.push({
          event,
          data: JSON.parse(data),
          id: fields.get("id") ?? null,
        });
      end = text.indexOf("\n\n");
    }
  }
  return {
    async next(event: string): Promise<unknown> {
      for (;;) {
        const index = queue.findIndex((frame) => frame.event === event);
        if (index !== -1) {
          const [frame] = queue.splice(0, index + 1).slice(-1);
          if (frame?.id !== null && frame?.id !== undefined) last = frame.id;
          return frame?.data;
        }
        if (done) throw new Error(`The stream ended before a ${event} event.`);
        await fill();
      }
    },
    lastId: () => last,
    async ended(): Promise<boolean> {
      while (!done) await fill();
      return true;
    },
  };
}
