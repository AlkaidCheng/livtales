"use client";

import {
  type EventComponentKind,
  type EventComponentView,
  eventComponentViewSchema,
  type NoteListQuery,
} from "@livtales/schemas";
import {
  keepPreviousData,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { tr } from "../../i18n/active-locale";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import { useForgetInaccessibleEventDrafts } from "../../lib/editor-draft-context";
import { componentKindLabel, viewOf } from "../../lib/event-components";
import { queryKeys, useEventWorkspaceQueries } from "../../lib/queries";
import { isTemporaryReadError } from "../../lib/query-errors";
import { type StoredChoices, useViewChoices } from "../../lib/view-choices";
import { DocumentsPanel } from "./documents-panel";
import { ItineraryPanel } from "./itinerary-panel";
import { NotesPanel } from "./notes-panel";
import { PeoplePanel } from "./people-panel";
import {
  CalendarPanel,
  ExpensesPanel,
  RemindersPanel,
  TasksPanel,
  TimelinePanel,
} from "./planning-panels";
import { useViewTab } from "./view-head";

function useProjection<T>(
  queryKey: readonly string[],
  load: (signal: AbortSignal) => Promise<T>,
  keepPrevious = false,
) {
  const { credential } = useAuthSession();
  return useQuery({
    queryKey,
    enabled: credential !== null,
    queryFn: ({ signal }) => load(signal),
    ...(keepPrevious ? { placeholderData: keepPreviousData } : {}),
  });
}

function Projection<T>(props: {
  readonly eventId: string;
  readonly queryKey: readonly string[];
  readonly load: (signal: AbortSignal) => Promise<T>;
  readonly label: string;
  /** Keeps the rows shown while another order of them loads. */
  readonly keepPrevious?: boolean;
  readonly children: (projection: T) => ReactNode;
}) {
  const query = useProjection(props.queryKey, props.load, props.keepPrevious);
  return <ProjectionResult {...props} query={query} />;
}

function ProjectionResult<T>({
  eventId,
  query,
  label,
  children,
}: {
  readonly eventId: string;
  readonly query: UseQueryResult<T>;
  readonly label: string;
  readonly children: (projection: T) => ReactNode;
}) {
  useForgetInaccessibleEventDrafts(
    eventId,
    query.isError && !isTemporaryReadError(query.error),
  );
  if (query.isPending)
    return (
      <LoadingState
        label={tr("views")("loading", { name: label.toLowerCase() })}
      />
    );
  return (
    <>
      {query.isError ? (
        <ErrorNotice
          error={query.error}
          onRefresh={() => void query.refetch()}
          isRefreshing={query.isFetching}
          refreshLabel="Refresh latest"
        />
      ) : null}
      {query.data !== undefined &&
      (!query.isError || isTemporaryReadError(query.error))
        ? children(query.data)
        : null}
    </>
  );
}

/** A component's own kept choices: a tab's layout (none for the kind's default) and the Notes order. */
type ComponentChoices = {
  readonly layout?: EventComponentView;
  readonly noteSort: NoteListQuery["sort"];
};

const defaultComponentChoices: ComponentChoices = { noteSort: "edited" };

function readComponentChoices(stored: StoredChoices): ComponentChoices {
  const layout = eventComponentViewSchema.safeParse(stored.layout);
  return {
    ...(layout.success ? { layout: layout.data } : {}),
    noteSort: stored.noteSort === "title" ? "title" : "edited",
  };
}

export function EventComponent({
  kind: storedKind,
  eventId,
  canEdit,
  view: storedView,
  onChangeView: onChangeLayout,
  isSavingView = false,
}: {
  readonly kind: EventComponentKind;
  readonly eventId: string;
  readonly canEdit: boolean;
  /** The layout's view for this component; the kind's default when absent. */
  readonly view?: EventComponentView | undefined;
  /** Records a chosen view in the layout; absent when the layout is read-only. */
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  readonly isSavingView?: boolean;
}) {
  const client = useApiClient();
  useForgetInaccessibleEventDrafts(eventId, !canEdit);
  // The Notes order is one of the choices the account keeps for the tab
  // or the page component; so is the layout of a tab, while a page
  // component's layout comes with the page (`view`).
  const tab = useViewTab();
  const [choices, change] = useViewChoices(
    defaultComponentChoices,
    readComponentChoices,
  );
  const noteSort = choices.noteSort;
  const setNoteSort = (sort: NoteListQuery["sort"]) =>
    change({ noteSort: sort });
  const kind = storedKind;
  const view = viewOf({
    kind,
    view: tab === null ? storedView : choices.layout,
  });
  const onChangeView =
    tab === null
      ? onChangeLayout
      : (layout: EventComponentView) => change({ layout });
  const label = componentKindLabel(kind);
  switch (kind) {
    case "todos":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.todos(eventId)}
          load={(signal) => client.withSignal(signal).getEventTodos(eventId)}
        >
          {(tasks) => (
            <TasksPanel
              eventId={eventId}
              canEdit={canEdit}
              isSavingView={isSavingView}
              onChangeView={onChangeView}
              sections={tasks.sections}
              tasks={tasks.items}
              view={view}
            />
          )}
        </Projection>
      );
    case "calendar":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.calendar(eventId)}
          load={(signal) => client.withSignal(signal).getEventCalendar(eventId)}
        >
          {(calendar) => (
            <CalendarPanel
              eventId={eventId}
              canEdit={canEdit}
              isSavingView={isSavingView}
              items={calendar.items}
              onChangeView={onChangeView}
              view={view}
            />
          )}
        </Projection>
      );
    case "timeline":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.timeline(eventId)}
          load={(signal) => client.withSignal(signal).getEventTimeline(eventId)}
        >
          {(timeline) => (
            <TimelinePanel
              canEdit={canEdit}
              eventId={eventId}
              timeline={timeline}
            />
          )}
        </Projection>
      );
    case "itinerary":
      return (
        <ItineraryProjection
          canEdit={canEdit}
          eventId={eventId}
          isSavingView={isSavingView}
          label={label}
          onChangeView={onChangeView}
          view={view}
        />
      );
    case "expenses":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.expenses(eventId)}
          load={(signal) => client.withSignal(signal).getEventExpenses(eventId)}
        >
          {(expenses) => (
            <ExpensesPanel
              eventId={eventId}
              canEdit={canEdit}
              expenses={expenses.items}
              isSavingView={isSavingView}
              onChangeView={onChangeView}
              sections={expenses.sections}
              view={view}
            />
          )}
        </Projection>
      );
    case "reminders":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.reminders(eventId)}
          load={(signal) =>
            client.withSignal(signal).getEventReminders(eventId)
          }
        >
          {(reminders) => (
            <RemindersPanel
              eventId={eventId}
              canEdit={canEdit}
              isSavingView={isSavingView}
              onChangeView={onChangeView}
              reminders={reminders.items}
              view={view}
            />
          )}
        </Projection>
      );
    case "files":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={[...queryKeys.event(eventId), "attachment-targets"]}
          load={(signal) =>
            client.withSignal(signal).getEventAttachmentTargets(eventId)
          }
        >
          {(targets) => (
            <DocumentsPanel
              event={targets.event}
              canEdit={canEdit}
              tasks={targets.tasks}
              expenses={targets.expenses}
            />
          )}
        </Projection>
      );
    case "people":
      return (
        <Projection
          eventId={eventId}
          label={label}
          queryKey={queryKeys.people(eventId)}
          load={(signal) => client.withSignal(signal).getEventPeople(eventId)}
        >
          {(people) => (
            <PeoplePanel
              canEdit={canEdit}
              eventId={eventId}
              persons={people.items}
            />
          )}
        </Projection>
      );
    case "notes":
      return (
        <Projection
          eventId={eventId}
          keepPrevious
          label={label}
          queryKey={queryKeys.notes(eventId, noteSort)}
          load={(signal) =>
            client.withSignal(signal).getEventNotes(eventId, { sort: noteSort })
          }
        >
          {(page) => (
            <NotesPanel
              canEdit={canEdit}
              eventId={eventId}
              notes={page.items}
              onChangeSort={setNoteSort}
              sort={noteSort}
            />
          )}
        </Projection>
      );
  }
}

function ItineraryProjection({
  label,
  ...props
}: Omit<Parameters<typeof ItineraryPanel>[0], "event" | "items" | "tasks"> & {
  readonly label: string;
}) {
  const client = useApiClient();
  const { eventId } = props;
  const itinerary = useProjection(queryKeys.itinerary(eventId), (signal) =>
    client.withSignal(signal).getEventItinerary(eventId),
  );
  const todos = useProjection(queryKeys.todos(eventId), (signal) =>
    client.withSignal(signal).getEventTodos(eventId),
  );
  return (
    <ProjectionResult eventId={eventId} label={label} query={itinerary}>
      {(itineraryPage) => (
        <ProjectionResult eventId={eventId} label={label} query={todos}>
          {(todoPage) => (
            <ItineraryComponent
              {...props}
              items={itineraryPage.items}
              tasks={todoPage.items}
            />
          )}
        </ProjectionResult>
      )}
    </ProjectionResult>
  );
}

/** The day sheet needs the event's own dates for the days it turns. */
function ItineraryComponent(
  props: Omit<Parameters<typeof ItineraryPanel>[0], "event">,
) {
  const { event } = useEventWorkspaceQueries(props.eventId, null);
  return (
    <ItineraryPanel
      {...props}
      event={
        event.data ?? {
          startsOn: null,
          endsOn: null,
          startsAt: null,
          endsAt: null,
        }
      }
    />
  );
}
