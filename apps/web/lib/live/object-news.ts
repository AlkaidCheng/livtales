import { ApiClientError } from "@livtales/api-client";
import type {
  EventPlanningResourceResponse,
  LiveChange,
  LiveChangeCause,
} from "@livtales/schemas";

type Resource = EventPlanningResourceResponse;

/** What one change a tab received did to an object. */
export interface ObjectNews {
  readonly cause: LiveChangeCause;
  /** Who made the change; null when the viewer made it, on another device. */
  readonly actor: string | null;
  /** The object as the change left it; undefined when it left the page for the viewer. */
  readonly state: Resource | undefined;
}

/**
 * Why a confirmation no longer applies as it was asked: its object went to
 * Trash, came back out of it, was taken off the page, stopped being
 * visible to the viewer, or changed in a way the server refused. `actor`
 * names who did it when the change said.
 */
export interface Gone {
  readonly kind: "trashed" | "restored" | "removed" | "unavailable" | "changed";
  readonly actor: string | null;
}

/** The news of each object a change touched, as its viewer receives it. */
export function newsOf(
  change: LiveChange,
  viewerId: string | undefined,
): Map<string, ObjectNews> {
  const news = new Map<string, ObjectNews>();
  if (change.kind !== "objects") return news;
  const cause = change.cause;
  const actor =
    change.actor.userId === viewerId ? null : change.actor.displayName;
  for (const state of change.objects)
    news.set(state.id, { cause, actor, state });
  for (const id of change.removed)
    news.set(id, { cause, actor, state: undefined });
  return news;
}

/**
 * What news means for a confirmation about its object: null while the
 * object stands as the confirmation expects, live or, for one about a
 * record in Trash, trashed.
 */
export function goneOf(news: ObjectNews, inTrash = false): Gone | null {
  const { actor, state } = news;
  if (state === undefined)
    return {
      kind: news.cause === "excluded" ? "removed" : "unavailable",
      actor,
    };
  const trashed = state.deletedAt !== null;
  if (trashed === inTrash) return null;
  return { kind: trashed ? "trashed" : "restored", actor };
}

/**
 * A refusal saying the object went away or changed since the confirmation
 * was shown; null for any other failure, which keeps its own notice.
 */
export function refusalOf(error: unknown): Gone | null {
  if (!(error instanceof ApiClientError)) return null;
  if (error.status === 403 || error.status === 404)
    return { kind: "unavailable", actor: null };
  if (error.code === "version_conflict")
    return { kind: "changed", actor: null };
  return null;
}

/** The objects open confirmations follow, each told of the changes to it. */
export class ObjectFollows {
  readonly #listeners = new Map<string, Set<(news: ObjectNews) => void>>();

  /** Tells the listener of each change to the object; returns the way to stop. */
  follow(id: string, listener: (news: ObjectNews) => void): () => void {
    const listeners = this.#listeners.get(id) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(id, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.#listeners.delete(id);
    };
  }

  tell(change: LiveChange, viewerId: string | undefined): void {
    if (this.#listeners.size === 0) return;
    for (const [id, news] of newsOf(change, viewerId))
      for (const listener of this.#listeners.get(id) ?? []) listener(news);
  }
}
