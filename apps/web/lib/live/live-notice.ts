import type {
  EventPlanningResourceResponse,
  LiveChange,
} from "@livtales/schemas";

type Resource = EventPlanningResourceResponse;
type ObjectsChange = Extract<LiveChange, { kind: "objects" }>;

/** The part of an object each field belongs to, as a pop-up names it. */
const partOfField: Readonly<Record<string, Part>> = {
  displayName: "name",
  nickname: "name",
  startsAt: "when",
  startsOn: "when",
  endsAt: "when",
  endsOn: "when",
  isAllDay: "when",
  timezone: "when",
  dueOn: "due",
  dueAt: "due",
  durationMinutes: "due",
  repeatRule: "repeat",
  repeatUntil: "repeat",
  status: "status",
  completedAt: "status",
  assigneeId: "assignee",
  labelIds: "labels",
  sectionId: "section",
  rank: "order",
  parentTaskId: "parent",
  location: "location",
  description: "description",
  amount: "amount",
  currency: "amount",
  occurredAt: "date",
  remindAt: "reminder",
  body: "text",
  contacts: "contacts",
};

export type Part =
  | "name"
  | "when"
  | "due"
  | "repeat"
  | "status"
  | "assignee"
  | "labels"
  | "section"
  | "order"
  | "parent"
  | "location"
  | "description"
  | "amount"
  | "date"
  | "reminder"
  | "text"
  | "contacts";

/** The parts the fields belong to, each once in the order they come; null when a field belongs to none. */
export function partsOfFields(fields: readonly string[]): Part[] | null {
  const parts: Part[] = [];
  for (const field of fields) {
    const part = partOfField[field];
    if (part === undefined) return null;
    if (!parts.includes(part)) parts.push(part);
  }
  return parts;
}

/** The parts of an object that differ between two of its states, in the order its fields come. */
export function changedParts(before: Resource, after: Resource): Part[] {
  const parts: Part[] = [];
  const earlier = before as Record<string, unknown>;
  for (const [field, value] of Object.entries(after)) {
    const part = partOfField[field];
    if (part === undefined || parts.includes(part)) continue;
    if (JSON.stringify(earlier[field]) !== JSON.stringify(value))
      parts.push(part);
  }
  return parts;
}

/** What a pop-up says about one change: which verb, about which object, and which parts. */
export interface ChangeNotice {
  readonly verb:
    | "updated"
    | "added"
    | "trashed"
    | "restored"
    | "undid"
    | "redid"
    | "removed";
  readonly objectId: string;
  readonly objectName: string;
  /** The name the page held, which a rename names first. */
  readonly previousName: string;
  readonly parts: readonly Part[];
}

const verbOfCause: Readonly<
  Record<ObjectsChange["cause"], ChangeNotice["verb"]>
> = {
  created: "added",
  included: "added",
  updated: "updated",
  trashed: "trashed",
  recovered: "restored",
  restored: "restored",
  undone: "undid",
  redone: "redid",
  excluded: "removed",
};

/**
 * The pop-up for a change to objects: the first object changed (a parent
 * comes before its subtasks), and for an edit the parts that differ from
 * the copy the page held. Null for an edit the page already holds, or one
 * that only moved the object in its list, which the list shows.
 */
export function noticeOf(
  change: ObjectsChange,
  held: (id: string) => Resource | undefined,
): ChangeNotice | null {
  const verb = verbOfCause[change.cause];
  const [first] = change.objects;
  if (first === undefined) {
    const [removed] = change.removed;
    const before = removed === undefined ? undefined : held(removed);
    return before === undefined
      ? null
      : {
          verb: "removed",
          objectId: before.id,
          objectName: before.displayName,
          previousName: before.displayName,
          parts: [],
        };
  }
  const before = held(first.id);
  if (verb !== "updated" || before === undefined)
    return {
      verb,
      objectId: first.id,
      objectName: first.displayName,
      previousName: before?.displayName ?? first.displayName,
      parts: [],
    };
  if (before.version >= first.version) return null;
  // Moving the object in its list shows in the list; a pop-up names the
  // other parts, and a move alone makes none.
  const parts = changedParts(before, first);
  const named = parts.filter((part) => part !== "order");
  if (parts.length > 0 && named.length === 0) return null;
  return {
    verb,
    objectId: first.id,
    objectName: first.displayName,
    previousName: before.displayName,
    parts: named,
  };
}

/** Which sentence a pop-up says, and what it fills in. */
export type NoticeWords =
  | { readonly key: "renamed"; readonly before: string }
  | { readonly key: "changedOne"; readonly part: Part }
  | { readonly key: "changedTwo"; readonly first: Part; readonly second: Part }
  | { readonly key: ChangeNotice["verb"] };

/**
 * The sentence for a pop-up: a rename names both names, an edit of one or
 * two parts names them, and anything else takes its verb.
 */
export function noticeWords(notice: ChangeNotice): NoticeWords {
  if (notice.verb !== "updated") return { key: notice.verb };
  const [first, second, ...more] = notice.parts;
  if (first === "name" && second === undefined)
    return { key: "renamed", before: notice.previousName };
  if (first === undefined || more.length > 0) return { key: "updated" };
  if (second === undefined) return { key: "changedOne", part: first };
  return { key: "changedTwo", first, second };
}
