import type { GrantReach } from "@livtales/authorization";
import {
  objectRelations,
  objects,
  resourceGrants,
  tasks,
  workspaceMembers,
  type Database,
  type GrantScope,
} from "@livtales/db";
import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";

import { readObjectStates } from "./object-state.js";
import type { EventPlanningResource } from "./types.js";

/** An active grant of an account, with the instant it ends, if it does. */
export interface SightGrant extends GrantReach {
  readonly expiresAt: Date | null;
}

/**
 * What one account may see of one workspace: all of it as a member, or
 * what its active grants there reach.
 */
export interface WorkspaceSight {
  readonly member: boolean;
  readonly grants: readonly SightGrant[];
}

/** The type of a changed object, which decides where its Events are found. */
export interface ShownObject {
  readonly id: string;
  readonly objectType: EventPlanningResource["objectType"];
}

/** The most objects one change reads, subtasks included. */
export const maximumChangedObjects = 1000;

/**
 * Reads for announcing confirmed changes: what an account may see of a
 * workspace, the current states of changed objects, and the Events whose
 * pages show them. The reads are not authorized for an account; each
 * viewer's sight is applied to what they return.
 */
export interface LiveChangeReadRepository {
  /** The account's membership, else its grants active at `now`. */
  readSight(
    userId: string,
    workspaceId: string,
    now: Date,
  ): Promise<WorkspaceSight>;
  /**
   * The current states of the objects, trashed ones included, with the
   * subtasks of any tasks among them when asked; unknown ids are omitted.
   */
  readStates(
    workspaceId: string,
    objectIds: readonly string[],
    options?: { readonly subtasks?: boolean | undefined },
  ): Promise<EventPlanningResource[]>;
  /**
   * By object id, the Events whose pages show each object: those including
   * it, and for a document, what it is attached to and the Events
   * including that.
   */
  readShownOn(
    workspaceId: string,
    shown: readonly ShownObject[],
  ): Promise<ReadonlyMap<string, readonly string[]>>;
}

/** Collects `source` under `key`, keeping each source once. */
export function collectShownOn(
  shownOn: Map<string, string[]>,
  key: string,
  source: string,
): void {
  const sources = shownOn.get(key);
  if (sources === undefined) shownOn.set(key, [source]);
  else if (!sources.includes(source)) sources.push(source);
}

/**
 * The Events showing each object, from the live inclusions of the objects
 * and of what the documents among them are attached to.
 */
export function shownOnFrom(
  shown: readonly ShownObject[],
  attachments: readonly {
    readonly document: string;
    readonly target: string;
  }[],
  inclusions: readonly { readonly event: string; readonly target: string }[],
): ReadonlyMap<string, readonly string[]> {
  const includers = new Map<string, string[]>();
  for (const { event, target } of inclusions)
    collectShownOn(includers, target, event);
  const shownOn = new Map<string, string[]>();
  for (const { id } of shown)
    for (const event of includers.get(id) ?? [])
      collectShownOn(shownOn, id, event);
  for (const { document, target } of attachments) {
    collectShownOn(shownOn, document, target);
    for (const event of includers.get(target) ?? [])
      collectShownOn(shownOn, document, event);
  }
  return shownOn;
}

export class PostgresLiveChangeReadRepository implements LiveChangeReadRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async readSight(
    userId: string,
    workspaceId: string,
    now: Date,
  ): Promise<WorkspaceSight> {
    const [membership] = await this.#database
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (membership !== undefined) return { member: true, grants: [] };
    const grants = await this.#database
      .select({
        resourceId: resourceGrants.resourceId,
        scope: resourceGrants.scope,
        sectionId: resourceGrants.sectionId,
        expiresAt: resourceGrants.expiresAt,
      })
      .from(resourceGrants)
      .where(
        and(
          eq(resourceGrants.workspaceId, workspaceId),
          eq(resourceGrants.principalType, "user"),
          eq(resourceGrants.principalId, userId),
          or(
            isNull(resourceGrants.expiresAt),
            gt(resourceGrants.expiresAt, now),
          ),
        ),
      );
    return {
      member: false,
      grants: grants.map((grant) => ({
        ...grant,
        scope: grant.scope as GrantScope,
      })),
    };
  }

  async readStates(
    workspaceId: string,
    objectIds: readonly string[],
    options: { readonly subtasks?: boolean | undefined } = {},
  ): Promise<EventPlanningResource[]> {
    const ids = [...new Set(objectIds)];
    if (ids.length === 0) return [];
    const named = inArray(objects.id, ids);
    return readObjectStates(
      this.#database,
      and(
        eq(objects.workspaceId, workspaceId),
        options.subtasks === true
          ? or(
              named,
              inArray(
                objects.id,
                this.#database
                  .select({ id: tasks.objectId })
                  .from(tasks)
                  .where(
                    and(
                      eq(tasks.workspaceId, workspaceId),
                      inArray(tasks.parentTaskId, ids),
                    ),
                  ),
              ),
            )
          : named,
      ),
      maximumChangedObjects,
    );
  }

  async readShownOn(
    workspaceId: string,
    shown: readonly ShownObject[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (shown.length === 0) return new Map();
    const documents = shown
      .filter(({ objectType }) => objectType === "document")
      .map(({ id }) => id);
    const attachments =
      documents.length === 0
        ? []
        : await this.#database
            .select({
              document: objectRelations.sourceObjectId,
              target: objectRelations.targetObjectId,
            })
            .from(objectRelations)
            .where(
              and(
                eq(objectRelations.workspaceId, workspaceId),
                eq(objectRelations.relationType, "attached_to"),
                isNull(objectRelations.deletedAt),
                inArray(objectRelations.sourceObjectId, documents),
              ),
            );
    const targets = [
      ...new Set([
        ...shown.map(({ id }) => id),
        ...attachments.map(({ target }) => target),
      ]),
    ];
    const inclusions = await this.#database
      .select({
        event: objectRelations.sourceObjectId,
        target: objectRelations.targetObjectId,
      })
      .from(objectRelations)
      .where(
        and(
          eq(objectRelations.workspaceId, workspaceId),
          eq(objectRelations.relationType, "includes"),
          isNull(objectRelations.deletedAt),
          inArray(objectRelations.targetObjectId, targets),
        ),
      );
    return shownOnFrom(shown, attachments, inclusions);
  }
}
