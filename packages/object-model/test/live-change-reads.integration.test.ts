import {
  createId,
  documents,
  objectRelations,
  objects,
  resourceGrants,
  users,
} from "@livtales/db";
import { createCloudBaseLiveReader } from "@livtales/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseLiveChangeReadRepository } from "../src/cloudbase-live-change-read-repository.js";
import { EventContextService } from "../src/event-context-service.js";
import {
  type LiveChangeReadRepository,
  PostgresLiveChangeReadRepository,
} from "../src/live-change-reads.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { PostgresSectionRepository, SectionService } from "../src/sections.js";
import {
  createWriteHarness,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// The reads that announce confirmed changes return the same on both
// backends: an account's sight of a workspace, changed states with their
// tombstones and subtasks, and the Events whose pages show each object.

let harness: WriteHarness;
let guestId: string;
let repositories: readonly (readonly [string, LiveChangeReadRepository])[];
let plan: {
  readonly event: string;
  readonly otherEvent: string;
  readonly section: string;
  readonly sectioned: string;
  readonly subtask: string;
  readonly loose: string;
  readonly trashed: string;
  readonly document: string;
};

beforeAll(async () => {
  harness = await createWriteHarness("Live change reads");
  const db = harness.database.connection.db;
  const { workspaceId, ownerId } = harness;
  guestId = createId();
  await db.insert(users).values({
    id: guestId,
    identityProvider: "test",
    providerSubject: guestId,
    displayName: "Guest",
  });
  const service = new EventPlanningObjectService(db);
  const included = new EventContextService(db);
  const context = () => mutationContext(harness);
  const event = await service.createEvent(context(), { displayName: "Kyoto" });
  const otherEvent = await service.createEvent(context(), {
    displayName: "Osaka",
  });
  const owner = { type: "user" as const, userId: ownerId, workspaceId };
  const sections = new SectionService(
    new PostgresSectionRepository(db),
    new PostgresSectionRepository(db),
  );
  const venue = await sections.createSection(owner, event.id, {
    view: "todos",
    name: "Venue",
  });
  const create = async (eventId: string, displayName: string, extra = {}) =>
    (
      await included.create(context(), eventId, {
        commandId: createId(),
        resource: { objectType: "task", displayName, ...extra },
      })
    ).resource.id;
  const sectioned = await create(event.id, "Book the hall", {
    sectionId: venue.id,
  });
  const subtask = await create(event.id, "Call the hall", {
    parentTaskId: sectioned,
  });
  const loose = await create(event.id, "Order the cake");
  await sections.createSection(owner, otherEvent.id, {
    view: "todos",
    name: "Unused",
  });
  await db.insert(objectRelations).values({
    id: createId(),
    workspaceId,
    sourceObjectId: otherEvent.id,
    targetObjectId: loose,
    relationType: "includes",
    createdBy: ownerId,
  });
  const trashed = await create(event.id, "Old idea");
  const trashedState = await service.getTask(owner, trashed);
  await service.softDelete(context(), trashed, trashedState.version);

  const document = createId();
  await db.insert(objects).values({
    id: document,
    workspaceId,
    objectType: "document",
    permissionScopeId: event.id,
    displayName: "Floor plan",
    createdBy: ownerId,
  });
  await db.insert(documents).values({
    objectId: document,
    workspaceId,
    storageProvider: "local",
    storageKey: document,
    originalFilename: "plan.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1n,
    checksumSha256: "0".repeat(64),
    encryptionMode: "none",
  });
  await db.insert(objectRelations).values({
    id: createId(),
    workspaceId,
    sourceObjectId: document,
    targetObjectId: sectioned,
    relationType: "attached_to",
    createdBy: ownerId,
  });

  await db.insert(resourceGrants).values([
    {
      id: createId(),
      workspaceId,
      resourceId: event.id,
      principalType: "user",
      principalId: guestId,
      role: "viewer",
      grantedBy: ownerId,
      scope: "todos",
      sectionId: venue.id,
    },
    {
      id: createId(),
      workspaceId,
      resourceId: otherEvent.id,
      principalType: "user",
      principalId: guestId,
      role: "editor",
      grantedBy: ownerId,
      expiresAt: new Date("2029-01-01T00:00:00.000Z"),
    },
  ]);
  plan = {
    event: event.id,
    otherEvent: otherEvent.id,
    section: venue.id,
    sectioned,
    subtask,
    loose,
    trashed,
    document,
  };
  repositories = [
    ["postgres", new PostgresLiveChangeReadRepository(db)],
    [
      "cloudbase",
      new CloudBaseLiveChangeReadRepository(createCloudBaseLiveReader(db)),
    ],
  ];
});

afterAll(async () => {
  await harness?.database.close();
});

const now = new Date("2030-01-01T00:00:00.000Z");

describe("live change reads", () => {
  it("reads membership, else the grants active at the instant", async () => {
    for (const [name, reads] of repositories) {
      expect(
        await reads.readSight(harness.ownerId, harness.workspaceId, now),
        name,
      ).toEqual({ member: true, grants: [] });
      expect(
        await reads.readSight(guestId, harness.workspaceId, now),
        name,
      ).toEqual({
        member: false,
        grants: [
          {
            resourceId: plan.event,
            scope: "todos",
            sectionId: plan.section,
            expiresAt: null,
          },
        ],
      });
    }
  });

  it("reads current states with tombstones, and subtasks when asked", async () => {
    for (const [name, reads] of repositories) {
      const states = await reads.readStates(
        harness.workspaceId,
        [plan.sectioned, plan.trashed, createId()],
        { subtasks: true },
      );
      const byId = new Map(states.map((state) => [state.id, state]));
      expect([...byId.keys()].sort(), name).toEqual(
        [plan.sectioned, plan.subtask, plan.trashed].sort(),
      );
      expect(byId.get(plan.trashed)?.deletedAt, name).toBeInstanceOf(Date);
      expect(byId.get(plan.sectioned), name).toMatchObject({
        objectType: "task",
        sectionId: plan.section,
        permissionScopeId: plan.event,
      });
      expect(
        (await reads.readStates(harness.workspaceId, [plan.sectioned])).map(
          ({ id }) => id,
        ),
        name,
      ).toEqual([plan.sectioned]);
    }
  });

  it("reads the Events whose pages show each object", async () => {
    const expected = {
      [plan.sectioned]: [plan.event],
      [plan.loose]: [plan.event, plan.otherEvent].sort(),
      [plan.document]: [plan.event, plan.sectioned].sort(),
    };
    for (const [name, reads] of repositories) {
      const shownOn = await reads.readShownOn(harness.workspaceId, [
        { id: plan.sectioned, objectType: "task" },
        { id: plan.loose, objectType: "task" },
        { id: plan.document, objectType: "document" },
        { id: plan.otherEvent, objectType: "event" },
      ]);
      expect(
        Object.fromEntries(
          [...shownOn].map(([id, events]) => [id, [...events].sort()]),
        ),
        name,
      ).toEqual(expected);
    }
  });
});
