import type { TaskListQuery, TaskResponse } from "@livtales/schemas";

import { type DayKey, taskDay } from "./day-placement";
import { sortTasks, type TaskSort, taskSorts } from "./task-sort";
import type { StoredChoices } from "./view-choices";

/** Which tasks a list shows: the open ones, all of them, or the finished ones. */
export type TaskShow = NonNullable<TaskListQuery["filter"]>;

export const taskShows: readonly TaskShow[] = ["open", "all", "done"];

/**
 * The choices of an Event's Tasks: what it shows, its order, and its
 * filters. `assignee` is "" for anyone, "me" for the signed-in user's
 * person, "none" for unassigned, or a person's id; `label` is "" for any,
 * "none" for no label, or a label's id.
 */
export type EventTaskChoices = {
  readonly show: TaskShow;
  readonly sort: TaskSort;
  readonly assignee: string;
  readonly label: string;
  /** Only tasks due at a time. */
  readonly timed: boolean;
  /** Only open tasks whose day has passed. */
  readonly overdue: boolean;
};

export const defaultEventTaskChoices: EventTaskChoices = {
  show: "open",
  sort: "manual",
  assignee: "",
  label: "",
  timed: false,
  overdue: false,
};

/**
 * The choices of the workspace Tasks page, which the server filters:
 * `assignee` is "", "me", or a person's id, `label` is "" or a label's
 * id, and `from` is "" for anywhere, "none" for the standalone tasks,
 * "any" for the tasks of any event, or one event's id, named by
 * `fromName` for the chip.
 */
export type TaskPageChoices = {
  readonly show: TaskShow;
  readonly sort: TaskSort;
  readonly assignee: string;
  readonly label: string;
  readonly from: string;
  readonly fromName: string;
};

export const defaultTaskPageChoices: TaskPageChoices = {
  show: "open",
  sort: "manual",
  assignee: "",
  label: "",
  from: "",
  fromName: "",
};

const text = (value: unknown, fallback: string) =>
  typeof value === "string" ? value : fallback;

const oneOf = <T extends string>(
  value: unknown,
  choices: readonly T[],
  fallback: T,
): T =>
  typeof value === "string" && (choices as readonly string[]).includes(value)
    ? (value as T)
    : fallback;

/** An Event's Tasks choices from what storage holds, defaults for the rest. */
export function readEventTaskChoices(stored: StoredChoices): EventTaskChoices {
  const defaults = defaultEventTaskChoices;
  return {
    show: oneOf(stored.show, taskShows, defaults.show),
    sort: oneOf(stored.sort, taskSorts, defaults.sort),
    assignee: text(stored.assignee, defaults.assignee),
    label: text(stored.label, defaults.label),
    timed: stored.timed === true,
    overdue: stored.overdue === true,
  };
}

/** The Tasks page's choices from what storage holds, defaults for the rest. */
export function readTaskPageChoices(stored: StoredChoices): TaskPageChoices {
  const defaults = defaultTaskPageChoices;
  return {
    show: oneOf(stored.show, taskShows, defaults.show),
    sort: oneOf(stored.sort, taskSorts, defaults.sort),
    assignee: text(stored.assignee, defaults.assignee),
    label: text(stored.label, defaults.label),
    from: text(stored.from, defaults.from),
    fromName: text(stored.fromName, defaults.fromName),
  };
}

/**
 * The choices as they apply once the people and labels are known: "me"
 * without the account's person, or a person or label no longer named,
 * falls back to any. Names still loading (undefined) keep the choice.
 */
export function standingChoices<
  T extends { readonly assignee: string; readonly label: string },
>(
  choices: T,
  known: {
    readonly me: string | undefined;
    readonly people: ReadonlyMap<string, string> | undefined;
    readonly labels: ReadonlyMap<string, string> | undefined;
  },
): T {
  const named = (id: string, names: ReadonlyMap<string, string> | undefined) =>
    id === "" || id === "none" || names === undefined || names.has(id);
  return {
    ...choices,
    assignee:
      choices.assignee === "me"
        ? known.me === undefined
          ? ""
          : "me"
        : named(choices.assignee, known.people)
          ? choices.assignee
          : "",
    label: named(choices.label, known.labels) ? choices.label : "",
  };
}

/** Whether a task is still to do: neither done nor cancelled. */
export function isOpenTask(task: Pick<TaskResponse, "status">): boolean {
  return task.status !== "done" && task.status !== "cancelled";
}

/**
 * An Event's tasks as its choices show them, in their order: the filters
 * narrow every task, Show keeps the open ones, all, or the done ones, and
 * `finished` counts the tasks the filters keep that are no longer open,
 * for the list's foot while Show hides them. `me` is the signed-in
 * user's person, for the "me" assignee.
 */
export function chooseEventTasks(
  tasks: readonly TaskResponse[],
  choices: EventTaskChoices,
  { me, today }: { readonly me: string | undefined; readonly today: DayKey },
): { readonly shown: TaskResponse[]; readonly finished: number } {
  const assignee = choices.assignee === "me" ? me : choices.assignee;
  const matching = tasks.filter((task) => {
    if (choices.label === "none" && task.labelIds.length > 0) return false;
    if (
      choices.label !== "" &&
      choices.label !== "none" &&
      !task.labelIds.includes(choices.label)
    )
      return false;
    if (choices.assignee === "none" && task.assigneeId !== null) return false;
    if (
      choices.assignee !== "" &&
      choices.assignee !== "none" &&
      task.assigneeId !== assignee
    )
      return false;
    if (choices.timed && task.dueAt === null) return false;
    if (choices.overdue) {
      const day = taskDay(task);
      if (day === null || day >= today || !isOpenTask(task)) return false;
    }
    return true;
  });
  const shown = matching.filter((task) =>
    choices.show === "open"
      ? isOpenTask(task)
      : choices.show === "done"
        ? task.status === "done"
        : true,
  );
  return {
    shown: sortTasks(shown, choices.sort),
    finished: matching.filter((task) => !isOpenTask(task)).length,
  };
}
