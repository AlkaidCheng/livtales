import {
  serializeResource,
  type EventPlanningResource,
  type LiveChangeReadRepository,
} from "@livtales/object-model";
import type { LiveActor, LiveChangeCause } from "@livtales/schemas";

import type { LivePageAccess } from "./live-access.js";
import type { AnnouncedObject, LiveHub } from "./live-hub.js";
import type { LiveNote, LiveReport } from "./live-report.js";

/** The Event pages an object shows on: its own, when it is an Event, and those showing it. */
function eventsOf(
  resource: EventPlanningResource,
  shownOn: ReadonlyMap<string, readonly string[]>,
): string[] {
  return [
    ...(resource.objectType === "event" ? [resource.id] : []),
    ...(shownOn.get(resource.id) ?? []),
  ];
}

function announced(
  resource: EventPlanningResource,
  shownOn: ReadonlyMap<string, readonly string[]>,
): AnnouncedObject {
  return {
    record: {
      id: resource.id,
      objectType: resource.objectType,
      permissionScopeId: resource.permissionScopeId,
      sectionId:
        resource.objectType === "task" || resource.objectType === "expense"
          ? resource.sectionId
          : null,
    },
    events: eventsOf(resource, shownOn),
    state: serializeResource(resource),
  };
}

/**
 * Turns what a request reported into announcements on the hub. Objects are
 * read only when some page of their workspace is watched, and the Events
 * showing them only when some Event page there is.
 */
export class LiveAnnouncer {
  readonly #hub: LiveHub;
  readonly #reads: LiveChangeReadRepository;
  readonly #access: LivePageAccess;
  readonly #clock: () => number;

  constructor(
    hub: LiveHub,
    reads: LiveChangeReadRepository,
    access: LivePageAccess,
    clock: () => number = Date.now,
  ) {
    this.#hub = hub;
    this.#reads = reads;
    this.#access = access;
    this.#clock = clock;
  }

  async announce(report: LiveReport, actor: LiveActor): Promise<void> {
    for (const note of report.notes) await this.#announce(note, actor);
  }

  async #announce(note: LiveNote, actor: LiveActor): Promise<void> {
    const at = new Date(this.#clock()).toISOString();
    switch (note.kind) {
      case "objects":
        return this.#objects(note, actor, at);
      case "relation":
        return this.#relation(note, actor, at);
      case "section":
        this.#hub.announce({
          kind: "sections",
          workspaceId: note.section.workspaceId,
          actor,
          at,
          eventId: note.section.eventId,
          sections: note.removed ? [] : [note.section],
          removed: note.removed
            ? [{ id: note.section.id, view: note.section.view }]
            : [],
        });
        return;
      case "label":
        this.#hub.announce({
          kind: "labels",
          workspaceId: note.label.workspaceId,
          actor,
          at,
          labels: note.removed ? [] : [note.label],
          removed: note.removed ? [note.label.id] : [],
        });
        return;
      case "layout":
        this.#hub.announce({
          kind: "layout",
          workspaceId: note.workspaceId,
          actor,
          at,
          eventId: note.eventId,
          version: note.version,
        });
        return;
      case "view":
        this.#hub.notifyView(actor.userId, {
          target: note.target,
          tabId: actor.tabId,
        });
        return;
      case "access":
        for (const userId of note.users) this.#access.forgetUser(userId);
        for (const workspaceId of note.workspaces)
          this.#access.forgetWorkspace(workspaceId);
        this.#hub.resetWhere(
          (viewer, access) =>
            note.users.includes(viewer.userId) ||
            (note.workspaces.includes(access.workspaceId) &&
              !(note.grantsOnly && access.sight.member)),
        );
        return;
      case "signedOut":
        this.#hub.closeSessions(actor.userId, note.session);
        return;
    }
  }

  async #objects(
    note: Extract<LiveNote, { kind: "objects" }>,
    actor: LiveActor,
    at: string,
  ): Promise<void> {
    const watching = this.#watched(note.workspaceId);
    if (watching === null) return;
    const states = new Map(note.resources.map((state) => [state.id, state]));
    const unread = note.subtasks
      ? [...note.ids, ...states.keys()]
      : note.ids.filter((id) => !states.has(id));
    for (const state of await this.#reads.readStates(note.workspaceId, unread, {
      subtasks: note.subtasks,
    })) {
      const held = states.get(state.id);
      if (held === undefined || held.version <= state.version)
        states.set(state.id, state);
    }
    if (states.size === 0) return;
    const shownOn = await this.#shownOn(note.workspaceId, watching, [
      ...states.values(),
    ]);
    this.#hub.announce({
      kind: "objects",
      workspaceId: note.workspaceId,
      actor,
      at,
      cause: note.cause,
      objects: [...states.values()].map((state) => announced(state, shownOn)),
      departed: [],
    });
  }

  /**
   * Both ends of a relation, as they stand once it changed; an end the
   * relation no longer shows on the other's page departs from it.
   */
  async #relation(
    note: Extract<LiveNote, { kind: "relation" }>,
    actor: LiveActor,
    at: string,
  ): Promise<void> {
    const { workspaceId, sourceObjectId, targetObjectId } = note.relation;
    const watching = this.#watched(workspaceId);
    if (watching === null) return;
    const states = await this.#reads.readStates(workspaceId, [
      sourceObjectId,
      targetObjectId,
    ]);
    const shownOn = await this.#shownOn(workspaceId, watching, states);
    const objects = states.map((state) => announced(state, shownOn));
    const departed = note.live
      ? []
      : [
          { id: targetObjectId, event: sourceObjectId },
          { id: sourceObjectId, event: targetObjectId },
        ].filter(
          (end) =>
            !(
              objects.find((object) => object.record.id === end.id)?.events ??
              []
            ).includes(end.event),
        );
    const cause: LiveChangeCause = note.live ? "included" : "excluded";
    this.#hub.announce({
      kind: "objects",
      workspaceId,
      actor,
      at,
      cause,
      objects,
      departed,
    });
  }

  /** Which pages of the workspace are watched; null, with the change skipped, when none are. */
  #watched(
    workspaceId: string,
  ): { readonly events: boolean; readonly spaces: boolean } | null {
    const watching = this.#hub.watching(workspaceId);
    if (!watching.events && !watching.spaces) {
      this.#hub.skip(workspaceId, "all");
      return null;
    }
    return watching;
  }

  async #shownOn(
    workspaceId: string,
    watching: { readonly events: boolean },
    states: readonly EventPlanningResource[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (watching.events) return this.#reads.readShownOn(workspaceId, states);
    this.#hub.skip(workspaceId, "events");
    return new Map();
  }
}
