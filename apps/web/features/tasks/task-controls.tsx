"use client";

import { useTranslations } from "next-intl";

import { HeadMenu } from "../../components/head-menu";
import { FilterIcon, SortIcon } from "../../components/icons";
import { type TaskShow, taskShows } from "../../lib/task-choices";
import { type TaskSort, taskSorts } from "../../lib/task-sort";
import {
  type OptionChoice,
  OptionsPopover,
  type ViewChip,
  type ViewOption,
} from "../events/view-options";

/** A person or a label a filter offers by name. */
export interface NamedChoice {
  readonly id: string;
  readonly name: string;
}

/** What a task filter holds; a container leaves out what it does not offer. */
export interface TaskFilterChoices {
  readonly show: TaskShow;
  readonly assignee: string;
  readonly label: string;
  readonly timed?: boolean | undefined;
  readonly overdue?: boolean | undefined;
  readonly from?: string | undefined;
}

/** A change to a task list's choices: the ones named, the rest kept. */
export type TaskChoiceChanges = {
  readonly show?: TaskShow;
  readonly sort?: TaskSort;
  readonly assignee?: string;
  readonly label?: string;
  readonly timed?: boolean;
  readonly overdue?: boolean;
  readonly from?: string;
};

/** The choices a task filter offers, beside the ones it holds. */
export interface TaskFilterOffer {
  /** The people offered by name, the signed-in user's own person left out. */
  readonly people: readonly NamedChoice[];
  readonly labels: readonly NamedChoice[];
  /** Whether the signed-in user's person is offered, as You. */
  readonly me: boolean;
  /** Whether Unassigned and No label are offered: a container that filters its own tasks. */
  readonly none: boolean;
  /** The events offered for From, on the Tasks page; with a search that asks the server. */
  readonly events?:
    | {
        readonly choices: readonly NamedChoice[];
        readonly onQuery: (query: string) => void;
      }
    | undefined;
}

/** How many choices of the Filter differ from their defaults: what its button counts. */
export function activeFilterCount(filters: TaskFilterChoices): number {
  return (
    Number(filters.show !== "open") +
    Number(filters.assignee !== "") +
    Number(filters.label !== "") +
    Number(filters.timed === true) +
    Number(filters.overdue === true) +
    Number((filters.from ?? "") !== "")
  );
}

/** The task options: Show, then the Filter group; the phone's pop-up and the Filter popover share them. */
export function useTaskFilterOptions(
  filters: TaskFilterChoices,
  offer: TaskFilterOffer,
  onChange: (changes: TaskChoiceChanges) => void,
): { readonly show: ViewOption; readonly filters: readonly ViewOption[] } {
  const t = useTranslations("controls");
  const person = (choice: NamedChoice): OptionChoice => ({
    value: choice.id,
    label: choice.name,
    searchable: true,
    person: true,
  });
  const named = (choice: NamedChoice): OptionChoice => ({
    value: choice.id,
    label: choice.name,
    searchable: true,
  });
  const show: ViewOption = {
    kind: "segments",
    id: "show",
    label: t("show"),
    value: filters.show,
    choices: taskShows.map((value) => ({
      value,
      label: t(`shows.${value}`),
    })),
    onChange: (value) => onChange({ show: value as TaskShow }),
  };
  const rows: ViewOption[] = [];
  if (offer.events !== undefined) {
    const { choices, onQuery } = offer.events;
    rows.push({
      kind: "list",
      id: "from",
      label: t("from"),
      value: filters.from ?? "",
      changed: (filters.from ?? "") !== "",
      groups: [
        {
          choices: [
            { value: "", label: t("anywhere") },
            { value: "none", label: t("standalone") },
            { value: "any", label: t("events") },
          ],
        },
        { label: t("oneEvent"), choices: choices.map(named) },
      ],
      search: { label: t("findEvent"), empty: t("noEvent"), onQuery },
      onChange: (from) => onChange({ from }),
    });
  }
  rows.push({
    kind: "list",
    id: "assignee",
    label: t("assignedTo"),
    value: filters.assignee,
    changed: filters.assignee !== "",
    groups: [
      {
        choices: [
          { value: "", label: t("anyone") },
          ...(offer.me ? [{ value: "me", label: t("you") }] : []),
          ...(offer.none ? [{ value: "none", label: t("unassigned") }] : []),
        ],
      },
      {
        label: t("people", { count: offer.people.length }),
        choices: offer.people.map(person),
      },
    ],
    search: { label: t("findPerson"), empty: t("noPerson") },
    onChange: (assignee) => onChange({ assignee }),
  });
  rows.push({
    kind: "list",
    id: "label",
    label: t("label"),
    value: filters.label,
    changed: filters.label !== "",
    groups: [
      {
        choices: [
          { value: "", label: t("any") },
          ...(offer.none ? [{ value: "none", label: t("noLabel") }] : []),
        ],
      },
      { label: t("labels"), choices: offer.labels.map(named) },
    ],
    search: { label: t("findLabel"), empty: t("noLabelFound") },
    onChange: (label) => onChange({ label }),
  });
  if (filters.timed !== undefined)
    rows.push({
      kind: "switch",
      id: "timed",
      label: t("hasTime"),
      checked: filters.timed,
      onChange: (timed) => onChange({ timed }),
    });
  if (filters.overdue !== undefined)
    rows.push({
      kind: "switch",
      id: "overdue",
      label: t("overdueOnly"),
      checked: filters.overdue,
      onChange: (overdue) => onChange({ overdue }),
    });
  return { show, filters: rows };
}

/** Sort as one quiet control; the button reads the chosen order when it is not the default. */
export function TaskSortControl({
  defaultSort = "manual",
  onChange,
  sort,
}: {
  readonly defaultSort?: TaskSort;
  readonly onChange: (sort: TaskSort) => void;
  readonly sort: TaskSort;
}) {
  const t = useTranslations("controls");
  return (
    <HeadMenu
      active={sort !== defaultSort}
      entries={taskSorts.map((choice) => ({
        kind: "radio",
        label: t(`sorts.${choice}`),
        checked: choice === sort,
        onSelect: () => {
          if (choice !== sort) onChange(choice);
        },
      }))}
      icon={<SortIcon />}
      label={t("sort")}
      name={sort === defaultSort ? undefined : t(`sorts.${sort}`)}
    />
  );
}

/** Sort as a row of the phone's options, opening its list. */
export function useTaskSortOption(
  sort: TaskSort,
  onChange: (sort: TaskSort) => void,
): ViewOption {
  const t = useTranslations("controls");
  return {
    kind: "list",
    id: "sort",
    label: t("sort"),
    value: sort,
    changed: sort !== "manual",
    groups: [
      {
        choices: taskSorts.map((value) => ({
          value,
          label: t(`sorts.${value}`),
        })),
      },
    ],
    onChange: (value) => onChange(value as TaskSort),
  };
}

/**
 * Filter as one quiet control on a wide screen: Show, then the filters a
 * container offers (Assigned to and Label, each a searchable list, and
 * its switches), and Clear filters while any is on. The button counts
 * the filters that are on.
 */
export function TaskFilterControl({
  filters,
  onClear,
  options,
}: {
  readonly filters: TaskFilterChoices;
  readonly onClear: () => void;
  readonly options: {
    readonly show: ViewOption;
    readonly filters: readonly ViewOption[];
  };
}) {
  const t = useTranslations("controls");
  const count = activeFilterCount(filters);
  return (
    <OptionsPopover
      active={count > 0}
      icon={<FilterIcon />}
      label={t("filter")}
      name={count === 0 ? undefined : t("filterCount", { count })}
      options={[
        options.show,
        ...options.filters,
        ...(count === 0
          ? []
          : [
              {
                kind: "action" as const,
                id: "clear",
                label: t("clearFilters"),
                onPress: onClear,
              },
            ]),
      ]}
    />
  );
}

/**
 * The chips of a task list's choices that differ from their defaults:
 * what it shows, whose and which tasks, and its order. `names` finds a
 * person's, a label's, or an event's name; a choice whose name is not
 * known yet shows no chip.
 */
export function useTaskChips(
  choices: TaskFilterChoices & { readonly sort: TaskSort },
  names: {
    readonly person: (id: string) => string | undefined;
    readonly label: (id: string) => string | undefined;
    readonly event?: ((id: string) => string | undefined) | undefined;
  },
  onChange: (changes: TaskChoiceChanges) => void,
): readonly ViewChip[] {
  const t = useTranslations("controls.chips");
  const chips: ViewChip[] = [];
  const add = (id: string, label: string | undefined, clear: () => void) => {
    if (label !== undefined) chips.push({ id, label, onClear: clear });
  };
  if (choices.show !== "open")
    add(
      "show",
      choices.show === "all" ? t("showingFinished") : t("finishedOnly"),
      () => onChange({ show: "open" }),
    );
  const from = choices.from ?? "";
  if (from !== "")
    add(
      "from",
      from === "none"
        ? t("standalone")
        : from === "any"
          ? t("fromEvents")
          : (() => {
              const name = names.event?.(from);
              return name === undefined ? undefined : t("from", { name });
            })(),
      () => onChange({ from: "" }),
    );
  if (choices.assignee !== "") {
    const name =
      choices.assignee === "me" || choices.assignee === "none"
        ? undefined
        : names.person(choices.assignee);
    add(
      "assignee",
      choices.assignee === "me"
        ? t("assignedToYou")
        : choices.assignee === "none"
          ? t("unassigned")
          : name === undefined
            ? undefined
            : t("assignedTo", { name }),
      () => onChange({ assignee: "" }),
    );
  }
  if (choices.label !== "") {
    const name =
      choices.label === "none" ? undefined : names.label(choices.label);
    add(
      "label",
      choices.label === "none"
        ? t("noLabel")
        : name === undefined
          ? undefined
          : t("label", { name }),
      () => onChange({ label: "" }),
    );
  }
  if (choices.timed === true)
    add("timed", t("timed"), () => onChange({ timed: false }));
  if (choices.overdue === true)
    add("overdue", t("overdue"), () => onChange({ overdue: false }));
  if (choices.sort !== "manual")
    add("sort", t(`sorted.${choices.sort}`), () =>
      onChange({ sort: "manual" }),
    );
  return chips;
}
