"use client";

import {
  type EventComponentView,
  eventComponentViewSchema,
  type TaskListQueryInput,
  type TaskResponse,
} from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SpaceAddSeal } from "../../components/add-seal";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { PlusIcon, SearchIcon } from "../../components/icons";
import { useComposerSlots } from "../../lib/composer-slots";
import { rowSelector, useReturnFocus } from "../../lib/use-return-focus";
import type { TaskFields } from "../../lib/task-fields";
import { LayoutControl } from "../events/component-frame";
import { type SubtaskParent, TaskForm } from "../events/task-form";
import { TaskInspector } from "../events/task-inspector";
import { ActiveChips } from "../events/view-options";
import { viewsOf } from "../../lib/event-components";
import { periodRange, usePeriod } from "../../lib/use-period";
import { shownTimeZone } from "../../i18n/active-preferences";
import { personDisplayName } from "../../lib/person-fields";
import {
  useEventsQuery,
  useLabelsQuery,
  usePersonsQuery,
  useRefreshEvent,
  useSessionQuery,
  useTasksQuery,
} from "../../lib/queries";
import {
  defaultTaskPageChoices,
  readTaskPageChoices,
  standingChoices,
} from "../../lib/task-choices";
import { useIsPhone } from "../../lib/use-media";
import { useViewChoices, viewChoicesKey } from "../../lib/view-choices";
import { ManageLabelsButton } from "./label-manager";
import { AddTaskRow } from "./add-task-row";
import { FinishedFoot, FinishedHead } from "./finished-tasks";
import {
  TaskFilterControl,
  TaskSortControl,
  useTaskChips,
  useTaskFilterOptions,
} from "./task-controls";
import { TaskListView } from "./task-list-view";

const viewStorageKey = "chronelle.task-view";

/** How many finished tasks the foot counts before it says "50+". */
const finishedCountLimit = 50;

/**
 * Every task the user may view in the workspace, on its own or inside an
 * Event, as a list or by day, in manual order unless another sort is
 * chosen. The layout is a device preference like the Event collection's;
 * what the list shows, its sort, and its filters (Show, From, Assigned to,
 * Label) are kept for the account in this browser and show as chips, and
 * the search lives with the tab. While the finished tasks are hidden, the
 * list's foot counts them and shows them on request.
 */
export function TasksPage() {
  const t = useTranslations("tasksPage");
  const controls = useTranslations("controls");
  const todos = useTranslations("todos");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [view, setView] = useState<EventComponentView>("list");
  const [eventQuery, setEventQuery] = useState("");
  // The full editor for a new task opens from the header, or from an add
  // row's composer with its fields; for a task, from its row's composer.
  const [adding, setAdding] = useState<Partial<TaskFields> | null>(null);
  const [parent, setParent] = useState<SubtaskParent | null>(null);
  const [editing, setEditing] = useState<{
    readonly id: string;
    readonly start: Partial<TaskFields>;
  } | null>(null);
  const composer = useComposerSlots();
  const pageRoot = useRef<HTMLElement>(null);
  const returnFocus = useReturnFocus(pageRoot);
  const closeEditing = useCallback(() => {
    setEditing((current) => {
      if (current !== null) returnFocus(rowSelector(current.id));
      return null;
    });
  }, [returnFocus]);
  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, isComposing]);
  useEffect(() => {
    try {
      const stored = eventComponentViewSchema.safeParse(
        window.localStorage.getItem(viewStorageKey),
      );
      if (stored.success && viewsOf("todos").includes(stored.data))
        setView(stored.data);
    } catch {
      // The list stays usable when browser storage is unavailable.
    }
  }, []);
  const session = useSessionQuery();
  const [choices, change] = useViewChoices(
    session.data === undefined
      ? null
      : viewChoicesKey(session.data.user.id, "tasks"),
    defaultTaskPageChoices,
    readTaskPageChoices,
  );
  const labels = useLabelsQuery();
  const persons = usePersonsQuery();
  // The person linked to the signed-in account, when one exists.
  const myPerson = persons.data?.items.find(
    (person) =>
      session.data !== undefined && person.userId === session.data.user.id,
  );
  const effective = standingChoices(choices, {
    me: myPerson?.id,
    people: persons.data?.names,
    labels: labels.data?.names,
  });
  const { show, sort, label, from } = effective;
  const assignee =
    effective.assignee === "me" ? (myPerson?.id ?? "") : effective.assignee;
  // A week or month asks the server for its days and loads all of them.
  const period = usePeriod(view);
  const range = useMemo(
    () => periodRange(view, period.cursor),
    [view, period.cursor],
  );
  const listed: Omit<TaskListQueryInput, "cursor"> = {
    query: debouncedQuery,
    filter: show,
    sort,
    ...(label === "" ? {} : { label }),
    ...(assignee === "" ? {} : { assignee }),
    ...(from === "" ? {} : { event: from }),
    ...(range === null
      ? {}
      : {
          dueFrom: range.from,
          dueTo: range.to,
          timezone: shownTimeZone(),
          limit: 50,
        }),
  };
  const tasks = useTasksQuery(listed);
  // While Show hides them, the finished tasks the same filters keep are
  // counted for the list's foot, up to a page.
  const finished = useTasksQuery(
    { ...listed, filter: "done", limit: finishedCountLimit },
    show === "open",
  );
  const { fetchNextPage, hasNextPage, isFetching: isFetchingTasks } = tasks;
  useEffect(() => {
    if (range !== null && hasNextPage && !isFetchingTasks) void fetchNextPage();
  }, [range, hasNextPage, isFetchingTasks, fetchNextPage]);
  const events = useEventsQuery({
    query: eventQuery.trim(),
    sort: "name",
    limit: 50,
  });
  // On a phone the add button stands in for the header's New task.
  const phone = useIsPhone();
  const refresh = useRefreshEvent(undefined);
  const changingQuery = isComposing || query.trim() !== debouncedQuery;
  const items = changingQuery ? [] : (tasks.data?.items ?? []);
  const filtered =
    debouncedQuery !== "" ||
    show !== "open" ||
    label !== "" ||
    assignee !== "" ||
    from !== "";
  const people = (persons.data?.items ?? [])
    .filter((person) => person.id !== myPerson?.id)
    .map((person) => ({ id: person.id, name: personDisplayName(person) }));
  // The chosen event keeps its name for the chip while other events are
  // listed; it is learned from the list or from the tasks' own events.
  const eventName = (id: string): string | undefined =>
    events.data?.items.find((event) => event.id === id)?.displayName ??
    Object.values(tasks.data?.contexts ?? {}).find(
      (context) => context.eventId === id,
    )?.displayName ??
    (choices.from === id && choices.fromName !== ""
      ? choices.fromName
      : undefined);
  const filterOptions = useTaskFilterOptions(
    effective,
    {
      people,
      labels: labels.data?.items ?? [],
      me: myPerson !== undefined,
      none: false,
      events: {
        choices: (events.data?.items ?? []).map((event) => ({
          id: event.id,
          name: event.displayName,
        })),
        onQuery: setEventQuery,
      },
    },
    (changes) =>
      change(
        changes.from === undefined
          ? changes
          : { ...changes, fromName: eventName(changes.from) ?? "" },
      ),
  );
  const clearFilters = () =>
    change({ show: "open", assignee: "", label: "", from: "", fromName: "" });
  const chips = useTaskChips(
    effective,
    {
      person: (id) => persons.data?.names.get(id),
      label: (id) => labels.data?.names.get(id),
      event: eventName,
    },
    change,
  );
  const finishedListed = items.filter(
    (task) => task.status === "done" || task.status === "cancelled",
  ).length;
  const listShown =
    items.length > 0 ||
    (range !== null && tasks.data !== undefined && !changingQuery);
  // While Show hides them, the list's foot counts the finished tasks, in
  // the list's column when the list shows.
  const finishedFoot =
    show === "open" &&
    !changingQuery &&
    tasks.data !== undefined &&
    (finished.data?.items.length ?? 0) > 0 ? (
      <FinishedFoot
        count={finished.data?.items.length ?? 0}
        more={finished.hasNextPage}
        onShow={() => change({ show: "all" })}
      />
    ) : null;

  // Stable, so the row cells keep their identity and focus across renders.
  const addSubtask = useCallback(
    (task: TaskResponse) =>
      setParent({
        id: task.id,
        displayName: task.displayName,
        permissionScopeId: task.permissionScopeId,
      }),
    [],
  );

  function changeView(next: EventComponentView) {
    setView(next);
    try {
      window.localStorage.setItem(viewStorageKey, next);
    } catch {
      // A preference that cannot be stored still applies to this page.
    }
  }

  return (
    <main className="workspace-page" ref={pageRoot} tabIndex={-1}>
      <header className="page-heading split-heading collection-column">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
        </div>
        {phone ? null : (
          <button
            aria-haspopup="dialog"
            className="button button-primary"
            onClick={(event) => {
              event.currentTarget.focus();
              setAdding({});
            }}
            type="button"
          >
            <PlusIcon />
            {t("new")}
          </button>
        )}
      </header>

      {adding !== null ? (
        <TaskForm key="new" onCancel={() => setAdding(null)} start={adding} />
      ) : null}
      {parent !== null ? (
        <TaskForm
          key={`sub:${parent.id}`}
          onCancel={() => setParent(null)}
          parent={parent}
        />
      ) : null}

      <section
        aria-labelledby="task-list-heading"
        className="event-list-section collection-column"
      >
        <div className="collection-toolbar">
          <label className="collection-search">
            <SearchIcon />
            <span className="visually-hidden">{t("filterByName")}</span>
            <input
              maxLength={240}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionEnd={(event) => {
                setQuery(event.currentTarget.value);
                setIsComposing(false);
              }}
              onCompositionStart={() => setIsComposing(true)}
              placeholder={t("find")}
              type="search"
              value={query}
            />
          </label>
          <div className="head-controls">
            <TaskSortControl
              onChange={(next) => change({ sort: next })}
              sort={sort}
            />
            <TaskFilterControl
              filters={effective}
              onClear={clearFilters}
              options={filterOptions}
            />
            <LayoutControl
              onChange={changeView}
              view={view}
              views={viewsOf("todos")}
            />
          </div>
          <ManageLabelsButton />
          <button
            className="button button-quiet"
            disabled={tasks.isFetching || changingQuery}
            onClick={() => void tasks.refresh()}
            type="button"
          >
            {t("refresh")}
          </button>
        </div>
        <ActiveChips
          chips={chips}
          onClearAll={() => {
            clearFilters();
            change({ sort: "manual" });
          }}
        />
        <div className="collection-heading">
          <p
            aria-label={t("countLabel")}
            className="collection-count"
            role="status"
          >
            {tasks.data && !changingQuery
              ? t("count", { count: items.length })
              : ""}
          </p>
        </div>
        <div className="visually-hidden">
          <h2 id="task-list-heading">{t("all")}</h2>
        </div>
        {tasks.isPending || changingQuery ? (
          <LoadingState label={t("loading")} />
        ) : null}
        {tasks.isError ? (
          <ErrorNotice
            error={tasks.error}
            onRefresh={() =>
              void (tasks.isFetchNextPageError
                ? tasks.fetchNextPage()
                : tasks.refresh())
            }
          />
        ) : null}
        {!changingQuery &&
        !tasks.isError &&
        range === null &&
        tasks.data?.items.length === 0 &&
        !filtered ? (
          <>
            <EmptyState
              description={t("emptyDescription")}
              title={t("emptyTitle")}
            />
            <div className="quick-add-item quick-add-empty">
              <AddTaskRow
                dayLabel={
                  view === "by-day" ? todos("noDueDateGroup") : undefined
                }
                dueOn={null}
                onMore={setAdding}
                onRefresh={refresh}
                slots={composer}
              />
            </div>
          </>
        ) : null}
        {!changingQuery &&
        !tasks.isError &&
        range === null &&
        tasks.data &&
        items.length === 0 &&
        filtered ? (
          <div className="collection-empty">
            <EmptyState
              description={t("noMatchDescription")}
              title={t("noMatchTitle")}
            />
            <button
              className="button button-secondary"
              onClick={() => {
                setQuery("");
                clearFilters();
              }}
              type="button"
            >
              {controls("clearFilters")}
            </button>
            <div className="quick-add-item quick-add-empty">
              <AddTaskRow
                dayLabel={
                  view === "by-day" ? todos("noDueDateGroup") : undefined
                }
                dueOn={null}
                onMore={setAdding}
                onRefresh={refresh}
                slots={composer}
              />
            </div>
          </div>
        ) : null}
        {listShown ? (
          <TaskListView
            canEdit
            composer={composer}
            contexts={tasks.data?.contexts}
            finishedAfter={
              show === "all" && finishedListed > 0 ? (
                <FinishedHead
                  count={finishedListed}
                  onHide={() => change({ show: "open" })}
                />
              ) : undefined
            }
            foot={finishedFoot ?? undefined}
            labelNames={labels.data?.names}
            manual={sort === "manual"}
            onAddDetails={setAdding}
            onAddSubtask={addSubtask}
            personNames={persons.data?.names}
            onEdit={(id, start) => setEditing({ id, start })}
            onRefresh={refresh}
            parents={tasks.data?.parents ?? {}}
            period={period}
            progress={tasks.data?.progress ?? {}}
            tasks={items}
            view={view}
          />
        ) : null}
        {!changingQuery && range === null && tasks.hasNextPage ? (
          <button
            className="button button-secondary"
            disabled={tasks.isFetching}
            onClick={() => void tasks.fetchNextPage()}
            type="button"
          >
            {tasks.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
          </button>
        ) : null}
        {listShown ? null : finishedFoot}
      </section>
      {editing !== null ? (
        <TaskInspector
          key={editing.id}
          onClose={closeEditing}
          start={editing.start}
          taskId={editing.id}
        />
      ) : null}
      {phone ? (
        <SpaceAddSeal label={t("new")} onAdd={() => setAdding({})} />
      ) : null}
    </main>
  );
}
