import type {
  EventPlanningResource,
  ObjectRelationResource,
} from "@livtales/object-model";
import type {
  LabelResponse,
  LiveChangeCause,
  LiveView,
  SectionResponse,
} from "@livtales/schemas";

/** One thing a request changed, as its route reports it. */
export type LiveNote =
  | {
      readonly kind: "objects";
      readonly workspaceId: string;
      /** States the route holds; ids whose states are read once announced. */
      readonly resources: readonly EventPlanningResource[];
      readonly ids: readonly string[];
      readonly cause: LiveChangeCause;
      /** Whether the subtasks of tasks among them changed with them. */
      readonly subtasks: boolean;
    }
  | {
      readonly kind: "relation";
      readonly relation: Pick<
        ObjectRelationResource,
        "workspaceId" | "relationType" | "sourceObjectId" | "targetObjectId"
      >;
      readonly live: boolean;
    }
  | {
      readonly kind: "section";
      readonly section: SectionResponse;
      readonly removed: boolean;
    }
  | {
      readonly kind: "label";
      readonly label: LabelResponse;
      readonly removed: boolean;
    }
  | {
      readonly kind: "layout";
      readonly workspaceId: string;
      readonly eventId: string;
      readonly version: number;
    }
  | { readonly kind: "view"; readonly target: LiveView["target"] }
  | {
      readonly kind: "access";
      readonly users: readonly string[];
      readonly workspaces: readonly string[];
      /** Only viewers of those workspaces who see them through grants. */
      readonly grantsOnly: boolean;
    }
  | { readonly kind: "signedOut"; readonly session: string | null };

/**
 * What one request changed. Routes report into it as they succeed; the
 * report is announced once the response has been sent, and dropped when
 * the request failed.
 */
export class LiveReport {
  readonly #notes: LiveNote[] = [];

  get notes(): readonly LiveNote[] {
    return this.#notes;
  }

  /** Objects the request created or changed, as states in hand or ids to read. */
  objects(
    workspaceId: string,
    objects: readonly (EventPlanningResource | string)[],
    cause: LiveChangeCause,
    options: { readonly subtasks?: boolean } = {},
  ): void {
    this.#notes.push({
      kind: "objects",
      workspaceId,
      resources: objects.filter(
        (object): object is EventPlanningResource => typeof object !== "string",
      ),
      ids: objects.filter(
        (object): object is string => typeof object === "string",
      ),
      cause,
      subtasks: options.subtasks ?? false,
    });
  }

  /** A relation the request created, recovered, or removed. */
  relation(
    relation: Pick<
      ObjectRelationResource,
      "workspaceId" | "relationType" | "sourceObjectId" | "targetObjectId"
    >,
    live: boolean,
  ): void {
    this.#notes.push({ kind: "relation", relation, live });
  }

  section(
    section: SectionResponse,
    options: { readonly removed?: boolean } = {},
  ): void {
    this.#notes.push({
      kind: "section",
      section,
      removed: options.removed ?? false,
    });
  }

  label(
    label: LabelResponse,
    options: { readonly removed?: boolean } = {},
  ): void {
    this.#notes.push({
      kind: "label",
      label,
      removed: options.removed ?? false,
    });
  }

  layout(workspaceId: string, eventId: string, version: number): void {
    this.#notes.push({ kind: "layout", workspaceId, eventId, version });
  }

  /** The acting account's own view of an Event or page. */
  view(target: LiveView["target"]): void {
    this.#notes.push({ kind: "view", target });
  }

  /**
   * What some accounts may see changed: the named accounts everywhere, and
   * everyone in the named workspaces, or only those there through grants.
   */
  accessChanged(scope: {
    readonly users?: readonly string[];
    readonly workspaces?: readonly string[];
    readonly grantsOnly?: boolean;
  }): void {
    this.#notes.push({
      kind: "access",
      users: scope.users ?? [],
      workspaces: scope.workspaces ?? [],
      grantsOnly: scope.grantsOnly ?? false,
    });
  }

  /** The acting account signed out: the session it used, or every session. */
  signedOut(session: string | null): void {
    this.#notes.push({ kind: "signedOut", session });
  }
}
