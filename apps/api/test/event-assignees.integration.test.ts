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
  assigneeProjectionResponseSchema,
  developmentSignInResponseSchema,
  eventResponseSchema,
  personResponseSchema,
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
    createDevelopmentAppDependencies(
      disconnectedDatabase("the assignee test"),
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
  await testDatabase.close();
});

describe.each(Object.entries(backends))(
  "assignee names on an Event (%s)",
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

    it("names the assignees of the tasks a guest sees, never more of the person", async () => {
      app = buildApp(dependencies(testDatabase));
      const jane = await signIn("jane@example.com", "Jane");
      const guest = await signIn("guest@example.com", "Guest");
      const stranger = await signIn("stranger@example.com", "Stranger");
      const narrowed = await signIn("narrowed@example.com", "Narrowed");
      const event = eventResponseSchema.parse(
        (
          await request({
            method: "POST",
            url: "/api/events",
            headers: jane,
            payload: { displayName: "Wedding countdown" },
          })
        ).json(),
      );
      // Mei is a card of Jane's space, scoped to herself; Leo has a
      // nickname, which the name carries too.
      const person = async (payload: object) =>
        personResponseSchema.parse(
          (
            await request({
              method: "POST",
              url: "/api/persons",
              headers: jane,
              payload,
            })
          ).json(),
        );
      const mei = await person({ displayName: "Mei" });
      const leo = await person({ displayName: "Leonard", nickname: "Leo" });
      for (const [displayName, assigneeId] of [
        ["Book the hall", mei.id],
        ["Call the band", leo.id],
        ["Pack the rings", mei.id],
        ["Rest", null],
      ] as const) {
        const created = await request({
          method: "POST",
          url: `/api/events/${event.id}/resources`,
          headers: jane,
          payload: {
            commandId: randomUUID(),
            resource: { objectType: "task", displayName, assigneeId },
          },
        });
        expect(created.statusCode, created.body).toBe(201);
      }
      for (const [principalEmail, scope] of [
        ["guest@example.com", undefined],
        ["narrowed@example.com", { view: "calendar" }],
      ] as const) {
        const shared = await request({
          method: "POST",
          url: "/api/shares",
          headers: jane,
          payload: {
            resourceId: event.id,
            principalEmail,
            role: "editor",
            scope,
          },
        });
        expect(shared.statusCode, shared.body).toBe(201);
      }
      const assignees = (headers: Record<string, string>) =>
        request({
          method: "GET",
          url: `/api/events/${event.id}/assignees`,
          headers,
        });

      // The owner and a guest of the whole Event read each assignee once,
      // by name, from their own space.
      for (const viewer of [jane, guest]) {
        const response = await assignees(viewer);
        expect(response.statusCode, response.body).toBe(200);
        expect(assigneeProjectionResponseSchema.parse(response.json())).toEqual(
          {
            sourceEventId: event.id,
            items: [
              { id: leo.id, displayName: "Leonard", nickname: "Leo" },
              { id: mei.id, displayName: "Mei", nickname: null },
            ],
          },
        );
      }
      // The guest still may not open Mei's card.
      const card = await request({
        method: "GET",
        url: `/api/persons/${mei.id}`,
        headers: guest,
      });
      expect(card.statusCode).toBe(404);
      // A share of the Calendar alone sees no tasks, so it names no one;
      // a stranger may not read the Event at all.
      const calendarOnly = await assignees(narrowed);
      expect(calendarOnly.statusCode, calendarOnly.body).toBe(200);
      expect(
        assigneeProjectionResponseSchema.parse(calendarOnly.json()).items,
      ).toEqual([]);
      expect((await assignees(stranger)).statusCode).toBe(404);
    });
  },
);
