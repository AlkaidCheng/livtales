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
  apiErrorResponseSchema,
  commandReceiptSchema,
  commandStateResponseSchema,
  developmentSignInResponseSchema,
  eventResponseSchema,
  sectionResponseSchema,
  taskResponseSchema,
  type CommandExecutePayload,
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
    createDevelopmentAppDependencies(disconnectedDatabase("the undo test"), {
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

type Headers = Record<string, string>;
type Edit = CommandExecutePayload["edits"][number];

describe.each(Object.entries(backends))(
  "undo and redo steps (%s)",
  (_backend, dependencies) => {
    const request = (options: InjectOptions) => {
      if (app === undefined) throw new Error("The app is not built.");
      return app.inject(options);
    };
    async function signIn() {
      app = buildApp(dependencies(testDatabase));
      const response = await request({
        method: "POST",
        url: "/api/auth/development/sign-in",
        payload: { email: "owner@example.com", displayName: "Zoe Owner" },
      });
      const session = developmentSignInResponseSchema.parse(response.json());
      return {
        authorization: `Bearer ${session.accessToken}`,
        "x-workspace-id": session.workspace.id,
      };
    }
    async function createTask(
      headers: Headers,
      displayName: string,
      fields: Record<string, unknown> = {},
    ) {
      const response = await request({
        method: "POST",
        url: "/api/tasks",
        headers,
        payload: { displayName, ...fields },
      });
      expect(response.statusCode, response.body).toBe(201);
      return taskResponseSchema.parse(response.json());
    }
    async function getTask(headers: Headers, id: string) {
      const response = await request({
        method: "GET",
        url: `/api/tasks/${id}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      return taskResponseSchema.parse(response.json());
    }
    async function state(headers: Headers) {
      const response = await request({
        method: "GET",
        url: "/api/commands",
        headers,
      });
      expect(response.statusCode).toBe(200);
      return commandStateResponseSchema.parse(response.json());
    }
    async function execute(headers: Headers, edit: Edit) {
      const response = await request({
        method: "POST",
        url: "/api/commands",
        headers,
        payload: {
          operationId: randomUUID(),
          expectedStackVersion: (await state(headers)).version,
          edits: [edit],
        },
      });
      expect(response.statusCode, response.body).toBe(200);
      return commandReceiptSchema.parse(response.json());
    }
    /** Runs the head of the undo or redo list and answers the response. */
    async function step(headers: Headers, direction: "undo" | "redo") {
      const stack = await state(headers);
      const head = stack[direction];
      if (head === null) throw new Error(`Nothing to ${direction}.`);
      return request({
        method: "POST",
        url: `/api/commands/${direction}`,
        headers,
        payload: {
          operationId: randomUUID(),
          commandId: head.commandId,
          expectedStackVersion: stack.version,
        },
      });
    }
    const rename = (
      task: { id: string },
      expectedVersion: number,
      displayName: string,
    ): Edit => ({
      objectType: "task",
      objectId: task.id,
      patch: { expectedVersion, displayName },
    });
    async function patchTask(
      headers: Headers,
      id: string,
      payload: Record<string, unknown>,
    ) {
      const current = await getTask(headers, id);
      const response = await request({
        method: "PATCH",
        url: `/api/tasks/${id}`,
        headers,
        payload: { expectedVersion: current.version, ...payload },
      });
      expect(response.statusCode, response.body).toBe(200);
    }

    it("refuses an undo across a later change, naming the object, and reaches the step before on the next undo", async () => {
      const headers = await signIn();
      const flowers = await createTask(headers, "Order the flowers");
      const venue = await createTask(headers, "Book the venue");
      const first = await execute(headers, rename(flowers, 1, "Order roses"));
      const second = await execute(headers, rename(venue, 1, "Book the hall"));
      await patchTask(headers, venue.id, { location: "Town hall" });
      const before = await state(headers);
      expect(before.undo).toEqual({
        commandId: second.commandId,
        available: false,
      });

      const refused = await step(headers, "undo");
      expect(refused.statusCode).toBe(409);
      expect(apiErrorResponseSchema.parse(refused.json()).error).toEqual({
        code: "version_conflict",
        message: "The object changed after the supplied version was read.",
        objectId: venue.id,
      });
      // The later change stands, and the refused step left the stack.
      expect(await getTask(headers, venue.id)).toMatchObject({
        version: 3,
        displayName: "Book the hall",
        location: "Town hall",
      });
      expect(await state(headers)).toEqual({
        version: before.version + 1,
        undo: { commandId: first.commandId, available: true },
        redo: null,
      });

      const undone = await step(headers, "undo");
      expect(undone.statusCode, undone.body).toBe(200);
      expect(await getTask(headers, flowers.id)).toMatchObject({
        displayName: "Order the flowers",
      });
    });

    it("takes every step of the changed object off the stack, redo included, and nothing else", async () => {
      const headers = await signIn();
      const venue = await createTask(headers, "Book the venue");
      const flowers = await createTask(headers, "Order the flowers");
      await execute(headers, rename(venue, 1, "Book the hall"));
      const flowersEdit = await execute(
        headers,
        rename(flowers, 1, "Order roses"),
      );
      await execute(headers, {
        objectType: "task",
        objectId: venue.id,
        patch: { expectedVersion: 2, dueOn: "2030-10-01" },
      });
      expect((await step(headers, "undo")).statusCode).toBe(200);
      await patchTask(headers, venue.id, { location: "Town hall" });
      // The stale redo of the venue is hidden; the flowers step still runs.
      expect((await step(headers, "undo")).statusCode).toBe(200);

      const refused = await step(headers, "undo");
      expect(refused.statusCode).toBe(409);
      expect(apiErrorResponseSchema.parse(refused.json()).error.objectId).toBe(
        venue.id,
      );
      const after = await state(headers);
      expect(after.undo).toBeNull();
      expect(after.redo).toEqual({
        commandId: flowersEdit.commandId,
        available: true,
      });
      const [stack] = await testDatabase.connection.sql`
        SELECT undo_ids, redo_ids, expected_versions FROM command_stacks
      `;
      expect(stack?.undo_ids).toEqual([]);
      expect(stack?.redo_ids).toEqual([flowersEdit.commandId]);
      expect(Object.keys(stack?.expected_versions ?? {})).toEqual([flowers.id]);
      // A refusal writes no receipt: three edits and two steps ran.
      expect(
        await testDatabase.connection.sql`SELECT 1 FROM command_receipts`,
      ).toHaveLength(5);
      expect((await step(headers, "redo")).statusCode).toBe(200);
      expect(await getTask(headers, flowers.id)).toMatchObject({
        displayName: "Order roses",
      });
    });

    async function eventWithSections(headers: Headers) {
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
      const section = async (name: string) => {
        const response = await request({
          method: "POST",
          url: `/api/events/${event.id}/sections`,
          headers,
          payload: { view: "todos", name },
        });
        expect(response.statusCode, response.body).toBe(201);
        return sectionResponseSchema.parse(response.json());
      };
      return {
        event,
        before: await section("Before"),
        day: await section("On the day"),
      };
    }

    it("puts a moved task back in its place and section on undo, and moves it again on redo", async () => {
      const headers = await signIn();
      const { event, before, day } = await eventWithSections(headers);
      const inEvent = { permissionScopeId: event.id, sectionId: before.id };
      const chairs = await createTask(headers, "Rent the chairs", inEvent);
      const lights = await createTask(headers, "Hang the lights", inEvent);
      await execute(headers, {
        objectType: "task",
        objectId: chairs.id,
        patch: {
          expectedVersion: 1,
          displayName: "Rent the benches",
          afterId: lights.id,
          sectionId: day.id,
        },
      });
      const placed = await getTask(headers, chairs.id);
      expect(placed.rank > lights.rank).toBe(true);
      expect(placed.sectionId).toBe(day.id);

      expect((await step(headers, "undo")).statusCode).toBe(200);
      expect(await getTask(headers, chairs.id)).toMatchObject({
        version: 3,
        displayName: "Rent the chairs",
        rank: chairs.rank,
        sectionId: before.id,
      });
      expect((await step(headers, "redo")).statusCode).toBe(200);
      expect(await getTask(headers, chairs.id)).toMatchObject({
        version: 4,
        displayName: "Rent the benches",
        rank: placed.rank,
        sectionId: day.id,
      });

      // Restoring a revision from History brings back its content, never
      // its place.
      const restored = await request({
        method: "POST",
        url: `/api/objects/${chairs.id}/revisions/1/restore`,
        headers,
        payload: { expectedVersion: 4 },
      });
      expect(restored.statusCode, restored.body).toBe(200);
      expect(await getTask(headers, chairs.id)).toMatchObject({
        version: 5,
        displayName: "Rent the chairs",
        rank: placed.rank,
        sectionId: day.id,
      });
    });

    it("leaves an undone task outside any section when its section was deleted since", async () => {
      const headers = await signIn();
      const { event, before, day } = await eventWithSections(headers);
      const chairs = await createTask(headers, "Rent the chairs", {
        permissionScopeId: event.id,
        sectionId: before.id,
      });
      await execute(headers, {
        objectType: "task",
        objectId: chairs.id,
        patch: { expectedVersion: 1, sectionId: day.id },
      });
      const deleted = await request({
        method: "DELETE",
        url: `/api/sections/${before.id}`,
        headers,
      });
      expect(deleted.statusCode, deleted.body).toBeLessThan(300);

      expect((await step(headers, "undo")).statusCode).toBe(200);
      expect(await getTask(headers, chairs.id)).toMatchObject({
        version: 3,
        rank: chairs.rank,
        sectionId: null,
      });
    });
  },
);
