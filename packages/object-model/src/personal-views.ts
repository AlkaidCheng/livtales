import {
  AuthorizationDeniedError,
  AuthorizationService,
  DrizzleAuthorizationStore,
  type UserPrincipal,
  withReadAuthorization,
} from "@livtales/authorization";
import {
  type Database,
  type DatabaseTransaction,
  objects,
  userComponentChoices,
  userEventViews,
  userPageChoices,
} from "@livtales/db";
import {
  type AccountPage,
  type EventLayoutWithViewResponse,
  type EventViewState,
  type EventViewStateUpdate,
  type PageChoicesUpdate,
  type ViewChoices,
  eventViewStateUpdateSchema,
  pageChoicesUpdateSchema,
  viewChoicesByteLimit,
} from "@livtales/schemas";
import { type SQL, and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

import { InvalidObjectStateError } from "./errors.js";
import type { EventLayoutReadRepository } from "./event-layout-reads.js";
import {
  type EventViewWrite,
  type StoredEventView,
  type ViewFieldWrite,
  componentChoicesLimit,
  eventViewLimit,
  normalizeEventView,
  pageChoicesFrom,
  planEventViewSave,
  storedEventViewFrom,
} from "./personal-view-state.js";

export interface PersonalViewReadRepository {
  /** The account's stored view of an Event it may view; null before its first save. */
  readEventView(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<StoredEventView | null>;
  /** The choices the account left a collection page with; {} when none. */
  readPageChoices(userId: string, page: AccountPage): Promise<ViewChoices>;
}

export interface PersonalViewWriteRepository {
  /**
   * Applies a planned save to the account's view of an Event it may view
   * in one transaction, keeps the account within its limits, and returns
   * the stored view.
   */
  writeEventView(
    principal: UserPrincipal,
    eventId: string,
    write: EventViewWrite,
  ): Promise<StoredEventView>;
  /** Merges a change into a collection page's choices by name and returns them. */
  updatePageChoices(
    userId: string,
    page: AccountPage,
    changes: PageChoicesUpdate["choices"],
  ): Promise<ViewChoices>;
}

/**
 * Why a merge of a page's choices is refused: the merged choices keep up
 * to 40 names in 16 KB, measured as PostgreSQL writes them.
 */
const pageChoicesMessage = "A page keeps up to 40 choices in up to 16 KB.";

/** A component's choices are keyed by its id; a tab's never are. */
const idPattern =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

const json = (value: unknown): SQL => sql`${JSON.stringify(value)}::jsonb`;

const textArray = (values: readonly string[]): SQL =>
  sql`ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;

/** A field's new value; with `ifUnchanged`, written only while the field still holds that. */
function fieldWrite<Value>(
  column: AnyPgColumn,
  write: ViewFieldWrite<Value>,
): SQL {
  return write.ifUnchanged === undefined
    ? json(write.value)
    : sql`CASE WHEN ${column} = ${json(write.ifUnchanged)} THEN ${json(write.value)} ELSE ${column} END`;
}

async function readStoredView(
  transaction: DatabaseTransaction,
  userId: string,
  eventId: string,
): Promise<StoredEventView | null> {
  const [view] = await transaction
    .select()
    .from(userEventViews)
    .where(
      and(
        eq(userEventViews.userId, userId),
        eq(userEventViews.eventId, eventId),
      ),
    )
    .limit(1);
  if (view === undefined) return null;
  const choices = await transaction
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
    );
  return storedEventViewFrom({
    ...view,
    choices: Object.fromEntries(
      choices.map((row) => [row.component, row.choices]),
    ),
  });
}

/**
 * Personal views in PostgreSQL. A view is the account's own state, so a
 * save checks view access inside its transaction without the workspace
 * fence that changes to shared records take, as the rpc functions do.
 */
export class PostgresPersonalViewRepository
  implements PersonalViewReadRepository, PersonalViewWriteRepository
{
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  readEventView(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<StoredEventView | null> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "view", {
          id: eventId,
          workspaceId: principal.workspaceId,
        });
        return readStoredView(transaction, principal.userId, eventId);
      },
    );
  }

  writeEventView(
    principal: UserPrincipal,
    eventId: string,
    write: EventViewWrite,
  ): Promise<StoredEventView> {
    const { userId } = principal;
    return this.#database.transaction(async (transaction) => {
      const authorization = new AuthorizationService(
        new DrizzleAuthorizationStore(transaction),
      );
      await authorization.assertCan(principal, "view", {
        id: eventId,
        workspaceId: principal.workspaceId,
      });
      await assertEvent(transaction, principal.workspaceId, eventId);

      await transaction
        .insert(userEventViews)
        .values({
          userId,
          eventId,
          pages: write.defaults.pages,
          layouts: write.defaults.layouts,
        })
        .onConflictDoNothing();
      const { add, set, drop } = write.layouts;
      await transaction
        .update(userEventViews)
        .set({
          ...(write.place !== undefined && {
            place: write.place,
            openedAt: sql`now()`,
          }),
          ...(write.tabs !== undefined && {
            tabs: fieldWrite(userEventViews.tabs, write.tabs),
          }),
          ...(write.pages !== undefined && {
            pages: fieldWrite(userEventViews.pages, write.pages),
          }),
          layouts: sql`((${json(add)} || ${userEventViews.layouts}) || ${json(set)}) - ${textArray(drop)}`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(userEventViews.userId, userId),
            eq(userEventViews.eventId, eventId),
          ),
        );

      const entries = Object.entries(write.choices);
      const kept = entries.filter(([, choices]) => !isEmpty(choices));
      const cleared = entries
        .filter(([, choices]) => isEmpty(choices))
        .map(([component]) => component);
      if (kept.length > 0)
        await transaction
          .insert(userComponentChoices)
          .values(
            kept.map(([component, choices]) => ({
              userId,
              eventId,
              component,
              choices,
            })),
          )
          .onConflictDoUpdate({
            target: [
              userComponentChoices.userId,
              userComponentChoices.eventId,
              userComponentChoices.component,
            ],
            set: { choices: sql`excluded.choices`, updatedAt: sql`now()` },
          });
      // Choices returned to their defaults, and those of components the
      // event no longer has, go.
      await transaction.delete(userComponentChoices).where(
        and(
          eq(userComponentChoices.userId, userId),
          eq(userComponentChoices.eventId, eventId),
          sql`(${inArray(userComponentChoices.component, cleared)} OR (
              ${userComponentChoices.component} ~* ${idPattern}
              AND NOT (${json(write.components)} ? ${userComponentChoices.component})
            ))`,
        ),
      );

      // The account keeps its most recently opened views, this one always,
      // and its most recently changed component choices.
      await transaction.execute(sql`
        DELETE FROM user_event_views v
        WHERE v.user_id = ${userId} AND v.event_id <> ${eventId}
          AND (v.opened_at, v.event_id) < (
            SELECT k.opened_at, k.event_id FROM user_event_views k
            WHERE k.user_id = ${userId} AND k.event_id <> ${eventId}
            ORDER BY k.opened_at DESC, k.event_id DESC
            OFFSET ${eventViewLimit - 2} LIMIT 1
          )
      `);
      await transaction.execute(sql`
        DELETE FROM user_component_choices c
        WHERE c.user_id = ${userId}
          AND (c.updated_at, c.event_id, c.component) < (
            SELECT k.updated_at, k.event_id, k.component FROM user_component_choices k
            WHERE k.user_id = ${userId}
            ORDER BY k.updated_at DESC, k.event_id DESC, k.component DESC
            OFFSET ${componentChoicesLimit - 1} LIMIT 1
          )
      `);

      const stored = await readStoredView(transaction, userId, eventId);
      if (stored === null) throw new Error("The view was not saved.");
      return stored;
    });
  }

  async readPageChoices(
    userId: string,
    page: AccountPage,
  ): Promise<ViewChoices> {
    const [row] = await this.#database
      .select({ choices: userPageChoices.choices })
      .from(userPageChoices)
      .where(
        and(eq(userPageChoices.userId, userId), eq(userPageChoices.page, page)),
      )
      .limit(1);
    return pageChoicesFrom(row?.choices);
  }

  updatePageChoices(
    userId: string,
    page: AccountPage,
    changes: PageChoicesUpdate["choices"],
  ): Promise<ViewChoices> {
    const entries = Object.entries(changes);
    const kept = Object.fromEntries(
      entries.filter(([, value]) => value !== null),
    );
    const removed = entries
      .filter(([, value]) => value === null)
      .map(([name]) => name);
    return this.#database.transaction(async (transaction) => {
      const [merged] = await transaction
        .insert(userPageChoices)
        .values({ userId, page, choices: kept })
        .onConflictDoUpdate({
          target: [userPageChoices.userId, userPageChoices.page],
          set: {
            choices: sql`(${userPageChoices.choices} || ${json(kept)}) - ${textArray(removed)}`,
            updatedAt: sql`now()`,
          },
        })
        .returning({
          choices: userPageChoices.choices,
          names: sql<number>`(SELECT count(*)::integer FROM jsonb_object_keys(${userPageChoices.choices}))`,
          size: sql<number>`octet_length(${userPageChoices.choices}::text)`,
        });
      if (merged === undefined) throw new Error("The choices were not saved.");
      if (merged.names > 40 || merged.size > viewChoicesByteLimit)
        throw new InvalidObjectStateError(pageChoicesMessage);
      if (merged.names === 0)
        await transaction
          .delete(userPageChoices)
          .where(
            and(
              eq(userPageChoices.userId, userId),
              eq(userPageChoices.page, page),
            ),
          );
      return pageChoicesFrom(merged.choices);
    });
  }
}

function isEmpty(choices: ViewChoices): boolean {
  return Object.keys(choices).length === 0;
}

/** Only an Event has a view; any other object is unavailable. */
async function assertEvent(
  transaction: DatabaseTransaction,
  workspaceId: string,
  eventId: string,
): Promise<void> {
  const [event] = await transaction
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.id, eventId),
        eq(objects.objectType, "event"),
        isNull(objects.deletedAt),
      ),
    )
    .limit(1);
  if (event === undefined) throw new AuthorizationDeniedError();
}

/**
 * Each account's own view of an Event and of the collection pages, through
 * the repositories a deployment selects. A view is read and saved with the
 * access that reads the event's layout, and is normalized against the
 * layout the same read returns.
 */
export class PersonalViewService {
  readonly #layouts: Pick<EventLayoutReadRepository, "get">;
  readonly #reads: PersonalViewReadRepository;
  readonly #writes: PersonalViewWriteRepository;

  constructor(
    layouts: Pick<EventLayoutReadRepository, "get">,
    reads: PersonalViewReadRepository,
    writes: PersonalViewWriteRepository,
  ) {
    this.#layouts = layouts;
    this.#reads = reads;
    this.#writes = writes;
  }

  /** The event's layout with the account's own view of it; never writes. */
  async getEventLayoutWithView(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventLayoutWithViewResponse> {
    const layout = await this.#layouts.get(principal, eventId);
    const stored = await this.#reads.readEventView(principal, eventId);
    return { ...layout, yours: normalizeEventView(layout.pages, stored) };
  }

  async updateEventView(
    principal: UserPrincipal,
    eventId: string,
    payload: EventViewStateUpdate,
  ): Promise<EventViewState> {
    const change = eventViewStateUpdateSchema.parse(payload);
    const layout = await this.#layouts.get(principal, eventId);
    const stored = await this.#reads.readEventView(principal, eventId);
    const saved = await this.#writes.writeEventView(
      principal,
      eventId,
      planEventViewSave(layout.pages, stored, change),
    );
    return normalizeEventView(layout.pages, saved);
  }

  getPageChoices(
    principal: UserPrincipal,
    page: AccountPage,
  ): Promise<ViewChoices> {
    return this.#reads.readPageChoices(principal.userId, page);
  }

  updatePageChoices(
    principal: UserPrincipal,
    page: AccountPage,
    payload: PageChoicesUpdate,
  ): Promise<ViewChoices> {
    return this.#writes.updatePageChoices(
      principal.userId,
      page,
      pageChoicesUpdateSchema.parse(payload).choices,
    );
  }
}
