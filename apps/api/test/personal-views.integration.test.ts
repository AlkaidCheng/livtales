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
  eventLayoutResponseSchema,
  eventLayoutWithViewResponseSchema,
  eventResponseSchema,
  eventViewStateSchema,
  pageChoicesResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

// The routes run on both backends: the PostgreSQL app, and the app
// composed for the gateway with the rpc functions called locally and no
// database connection.
const transportWrite = () =>
  Promise.reject(new Error("Personal views write through the rpc functions."));
const backends = {
  postgres: (database: TestDatabase) =>
    createDevelopmentAppDependencies(database.connection),
  cloudbase: (database: TestDatabase) =>
    createDevelopmentAppDependencies(
      disconnectedDatabase("the personal views test"),
      {
        cloudBaseRdb: {
          ...createCloudBaseLiveReader(database.connection.db),
          rpc: createCloudBaseRpcDouble(database.connection.sql),
          insert: transportWrite,
          update: transportWrite,
          delete: transportWrite,
        },
        cloudBaseWrites: true,
      },
    ),
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

async function signIn(email: string, displayName: string): Promise<Session> {
  const response = await server().inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

function request(
  session: Session,
  options: Omit<InjectOptions, "headers">,
  workspaceId = session.workspace.id,
) {
  return server().inject({
    ...options,
    headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-workspace-id": workspaceId,
    },
  });
}

async function createEvent(session: Session) {
  const response = await request(session, {
    method: "POST",
    url: "/api/events",
    payload: { displayName: "Kyoto in November" },
  });
  expect(response.statusCode).toBe(201);
  const event = eventResponseSchema.parse(response.json());
  const [plan, notes, todos] = [randomUUID(), randomUUID(), randomUUID()];
  const saved = await request(session, {
    method: "PATCH",
    url: `/api/events/${event.id}/layout`,
    payload: {
      expectedVersion: 0,
      pages: [
        {
          id: plan,
          name: "Plan",
          components: [{ id: todos, kind: "todos", view: "board" }],
        },
        { id: notes, name: "Notes", components: [] },
      ],
    },
  });
  expect(saved.statusCode).toBe(200);
  return { id: event.id, plan, notes, todos };
}

async function share(session: Session, resourceId: string, email: string) {
  const response = await request(session, {
    method: "POST",
    url: "/api/shares",
    payload: { resourceId, principalEmail: email, role: "viewer" },
  });
  expect(response.statusCode).toBe(201);
}

async function yours(session: Session, eventId: string) {
  const response = await request(session, {
    method: "GET",
    url: `/api/events/${eventId}/layout?include=yours`,
  });
  expect(response.statusCode).toBe(200);
  return eventLayoutWithViewResponseSchema.parse(response.json()).yours;
}

describe.each(Object.entries(backends))(
  "Personal views (%s)",
  (_backend, compose) => {
    beforeEach(() => {
      app = buildApp(compose(testDatabase));
    });

    it("adds the account's view to the layout only when asked", async () => {
      const mei = await signIn("mei@example.com", "Mei Lin");
      const event = await createEvent(mei);
      const plain = await request(mei, {
        method: "GET",
        url: `/api/events/${event.id}/layout`,
      });
      expect(plain.statusCode).toBe(200);
      // Clients that validate the layout strictly still accept it.
      expect(eventLayoutResponseSchema.safeParse(plain.json()).success).toBe(
        true,
      );
      const withView = await request(mei, {
        method: "GET",
        url: `/api/events/${event.id}/layout?include=yours`,
      });
      expect(withView.statusCode).toBe(200);
      const parsed = eventLayoutWithViewResponseSchema.parse(withView.json());
      expect(parsed).toMatchObject({ eventId: event.id, version: 1 });
      expect(parsed.yours).toEqual({
        stored: false,
        place: null,
        tabs: {},
        pages: [event.plan, event.notes],
        layouts: { [event.todos]: "board" },
        choices: {},
      });
      expect(
        (
          await request(mei, {
            method: "GET",
            url: `/api/events/${event.id}/layout?include=everything`,
          })
        ).statusCode,
      ).toBe(400);
    });

    it("saves the account's view and answers with it", async () => {
      const mei = await signIn("mei@example.com", "Mei Lin");
      const event = await createEvent(mei);
      const saved = await request(mei, {
        method: "PATCH",
        url: `/api/events/${event.id}/view`,
        payload: {
          place: { page: event.notes },
          tabs: { order: ["overview", "todos"], hidden: ["sharing"] },
          pages: [event.notes, event.plan],
          layouts: { [event.todos]: "list" },
          choices: { todos: { sort: "due" }, [event.todos]: { show: "all" } },
        },
      });
      expect(saved.statusCode).toBe(200);
      const view = eventViewStateSchema.parse(saved.json());
      expect(view).toEqual({
        stored: true,
        place: { page: event.notes },
        tabs: { order: ["overview", "todos"], hidden: ["sharing"] },
        pages: [event.notes, event.plan],
        layouts: { [event.todos]: "list" },
        choices: { todos: { sort: "due" }, [event.todos]: { show: "all" } },
      });
      expect(await yours(mei, event.id)).toEqual(view);

      const cleared = await request(mei, {
        method: "PATCH",
        url: `/api/events/${event.id}/view`,
        payload: { choices: { todos: null, [event.todos]: {} } },
      });
      expect(eventViewStateSchema.parse(cleared.json()).choices).toEqual({});

      for (const payload of [
        { stored: true },
        { place: { view: "todos", page: event.plan } },
        { choices: { todos: { nested: { deeper: { value: 1 } } } } },
        { pages: ["plan"] },
      ])
        expect(
          (
            await request(mei, {
              method: "PATCH",
              url: `/api/events/${event.id}/view`,
              payload,
            })
          ).statusCode,
          JSON.stringify(payload),
        ).toBe(400);
    });

    it("keeps each account's own view of a shared event and refuses anyone who cannot read it", async () => {
      const mei = await signIn("mei@example.com", "Mei Lin");
      const kai = await signIn("kai@example.com", "Kai Tanaka");
      const ana = await signIn("ana@example.com", "Ana Souza");
      const event = await createEvent(mei);
      await share(mei, event.id, "kai@example.com");
      await request(mei, {
        method: "PATCH",
        url: `/api/events/${event.id}/view`,
        payload: { place: { view: "calendar" } },
      });
      // Kai opens the shared event from his own workspace: the request
      // follows the event's.
      const kaiSaved = await request(kai, {
        method: "PATCH",
        url: `/api/events/${event.id}/view`,
        payload: { place: { page: event.plan }, tabs: { hidden: ["files"] } },
      });
      expect(kaiSaved.statusCode).toBe(200);
      expect(await yours(kai, event.id)).toMatchObject({
        stored: true,
        place: { page: event.plan },
        tabs: { hidden: ["files"] },
      });
      expect(await yours(mei, event.id)).toMatchObject({
        place: { view: "calendar" },
        tabs: {},
      });

      for (const workspaceId of [ana.workspace.id, mei.workspace.id]) {
        for (const options of [
          {
            method: "GET" as const,
            url: `/api/events/${event.id}/layout?include=yours`,
          },
          {
            method: "PATCH" as const,
            url: `/api/events/${event.id}/view`,
            payload: { place: { view: "todos" } },
          },
        ]) {
          const refused = await request(ana, options, workspaceId);
          expect(refused.statusCode).toBe(404);
        }
      }
      expect(
        (
          await server().inject({
            method: "GET",
            url: `/api/events/${event.id}/layout?include=yours`,
          })
        ).statusCode,
      ).toBe(401);
      expect(
        (
          await server().inject({
            method: "PATCH",
            url: `/api/events/${event.id}/view`,
            payload: { place: { view: "todos" } },
          })
        ).statusCode,
      ).toBe(401);

      const task = await request(mei, {
        method: "POST",
        url: "/api/tasks",
        payload: { displayName: "Book the ryokan" },
      });
      expect(task.statusCode).toBe(201);
      expect(
        (
          await request(mei, {
            method: "PATCH",
            url: `/api/events/${task.json().id}/view`,
            payload: { place: { view: "todos" } },
          })
        ).statusCode,
      ).toBe(400);
    });

    it("merges each account's choices for a collection page", async () => {
      const mei = await signIn("mei@example.com", "Mei Lin");
      const kai = await signIn("kai@example.com", "Kai Tanaka");
      const read = async (session: Session, page: string) => {
        const response = await request(session, {
          method: "GET",
          url: `/api/account/pages/${page}`,
        });
        expect(response.statusCode).toBe(200);
        return pageChoicesResponseSchema.parse(response.json());
      };
      const change = (session: Session, page: string, payload: object) =>
        request(session, {
          method: "PATCH",
          url: `/api/account/pages/${page}`,
          payload,
        });
      expect(await read(mei, "events")).toEqual({
        page: "events",
        choices: {},
      });
      const first = await change(mei, "events", {
        choices: { layout: "list", sort: "start" },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({
        page: "events",
        choices: { layout: "list", sort: "start" },
      });
      expect(
        (
          await change(mei, "events", { choices: { sort: null, limit: 20 } })
        ).json().choices,
      ).toEqual({ layout: "list", limit: 20 });
      expect(await read(mei, "events")).toEqual({
        page: "events",
        choices: { layout: "list", limit: 20 },
      });
      expect(await read(mei, "people")).toEqual({
        page: "people",
        choices: {},
      });
      expect(await read(kai, "events")).toEqual({
        page: "events",
        choices: {},
      });

      const tooMany = Object.fromEntries(
        Array.from({ length: 39 }, (_, index) => [`c${index}`, true]),
      );
      const refused = await change(mei, "events", { choices: tooMany });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.code).toBe("invalid_request");
      for (const [page, payload] of [
        ["calendar", { choices: { layout: "list" } }],
        ["events", { page: "events", choices: {} }],
        ["events", { choices: { layout: { a: { b: 1 } } } }],
      ] as const)
        expect(
          (await change(mei, page, payload)).statusCode,
          JSON.stringify(payload),
        ).toBe(400);
      expect(
        (
          await server().inject({
            method: "GET",
            url: "/api/account/pages/events",
          })
        ).statusCode,
      ).toBe(401);

      expect(
        (
          await change(mei, "events", {
            choices: { layout: null, limit: null },
          })
        ).json(),
      ).toEqual({ page: "events", choices: {} });
    });
  },
);
