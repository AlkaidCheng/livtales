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
  commandStateResponseSchema,
  developmentSignInResponseSchema,
  eventResponseSchema,
  reminderResponseSchema,
  taskListResponseSchema,
  taskResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance, InjectOptions } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

// Both backends: the PostgreSQL app, and the app composed for the gateway
// with its reads served from the local database and the rpc functions
// called locally.
const transportWrite = () =>
  Promise.reject(new Error("Writes go through the rpc functions."));
const backends = {
  postgres: (database: TestDatabase) =>
    createDevelopmentAppDependencies(database.connection),
  cloudbase: (database: TestDatabase) =>
    createDevelopmentAppDependencies(disconnectedDatabase("the move test"), {
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
  await testDatabase.close();
});

describe.each(Object.entries(backends))(
  "moves in manual order (%s)",
  (_backend, dependencies) => {
    const request = (options: InjectOptions) => {
      if (app === undefined) throw new Error("The app is not built.");
      return app.inject(options);
    };
    async function signIn(email: string, displayName: string) {
      const response = await request({
        method: "POST",
        url: "/api/auth/development/sign-in",
        payload: { email, displayName },
      });
      const session = developmentSignInResponseSchema.parse(response.json());
      return {
        authorization: `Bearer ${session.accessToken}`,
        "x-workspace-id": session.workspace.id,
      };
    }
    async function createTask(
      headers: Record<string, string>,
      displayName: string,
    ) {
      const response = await request({
        method: "POST",
        url: "/api/tasks",
        headers,
        payload: { displayName },
      });
      expect(response.statusCode).toBe(201);
      return taskResponseSchema.parse(response.json());
    }
    async function manualOrder(headers: Record<string, string>) {
      const response = await request({
        method: "GET",
        url: "/api/tasks?sort=manual&limit=50",
        headers,
      });
      expect(response.statusCode).toBe(200);
      return taskListResponseSchema
        .parse(response.json())
        .items.map((task) => task.displayName);
    }
    async function patchTask(
      headers: Record<string, string>,
      id: string,
      payload: Record<string, unknown>,
    ) {
      const current = taskResponseSchema.parse(
        (
          await request({ method: "GET", url: `/api/tasks/${id}`, headers })
        ).json(),
      );
      return request({
        method: "PATCH",
        url: `/api/tasks/${id}`,
        headers,
        payload: { expectedVersion: current.version, ...payload },
      });
    }

    it("places a task next to the one it now follows or precedes, around moves made meanwhile", async () => {
      app = buildApp(dependencies(testDatabase));
      const headers = await signIn("owner@example.com", "Zoe Owner");
      const venue = await createTask(headers, "Book the venue");
      const flowers = await createTask(headers, "Order the flowers");
      const programme = await createTask(headers, "Print the programme");
      const notes = await createTask(headers, "Send thank-you notes");

      // Someone moves the notes after the venue.
      const first = await patchTask(headers, notes.id, { afterId: venue.id });
      expect(first.statusCode).toBe(200);
      expect(taskResponseSchema.parse(first.json()).rank).toBe("00000001500");

      // Another person, whose list still shows the venue then the flowers,
      // moves the programme after the venue: it lands between the venue
      // and the notes, which keep the place they were given.
      const second = await patchTask(headers, programme.id, {
        afterId: venue.id,
      });
      expect(second.statusCode).toBe(200);
      expect(await manualOrder(headers)).toEqual([
        "Book the venue",
        "Print the programme",
        "Send thank-you notes",
        "Order the flowers",
      ]);

      // Before the first task puts it at the top.
      const top = await patchTask(headers, flowers.id, { beforeId: venue.id });
      expect(top.statusCode).toBe(200);
      expect(await manualOrder(headers)).toEqual([
        "Order the flowers",
        "Book the venue",
        "Print the programme",
        "Send thank-you notes",
      ]);
    });

    it("places a task through a reversible command", async () => {
      app = buildApp(dependencies(testDatabase));
      const headers = await signIn("owner@example.com", "Zoe Owner");
      const venue = await createTask(headers, "Book the venue");
      await createTask(headers, "Order the flowers");
      const programme = await createTask(headers, "Print the programme");
      const state = commandStateResponseSchema.parse(
        (
          await request({ method: "GET", url: "/api/commands", headers })
        ).json(),
      );
      const executed = await request({
        method: "POST",
        url: "/api/commands",
        headers,
        payload: {
          operationId: randomUUID(),
          expectedStackVersion: state.version,
          edits: [
            {
              objectType: "task",
              objectId: programme.id,
              patch: { expectedVersion: programme.version, afterId: venue.id },
            },
          ],
        },
      });
      expect(executed.statusCode).toBe(200);
      expect(await manualOrder(headers)).toEqual([
        "Book the venue",
        "Print the programme",
        "Order the flowers",
      ]);
    });

    it("places a reminder next to another reminder", async () => {
      app = buildApp(dependencies(testDatabase));
      const headers = await signIn("owner@example.com", "Zoe Owner");
      const event = eventResponseSchema.parse(
        (
          await request({
            method: "POST",
            url: "/api/events",
            headers,
            payload: { displayName: "Garden evening" },
          })
        ).json(),
      );
      const createReminder = async (displayName: string) => {
        const response = await request({
          method: "POST",
          url: "/api/reminders",
          headers,
          payload: {
            displayName,
            permissionScopeId: event.id,
            remindAt: "2030-10-08T16:00:00Z",
          },
        });
        expect(response.statusCode).toBe(201);
        return reminderResponseSchema.parse(response.json());
      };
      const headcount = await createReminder("Final headcount");
      const caterer = await createReminder("Call the caterer");
      const moved = await request({
        method: "PATCH",
        url: `/api/reminders/${caterer.id}`,
        headers,
        payload: { expectedVersion: caterer.version, beforeId: headcount.id },
      });
      expect(moved.statusCode).toBe(200);
      expect(
        reminderResponseSchema.parse(moved.json()).rank < headcount.rank,
      ).toBe(true);
    });

    it("refuses a place given twice, next to itself, or next to a record it cannot use", async () => {
      app = buildApp(dependencies(testDatabase));
      const headers = await signIn("owner@example.com", "Zoe Owner");
      const venue = await createTask(headers, "Book the venue");
      const flowers = await createTask(headers, "Order the flowers");
      const both = await patchTask(headers, flowers.id, {
        afterId: venue.id,
        rank: "00000000500",
      });
      expect(both.statusCode).toBe(400);
      const itself = await patchTask(headers, flowers.id, {
        afterId: flowers.id,
      });
      expect(itself.statusCode).toBe(400);
      expect(itself.json().error.message).toBe(
        "afterId must name another task you can see.",
      );
      // A task of another space is out of reach, however it is named.
      const other = await signIn("other@example.com", "Omar Other");
      const elsewhere = await createTask(other, "Their task");
      const outside = await patchTask(headers, flowers.id, {
        beforeId: elsewhere.id,
      });
      expect(outside.statusCode).toBe(400);
      expect(outside.json().error.message).toBe(
        "beforeId must name another task you can see.",
      );
      // The refused moves changed nothing.
      expect(await manualOrder(headers)).toEqual([
        "Book the venue",
        "Order the flowers",
      ]);
    });
  },
);
