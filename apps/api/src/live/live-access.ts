import { AuthorizationDeniedError } from "@livtales/authorization";
import type {
  EventPlanningObjectService,
  LiveChangeReadRepository,
  WorkspaceSight,
} from "@livtales/object-model";

import { WorkspaceUnavailableError } from "../errors.js";
import type { WorkspaceIdentityService } from "../identity/workspace-identity-service.js";
import type { PageAccess } from "./live-hub.js";

export interface LivePageAccessOptions {
  readonly clock?: () => number;
  /** How long a resolved page and sight serve polls before they are read again. */
  readonly ttlMs?: number;
}

const cacheLimit = 10_000;

interface Cached<T> {
  readonly value: T;
  readonly at: number;
}

/**
 * Resolves what an account may see of a page: an Event's page opens where
 * the account may view the Event, in the Event's workspace; a space's
 * Tasks page opens where the account may enter the space. Resolutions and
 * sights are kept briefly so polls do not read them each time; a change
 * to an account's access forgets its entries.
 */
export class LivePageAccess {
  readonly #identity: WorkspaceIdentityService;
  readonly #objects: Pick<EventPlanningObjectService, "getEvent">;
  readonly #reads: LiveChangeReadRepository;
  readonly #clock: () => number;
  readonly #ttlMs: number;
  readonly #pages = new Map<string, Cached<PageAccess | null>>();
  readonly #sights = new Map<string, Cached<WorkspaceSight>>();

  constructor(
    dependencies: {
      readonly identity: WorkspaceIdentityService;
      readonly objects: Pick<EventPlanningObjectService, "getEvent">;
      readonly reads: LiveChangeReadRepository;
    },
    options: LivePageAccessOptions = {},
  ) {
    this.#identity = dependencies.identity;
    this.#objects = dependencies.objects;
    this.#reads = dependencies.reads;
    this.#clock = options.clock ?? Date.now;
    this.#ttlMs = options.ttlMs ?? 60_000;
  }

  /** The account's access to the page, or null when it cannot open it. */
  async resolve(userId: string, page: string): Promise<PageAccess | null> {
    const key = `${userId}|${page}`;
    const cached = this.#fresh(this.#pages.get(key));
    if (cached !== undefined) return cached;
    const access = await this.#resolve(userId, page);
    this.#keep(this.#pages, key, access);
    return access;
  }

  /** Forgets the account's resolutions, after its access changed. */
  forgetUser(userId: string): void {
    for (const cache of [this.#pages, this.#sights])
      for (const key of cache.keys())
        if (key.startsWith(`${userId}|`)) cache.delete(key);
  }

  /** Forgets every resolution in the workspace, after its access changed. */
  forgetWorkspace(workspaceId: string): void {
    for (const [key, entry] of this.#pages)
      if (entry.value?.workspaceId === workspaceId) this.#pages.delete(key);
    for (const key of this.#sights.keys())
      if (key.endsWith(`|${workspaceId}`)) this.#sights.delete(key);
  }

  async #resolve(userId: string, page: string): Promise<PageAccess | null> {
    const [kind, id] = page.split(":") as [string, string];
    try {
      if (kind === "event") {
        const session = await this.#identity.resolvePrincipal(
          userId,
          undefined,
          id,
        );
        const event = await this.#objects.getEvent(session.principal, id);
        return {
          page,
          workspaceId: event.workspaceId,
          event: { id, scopeId: event.permissionScopeId },
          sight: await this.#sight(userId, event.workspaceId),
        };
      }
      const session = await this.#identity.resolvePrincipal(userId, id);
      if (session.principal.workspaceId !== id) return null;
      return {
        page,
        workspaceId: id,
        event: null,
        sight: await this.#sight(userId, id),
      };
    } catch (error) {
      if (
        error instanceof AuthorizationDeniedError ||
        error instanceof WorkspaceUnavailableError
      )
        return null;
      throw error;
    }
  }

  async #sight(userId: string, workspaceId: string): Promise<WorkspaceSight> {
    const key = `${userId}|${workspaceId}`;
    const cached = this.#fresh(this.#sights.get(key));
    if (cached !== undefined) return cached;
    const sight = await this.#reads.readSight(
      userId,
      workspaceId,
      new Date(this.#clock()),
    );
    this.#keep(this.#sights, key, sight);
    return sight;
  }

  /** Keeps an entry, dropping expired ones once the cache has grown. */
  #keep<T>(cache: Map<string, Cached<T>>, key: string, value: T): void {
    const now = this.#clock();
    if (cache.size >= cacheLimit)
      for (const [entryKey, entry] of cache)
        if (now - entry.at >= this.#ttlMs) cache.delete(entryKey);
    cache.set(key, { value, at: now });
  }

  #fresh<T>(entry: Cached<T> | undefined): T | undefined {
    if (entry === undefined || this.#clock() - entry.at >= this.#ttlMs)
      return undefined;
    return entry.value;
  }
}
