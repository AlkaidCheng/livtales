"use client";

import {
  ApiClientError,
  LivTalesApiClient,
  type DocumentFileInput,
} from "@livtales/api-client";
import type {
  AccessibleWorkspace,
  AssigneeProjectionResponse,
  DevelopmentSignInRequest,
  EventCreatePayload,
  EventContextCreatePayload,
  EventUpdatePayload,
  EventListQueryInput,
  EventListResponse,
  EventPlanningResourceResponse,
  TaskListQueryInput,
  TaskListResponse,
  LabelCreateRequest,
  PersonCreatePayload,
  PersonListQueryInput,
  PersonUpdatePayload,
  LabelUpdateRequest,
  EventResponse,
  ExpenseUpdatePayload,
  ObjectSearchQueryInput,
  ObjectSearchResponse,
  PermissionScopeUpdatePayload,
  PendingShareCreateRequest,
  PreferencesRequest,
  ReminderUpdatePayload,
  NoteListQuery,
  ObjectMoveRequestPayload,
  NoteUpdatePayload,
  SectionCreateRequest,
  SectionUpdateRequest,
  SessionResponse,
  ShareCreatePayload,
  WorkspaceMemberAddRequest,
  WorkspaceMemberRoleRequest,
  TaskResponse,
  TaskUpdatePayload,
  UserResponse,
} from "@livtales/schemas";
import { useRouter } from "next/navigation";
import { useCallback, useRef } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";

import {
  localeChoiceOf,
  readLocaleChoice,
  writeLocaleChoice,
} from "../i18n/locale-preference";
import { isLocale } from "../i18n/locales";
import { useApiClient } from "./api-context";
import { useCommandHistory } from "./command-history";
import { useForeignEvent } from "./event-scope";
import {
  commandDescription,
  commandHistoryKey,
  commandsKey,
  executeCommand,
  readCommandState,
  recordCommandHistory,
  rememberCommand,
  saveOnNewest,
  settledRecord,
} from "./commands";
import { personDisplayName } from "./person-fields";
import { useAuthSession } from "./auth-session";
import type { EventView } from "./event-views";
import { newId } from "./new-id";
import { mergeWorkspaceRecency } from "./workspace-recency";
import { invalidateResourceQueries } from "./resource-invalidation";

export const queryKeys = {
  events: ["events"] as const,
  event: (eventId: string) => ["event", eventId] as const,
  eventResource: (eventId: string) => ["event", eventId, "resource"] as const,
  objectResource: (objectId: string) =>
    ["object", objectId, "resource"] as const,
  detail: (eventId: string) => ["event", eventId, "detail"] as const,
  todos: (eventId: string) => ["event", eventId, "todos"] as const,
  calendar: (eventId: string) => ["event", eventId, "calendar"] as const,
  timeline: (eventId: string) => ["event", eventId, "timeline"] as const,
  itinerary: (eventId: string) => ["event", eventId, "itinerary"] as const,
  expenses: (eventId: string) => ["event", eventId, "expenses"] as const,
  reminders: (eventId: string) => ["event", eventId, "reminders"] as const,
  people: (eventId: string) => ["event", eventId, "people"] as const,
  assignees: (eventId: string) => ["event", eventId, "assignees"] as const,
  notes: (eventId: string, sort: NoteListQuery["sort"]) =>
    ["event", eventId, "notes", sort] as const,
  search: (input: ObjectSearchQueryInput) => ["search", input] as const,
  tasks: ["tasks"] as const,
  labels: ["labels"] as const,
  persons: ["persons"] as const,
  access: (eventId: string) => ["event", eventId, "access"] as const,
  shares: (eventId: string) => ["event", eventId, "shares"] as const,
  sections: (eventId: string) => ["event", eventId, "sections"] as const,
  personShares: (personId: string) => ["person", personId, "shares"] as const,
  userSearch: (query: string) => ["users", "search", query] as const,
  user: (username: string) => ["users", "by-username", username] as const,
  attachments: (parentObjectId: string) =>
    ["object", parentObjectId, "documents"] as const,
  session: ["session"] as const,
  friends: ["friends"] as const,
  members: ["members"] as const,
  spaceDeletion: ["members", "deletion"] as const,
  moveTargets: (eventId: string) =>
    ["event", eventId, "move", "targets"] as const,
  movePreview: (eventId: string, workspaceId: string) =>
    ["event", eventId, "move", "preview", workspaceId] as const,
  commands: commandsKey,
};

export function useDevelopmentSignIn() {
  const client = useApiClient();
  const { startSession } = useAuthSession();
  const adoptLocale = useAdoptAccountLocale();
  return useMutation({
    mutationFn: (input: DevelopmentSignInRequest) => client.signIn(input),
    onSuccess: async (session) => {
      adoptLocale(session.user);
      // The proxy set the session cookie; only the workspace is kept here.
      startSession({ workspaceId: session.workspace.id });
    },
  });
}

/**
 * The signed-in account's id, from the session already read or read now
 * alongside the session query; undefined when the session cannot be read.
 */
export async function sessionAccountId(
  client: LivTalesApiClient,
  cache: QueryClient,
): Promise<string | undefined> {
  try {
    const session = await cache.ensureQueryData({
      queryKey: queryKeys.session,
      queryFn: ({ signal }) => client.withSignal(signal).getSession(),
    });
    return session.user.id;
  } catch {
    return undefined;
  }
}

export function useSessionQuery() {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getSession(),
    queryKey: queryKeys.session,
  });
}

/**
 * Keeps the browser's language and the account's the same. An account
 * with a language puts it on this browser before the workspace renders;
 * an account without one learns the choice this browser already made, so
 * a language picked on the sign-in screen follows the person from then on.
 */
export function useAdoptAccountLocale() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  return useCallback(
    (user: Pick<UserResponse, "locale">) => {
      const browser = readLocaleChoice();
      if (user.locale !== null) {
        // A language this build does not speak leaves the browser's alone.
        if (!isLocale(user.locale)) return;
        const account = localeChoiceOf(user.locale);
        if (account === browser) return;
        writeLocaleChoice(account);
        router.refresh();
        return;
      }
      if (browser === "system") return;
      void client
        .updatePreferences({ locale: browser })
        .then((updated) => {
          queryClient.setQueryData<SessionResponse>(
            queryKeys.session,
            (session) =>
              session === undefined ? session : { ...session, user: updated },
          );
        })
        .catch(() => {
          // The account keeps no language for now; the browser's still applies.
        });
    },
    [client, queryClient, router],
  );
}

/**
 * Changes the preferences kept on the account. The session reflects the
 * change at once and again from the server's reply; a refusal puts the
 * previous values back.
 */
export function useUpdatePreferences() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: PreferencesRequest) => client.updatePreferences(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.session });
      const previous = queryClient.getQueryData<SessionResponse>(
        queryKeys.session,
      );
      if (previous !== undefined)
        queryClient.setQueryData<SessionResponse>(queryKeys.session, {
          ...previous,
          user: {
            ...previous.user,
            ...(input.locale !== undefined && { locale: input.locale }),
            ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
            ...(input.hourCycle !== undefined && {
              hourCycle: input.hourCycle,
            }),
            ...(input.weekStart !== undefined && {
              weekStart: input.weekStart,
            }),
            ...(input.rail !== undefined && { rail: input.rail ?? {} }),
            ...(input.changeNotices !== undefined && {
              changeNotices: input.changeNotices ?? true,
            }),
            ...(input.workspaceRecency !== undefined && {
              workspaceRecency: mergeWorkspaceRecency(
                previous.user.workspaceRecency,
                input.workspaceRecency,
              ),
            }),
          },
        });
      return { previous };
    },
    onError: (_error, _input, context) => {
      if (context?.previous !== undefined)
        queryClient.setQueryData(queryKeys.session, context.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<SessionResponse>(queryKeys.session, (session) =>
        session === undefined ? session : { ...session, user: updated },
      );
    },
  });
}

/**
 * Notes on the account that a workspace was just opened, for the switcher's
 * order. The note goes through a client of its own, since the session's
 * client cancels its requests when the workspace changes again and the
 * note must reach the account regardless. A session read that began
 * before the note answers without it, so a read still in flight is
 * waited for and the reply's instants are then put on whatever it
 * brought, merged because two quick notes may answer in either order. A
 * failed note leaves the order as it was.
 */
export function useNoteWorkspaceOpened() {
  const { credential } = useAuthSession();
  const queryClient = useQueryClient();
  return useCallback(
    (workspaceId: string) => {
      if (credential === null) return;
      const client = new LivTalesApiClient({
        getCredential: () => credential,
      });
      void client
        .updatePreferences({
          workspaceRecency: { [workspaceId]: new Date().toISOString() },
        })
        .then(async (updated) => {
          if (
            queryClient.getQueryState(queryKeys.session)?.fetchStatus ===
            "fetching"
          )
            await queryClient.invalidateQueries({
              queryKey: queryKeys.session,
            });
          queryClient.setQueryData<SessionResponse>(
            queryKeys.session,
            (session) =>
              session === undefined
                ? session
                : {
                    ...session,
                    user: {
                      ...session.user,
                      workspaceRecency: {
                        ...session.user.workspaceRecency,
                        ...updated.workspaceRecency,
                      },
                    },
                  },
          );
        })
        .catch(() => {
          // The switcher keeps the order it had; the next switch notes again.
        });
    },
    [credential, queryClient],
  );
}

export function useEventsQuery(
  input: Omit<EventListQueryInput, "cursor">,
  enabled = true,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const queryClient = useQueryClient();
  const queryKey = [
    ...queryKeys.events,
    input,
    credential?.homeWorkspaceId,
    credential?.workspaceId,
  ];
  const result = useInfiniteQuery({
    enabled: enabled && credential !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.withSignal(signal).listEvents({
        ...input,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey,
    select: selectEventItems,
  });
  return {
    ...result,
    refresh: () => queryClient.resetQueries({ queryKey, exact: true }),
  };
}

function pageItems<T extends { readonly id: string }>(
  pages: readonly { readonly items: readonly T[] }[],
): T[] {
  const items = new Map(
    pages.flatMap((page) => page.items.map((item) => [item.id, item] as const)),
  );
  return [...items.values()];
}

function selectEventItems(data: InfiniteData<EventListResponse>) {
  return {
    items: pageItems(data.pages),
    asOf: data.pages[0]?.asOf,
    counts: data.pages[0]?.counts ?? null,
  };
}

function selectTaskItems(data: InfiniteData<TaskListResponse>) {
  const merged = <Key extends "contexts" | "progress" | "parents">(key: Key) =>
    Object.assign(
      {},
      ...data.pages.map((page) => page[key]),
    ) as TaskListResponse[Key];
  return {
    items: pageItems(data.pages),
    contexts: merged("contexts"),
    progress: merged("progress"),
    parents: merged("parents"),
    asOf: data.pages[0]?.asOf,
  };
}

/**
 * The client for the workspace a page's records live in: the session's, or
 * on an Event shared from another space, that space's.
 */
function usePageClient() {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const foreign = useForeignEvent();
  return foreign === null
    ? { client, workspaceId: credential?.workspaceId }
    : {
        client: client.inWorkspace(foreign.workspaceId),
        workspaceId: foreign.workspaceId,
      };
}

/** The workspace's labels in name order, by id and as a list. */
export function useLabelsQuery(enabled = true) {
  const { client, workspaceId } = usePageClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).listLabels(),
    queryKey: [...queryKeys.labels, workspaceId],
    select: (page) => ({
      items: page.items,
      names: new Map(page.items.map((label) => [label.id, label.name])),
    }),
  });
}

/** The workspace's people in name order, by id and as a list. */
export function usePersonsQuery(
  enabled = true,
  input: PersonListQueryInput = {},
) {
  const { client, workspaceId } = usePageClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).listPersons(input),
    queryKey: [...queryKeys.persons, workspaceId, input],
    select: (page) => ({
      items: page.items,
      names: new Map(
        page.items.map((person) => [person.id, personDisplayName(person)]),
      ),
    }),
  });
}

/**
 * Person names by id, for naming assignees: the people the viewer may
 * open, and on an Event shared from another space, the assignees its tasks
 * name, whose cards there may stay closed to the viewer.
 */
export function usePersonNames(
  enabled = true,
): ReadonlyMap<string, string> | undefined {
  const client = useApiClient();
  const foreign = useForeignEvent();
  const people = usePersonsQuery(enabled).data?.names;
  const assignees = useQuery({
    enabled: enabled && foreign !== null,
    queryFn: ({ signal }) =>
      client.withSignal(signal).getEventAssignees(foreign?.eventId ?? ""),
    queryKey: queryKeys.assignees(foreign?.eventId ?? ""),
    select: (projection) =>
      new Map(
        projection.items.map((person) => [
          person.id,
          personDisplayName(person),
        ]),
      ),
  }).data;
  if (assignees === undefined) return people;
  if (people === undefined) return assignees;
  // The people keep their order, the assignees closed to the viewer after.
  return new Map([...people, ...assignees]);
}

/**
 * Creates a person on its own. An unchanged retry after a lost response
 * reuses the same command id, so the API returns the person it already
 * created instead of a second one.
 */
export function useCreatePerson(retainedAttempt?: ContextCreateAttempt) {
  const client = useApiClient();
  const invalidate = useResourceInvalidation();
  const localAttempt = useRef<ContextCreateAttempt["current"]>(null);
  const attempt = retainedAttempt ?? localAttempt;
  return useMutation({
    mutationFn: (input: PersonCreatePayload) =>
      client.createPerson({
        ...input,
        commandId: commandFor(attempt, { person: input }),
      }),
    onSuccess: (saved) => {
      attempt.current = null;
      void invalidate(saved);
    },
  });
}

/**
 * Creates the person a task is assigned to, or for the signed-in user
 * (`userId`) finds theirs. On an Event shared from another space, a new
 * person is added inside that Event, the one place there a guest may add
 * people, and the user's own is found there even where the guest may not
 * open it; elsewhere, a person is created in the workspace on its own. An
 * unchanged retry after a lost response reuses the same command id.
 */
export function useCreateAssignee() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const foreign = useForeignEvent();
  const invalidate = useResourceInvalidation();
  const attempt = useRef<ContextCreateAttempt["current"]>(null);
  return useMutation({
    mutationFn: async (input: {
      readonly displayName: string;
      readonly userId?: string;
    }): Promise<{ readonly id: string; readonly objectType: "person" }> => {
      if (foreign === null) {
        const person = await client.createPerson({
          ...input,
          commandId: commandFor(attempt, { person: input }),
        });
        return { id: person.id, objectType: "person" };
      }
      if (input.userId !== undefined) {
        const self = await client.assignEventSelf(foreign.eventId, {
          commandId: commandFor(attempt, { self: foreign.eventId, input }),
          displayName: input.displayName,
        });
        // The chip names them at once, before the task that names them is
        // saved, even when their card stays closed to the guest.
        queryClient.setQueryData<AssigneeProjectionResponse>(
          queryKeys.assignees(foreign.eventId),
          (current) =>
            current === undefined ||
            current.items.some(({ id }) => id === self.id)
              ? current
              : { ...current, items: [...current.items, self] },
        );
        return { id: self.id, objectType: "person" };
      }
      const resource = { ...input, objectType: "person" as const };
      const result = await client.createEventResource(foreign.eventId, {
        commandId: commandFor(attempt, { eventId: foreign.eventId, resource }),
        resource,
      });
      return { id: result.resource.id, objectType: "person" };
    },
    onSuccess: (saved) => {
      attempt.current = null;
      void invalidate(saved);
    },
  });
}

/** The command id of an unchanged attempt, or a fresh one for new input. */
function commandFor(attempt: ContextCreateAttempt, input: unknown): string {
  const key = JSON.stringify(input);
  if (attempt.current?.key !== key)
    attempt.current = { key, commandId: newId() };
  return attempt.current.commandId;
}

/** Creates a person inside an Event: the person and its inclusion in one command. */
export function useCreatePersonInEvent(
  eventId: string,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "person", attempt);
}

/** Includes a person the workspace already knows in an Event. */
export function useIncludePerson(eventId: string) {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (personId: string) =>
      client.createRelation(eventId, {
        relationType: "includes",
        targetObjectId: personId,
      }),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdatePerson() {
  const client = useApiClient();
  const invalidate = useResourceInvalidation();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: PersonUpdatePayload;
    }) =>
      (
        await saveOnNewest(
          (expectedVersion) =>
            client.updatePerson(id, { ...input, expectedVersion }),
          input.expectedVersion,
          async () => (await client.getPerson(id)).version,
        )
      ).result,
    onSuccess: (saved, { input }) => {
      void invalidate(saved, input);
    },
  });
}

export function useCreateLabel() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (input: LabelCreateRequest) => client.createLabel(input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateLabel() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: LabelUpdateRequest }) =>
      client.updateLabel(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useDeleteLabel() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({
      id,
      expectedVersion,
    }: {
      id: string;
      expectedVersion: number;
    }) => client.deleteLabel(id, expectedVersion),
    onSuccess: () => {
      void invalidate();
    },
  });
}

/**
 * A section of an Event's To-dos or Expenses. Each write refreshes the
 * Event's projections, which carry the sections and each record's section.
 */
export function useCreateSection(eventId: string) {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (input: SectionCreateRequest) =>
      client.createSection(eventId, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateSection() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SectionUpdateRequest }) =>
      client.updateSection(id, input),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useDeleteSection() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (id: string) => client.deleteSection(id),
    onSuccess: () => {
      void invalidate();
    },
  });
}

/** The workspace Task collection: every task the user may view, page by page. */
export function useTasksQuery(
  input: Omit<TaskListQueryInput, "cursor">,
  enabled = true,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const queryClient = useQueryClient();
  const queryKey = [
    ...queryKeys.tasks,
    input,
    credential?.homeWorkspaceId,
    credential?.workspaceId,
  ];
  const result = useInfiniteQuery({
    enabled: enabled && credential !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.withSignal(signal).listTasks({
        ...input,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey,
    select: selectTaskItems,
  });
  return {
    ...result,
    refresh: () => queryClient.resetQueries({ queryKey, exact: true }),
  };
}

function selectSearchItems(data: InfiniteData<ObjectSearchResponse>) {
  return { items: pageItems(data.pages) };
}

export function useObjectSearch(
  input: Omit<ObjectSearchQueryInput, "cursor"> | null,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useInfiniteQuery({
    enabled: credential !== null && input !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      if (input === null) {
        throw new Error("Search input is required.");
      }
      return client.withSignal(signal).searchObjects({
        ...input,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      });
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    queryKey: [
      ...(input === null ? ["search", "idle"] : queryKeys.search(input)),
      credential?.homeWorkspaceId,
      credential?.workspaceId,
    ],
    select: selectSearchItems,
  });
}

export function useEventWorkspaceQueries(
  eventId: string,
  activeView: EventView | null,
  refetchOnMount: true | "always" = true,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const event = useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getEvent(eventId),
    queryKey: queryKeys.eventResource(eventId),
    refetchOnMount,
  });
  const detail = useQuery({
    enabled:
      credential !== null &&
      (activeView === "overview" || activeView === "sharing"),
    queryFn: ({ signal }) => client.withSignal(signal).getEventDetail(eventId),
    queryKey: queryKeys.detail(eventId),
  });
  const access = useEventAccessQuery(eventId, refetchOnMount);
  return { event, detail, access };
}

/** The sections of an Event's To-dos and Expenses together, to name a share narrowed to one. */
export function useEventSectionsQuery(eventId: string, enabled: boolean) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null,
    queryFn: async ({ signal }) => {
      const reader = client.withSignal(signal);
      const [todos, expenses] = await Promise.all([
        reader.listSections(eventId, "todos"),
        reader.listSections(eventId, "expenses"),
      ]);
      return [...todos.items, ...expenses.items];
    },
    queryKey: queryKeys.sections(eventId),
  });
}

export function useSharesQuery(eventId: string, enabled: boolean) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).listShares(eventId),
    queryKey: queryKeys.shares(eventId),
  });
}

/** What is shared each way with a person, for the person's page. */
export function usePersonSharesQuery(personId: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) =>
      client.withSignal(signal).listPersonShares(personId),
    queryKey: queryKeys.personShares(personId),
  });
}

export function useTaskEditorQueries(taskId: string) {
  const { resource: task, access } = useObjectEditorQueries(
    taskId,
    (client, id) => client.getTask(id),
  );
  return { task, access };
}

export function useExpenseEditorQueries(expenseId: string) {
  const { resource: expense, access } = useObjectEditorQueries(
    expenseId,
    (client, id) => client.getExpense(id),
  );
  return { expense, access };
}

export function usePersonEditorQueries(personId: string) {
  const { resource: person, access } = useObjectEditorQueries(
    personId,
    (client, id) => client.getPerson(id),
  );
  return { person, access };
}

/**
 * The Events a person is part of: the live "includes" links that point at
 * the person, then each Event as the user may read it (one they may not
 * is left out), in date order with the undated last.
 */
export function usePersonEventsQuery(personId: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: async ({ signal }) => {
      const scoped = client.withSignal(signal);
      const links = await scoped.listObjectRelations(personId, {
        direction: "incoming",
        relationType: "includes",
        limit: 50,
      });
      const events = await Promise.allSettled(
        links.items.map((link) => scoped.getEvent(link.sourceObjectId)),
      );
      const items = events.flatMap((event) =>
        event.status === "fulfilled" ? [event.value] : [],
      );
      const startOf = (event: EventResponse) =>
        event.startsOn ?? event.startsAt ?? "~";
      return {
        items: items.sort(
          (a, b) =>
            startOf(a).localeCompare(startOf(b)) || a.id.localeCompare(b.id),
        ),
      };
    },
    queryKey: [...queryKeys.objectResource(personId), "events"],
  });
}

export function useNoteEditorQueries(noteId: string) {
  const { resource: note, access } = useObjectEditorQueries(
    noteId,
    (client, id) => client.getNote(id),
  );
  return { note, access };
}

export function useReminderEditorQueries(reminderId: string) {
  const { resource: reminder, access } = useObjectEditorQueries(
    reminderId,
    (client, id) => client.getReminder(id),
  );
  return { reminder, access };
}

function useObjectEditorQueries<Resource>(
  id: string,
  read: (client: LivTalesApiClient, id: string) => Promise<Resource>,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  const resource = useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => read(client.withSignal(signal), id),
    queryKey: queryKeys.objectResource(id),
    refetchOnMount: "always",
  });
  const access = useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).getObjectAccess(id),
    queryKey: queryKeys.access(id),
    refetchOnMount: "always",
  });
  return { resource, access };
}

/** Refreshes an Event's reads, or the workspace collections when no Event is given. */
export function useRefreshEvent(
  eventId: string | undefined,
  options: { readonly throwOnError?: boolean } = {},
) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      eventId === undefined
        ? queryClient.invalidateQueries({ queryKey: queryKeys.tasks }, options)
        : queryClient.invalidateQueries(
            { queryKey: queryKeys.event(eventId) },
            options,
          ),
      queryClient.invalidateQueries({ queryKey: queryKeys.events }, options),
    ]);
  };
}

/** Gives up the account's grants on an Event: the grantee's way out of a share. */
export function useLeaveEventMutation() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (eventId: string) => client.leaveObject(eventId),
    onSettled: () => void invalidate(),
  });
}

export function useCanonicalInvalidation() {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      predicate: (query) =>
        [
          "event",
          "events",
          "object",
          "search",
          "tasks",
          "labels",
          "persons",
          "trash",
        ].includes(String(query.queryKey[0])),
    });
}

function useResourceInvalidation() {
  const queryClient = useQueryClient();
  const { signal } = useAuthSession();
  const invalidate = useCanonicalInvalidation();
  return (
    resource: Pick<EventPlanningResourceResponse, "id" | "objectType">,
    input?: { readonly metadata?: unknown; readonly sectionId?: unknown },
  ) => {
    if (signal.aborted) return Promise.resolve();
    // Section membership and metadata can affect inherited visibility.
    if (input && ("sectionId" in input || "metadata" in input))
      return invalidate();
    return invalidateResourceQueries(queryClient, resource);
  };
}

export function useDocumentAttachments(parentObjectId: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null,
    queryFn: ({ signal }) =>
      client.withSignal(signal).listDocumentAttachments(parentObjectId),
    queryKey: queryKeys.attachments(parentObjectId),
  });
}

export function useAttachDocument(parentObjectId: string) {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (file: DocumentFileInput) =>
      client.attachDocument(parentObjectId, file),
    onSuccess: invalidate,
  });
}

export function useDownloadDocument() {
  const client = useApiClient();
  return useMutation({
    mutationFn: (documentId: string) => client.downloadDocument(documentId),
  });
}

export function useCreateEvent() {
  const client = useApiClient();
  const invalidate = useResourceInvalidation();
  return useMutation({
    mutationFn: (input: EventCreatePayload) => client.createEvent(input),
    onSuccess: (saved) => {
      void invalidate(saved);
    },
  });
}

/**
 * Content edits of Events and Tasks run as reversible commands, so the
 * page's Undo edit can take them back; the saved record is read back after
 * the receipt. A patch that carries metadata is not a content edit and goes
 * through the plain update.
 */
export function useUpdateEvent() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { credential, signal } = useAuthSession();
  const invalidate = useResourceInvalidation();
  return useMutation({
    mutationFn: async ({
      id,
      workspaceId,
      input,
    }: {
      id: string;
      /** The Event's own workspace, where its commands are kept. */
      workspaceId: string;
      input: EventUpdatePayload;
    }) => {
      const newest = async () => (await client.getEvent(id)).version;
      if (input.metadata !== undefined)
        return (
          await saveOnNewest(
            (expectedVersion) =>
              client.updateEvent(id, { ...input, expectedVersion }),
            input.expectedVersion,
            newest,
          )
        ).result;
      const { metadata: _, ...patch } = input;
      const history = recordCommandHistory(
        { id, workspaceId },
        credential?.workspaceId,
      );
      const { result: receipt, rebased } = await saveOnNewest(
        (expectedVersion) =>
          executeCommand(
            client,
            queryClient,
            {
              objectType: "event",
              objectId: id,
              patch: { ...patch, expectedVersion },
            },
            history,
          ),
        input.expectedVersion,
        newest,
      );
      // A save sent again on a newer version reads the record back, since
      // the copy on hand lacks what changed meanwhile.
      const saved =
        (rebased
          ? null
          : settledRecord(
              queryClient.getQueryData<EventResponse>(
                queryKeys.eventResource(id),
              ),
              patch,
              receipt,
            )) ?? (await client.getEvent(id));
      rememberCommand(
        receipt.commandId,
        commandDescription(input, saved.displayName),
      );
      return saved;
    },
    onSuccess: async (saved, { input }) => {
      const queryKey = queryKeys.eventResource(saved.id);
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (signal.aborted) return;
      queryClient.setQueryData<EventResponse>(queryKey, (current) =>
        current && current.version > saved.version ? current : saved,
      );
      void invalidate(saved, input);
    },
  });
}

/** The caller's actions on an Event; nothing is read without an Event. */
export function useEventAccessQuery(
  eventId: string | undefined,
  refetchOnMount: true | "always" = true,
) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: credential !== null && eventId !== undefined,
    queryFn: ({ signal }) =>
      client.withSignal(signal).getObjectAccess(eventId ?? ""),
    queryKey: queryKeys.access(eventId ?? ""),
    refetchOnMount,
  });
}

/**
 * The caller's actions on an Event as the page has read them, without a
 * read of its own: a control inside a view follows the event page's
 * access, and reads nothing when shown on its own.
 */
export function useKnownEventAccess(eventId: string | undefined) {
  const client = useApiClient();
  return useQuery({
    enabled: false,
    queryFn: ({ signal }) =>
      client.withSignal(signal).getObjectAccess(eventId ?? ""),
    queryKey: queryKeys.access(eventId ?? ""),
  });
}

export function useShareResource(eventId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (input: Omit<ShareCreatePayload, "resourceId">) =>
      client.shareResource({ ...input, resourceId: eventId }),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
        queryClient.invalidateQueries({ queryKey: ["person"] }),
      ]);
    },
  });
}

export function useRevokeShare() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (grantId: string) => client.revokeShare(grantId),
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
        queryClient.invalidateQueries({ queryKey: ["person"] }),
      ]);
    },
  });
}

/** Queues a share for a person without an account here; the invitation goes out when none waits. */
export function useQueuePendingShare(eventId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PendingShareCreateRequest, "resourceId">) =>
      client.queuePendingShare({ ...input, resourceId: eventId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.shares(eventId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.friends }),
        queryClient.invalidateQueries({ queryKey: ["person"] }),
      ]);
    },
  });
}

export function useRevokePendingShare(eventId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pendingId: string) => client.revokePendingShare(pendingId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.shares(eventId) }),
        queryClient.invalidateQueries({ queryKey: ["person"] }),
      ]);
    },
  });
}

/** The members of the current workspace, for any member. */
export function useWorkspaceMembersQuery(enabled = true) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useQuery({
    enabled: enabled && credential !== null,
    queryFn: ({ signal }) => client.withSignal(signal).listWorkspaceMembers(),
    queryKey: queryKeys.members,
  });
}

function useMembersMutation<Input, Output>(
  run: (
    client: ReturnType<typeof useApiClient>,
    input: Input,
  ) => Promise<Output>,
) {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: (input: Input) => run(client, input),
    // The session lists each space with the account's role in it.
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.members }),
        queryClient.invalidateQueries({ queryKey: queryKeys.session }),
        invalidate(),
      ]);
    },
  });
}

export function useAddWorkspaceMember() {
  return useMembersMutation((client, input: WorkspaceMemberAddRequest) =>
    client.addWorkspaceMember(input),
  );
}

export function useRemoveWorkspaceMember() {
  return useMembersMutation((client, userId: string) =>
    client.removeWorkspaceMember(userId),
  );
}

/** Changes a member's role; the space keeps at least one Owner. */
export function useChangeWorkspaceMemberRole() {
  return useMembersMutation(
    (client, input: { readonly userId: string } & WorkspaceMemberRoleRequest) =>
      client.changeWorkspaceMemberRole(input.userId, { role: input.role }),
  );
}

/** A space just created, and the friends among those chosen that could not be added to it. */
export interface CreatedSpace {
  readonly space: AccessibleWorkspace;
  readonly unadded: readonly string[];
}

/**
 * Creates a shared space with the account as its Owner, then adds the
 * chosen friends to it with their roles. A friend who cannot be added
 * leaves the space in place and is reported, so the space is not lost.
 */
export function useCreateSpace() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      readonly displayName: string;
      readonly members: readonly WorkspaceMemberAddRequest[];
    }): Promise<CreatedSpace> => {
      const space = await client.createWorkspace({
        displayName: input.displayName,
      });
      const inSpace = client.inWorkspace(space.id);
      const unadded: string[] = [];
      for (const member of input.members) {
        try {
          await inSpace.addWorkspaceMember(member);
        } catch {
          unadded.push(member.friendId);
        }
      }
      return { space, unadded };
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

/** Renames the current space; its new name shows wherever the session lists it. */
export function useRenameSpace() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (displayName: string) =>
      client.updateWorkspace({ displayName }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.session }),
  });
}

/** Leaves the current space; the caller then opens another one. */
export function useLeaveSpace() {
  const client = useApiClient();
  return useMutation({ mutationFn: () => client.leaveWorkspace() });
}

/** Whether the current space can be deleted, and why not; for its Owners. */
export function useSpaceDeletionQuery(enabled: boolean) {
  const client = useApiClient();
  return useQuery({
    enabled,
    queryFn: ({ signal }) => client.withSignal(signal).getWorkspaceDeletion(),
    queryKey: queryKeys.spaceDeletion,
    staleTime: 0,
  });
}

/** Deletes the current space with its Trash; the caller then opens another one. */
export function useDeleteSpace() {
  const client = useApiClient();
  return useMutation({ mutationFn: () => client.deleteWorkspace() });
}

/** The spaces an Event can move to, for its Owner's Move to space dialog. */
export function useMoveTargetsQuery(eventId: string) {
  const client = useApiClient();
  return useQuery({
    queryFn: ({ signal }) => client.withSignal(signal).listMoveTargets(eventId),
    queryKey: queryKeys.moveTargets(eventId),
    staleTime: 0,
  });
}

/** What moving the Event into the space would carry and drop; fetched fresh each time. */
export function useMovePreviewQuery(
  eventId: string,
  workspaceId: string | null,
) {
  const client = useApiClient();
  return useQuery({
    enabled: workspaceId !== null,
    queryFn: ({ signal }) =>
      client.withSignal(signal).previewMove(eventId, workspaceId ?? ""),
    queryKey: queryKeys.movePreview(eventId, workspaceId ?? ""),
    staleTime: 0,
  });
}

/** Moves the Event into another space; the caller then opens that space. */
export function useMoveEvent(eventId: string) {
  const client = useApiClient();
  return useMutation({
    mutationFn: (input: ObjectMoveRequestPayload) =>
      client.moveObject(eventId, input),
  });
}

export function useUpdatePermissionScope() {
  const client = useApiClient();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: PermissionScopeUpdatePayload;
    }) => client.updatePermissionScope(id, input),
    onSuccess: invalidate,
  });
}

type ContextResource = EventContextCreatePayload["resource"];

/** Retains the identity of an unchanged linked-create retry. */
export interface ContextCreateAttempt {
  current: { readonly key: string; readonly commandId: string } | null;
}

// Without an Event the resource is created on its own; only Tasks live
// outside an Event today.
function useCreateInContext<Type extends ContextResource["objectType"]>(
  eventId: string | undefined,
  objectType: Type,
  retainedAttempt?: ContextCreateAttempt,
) {
  type Input = Omit<
    Extract<ContextResource, { objectType: Type }>,
    "objectType"
  >;
  const client = useApiClient();
  const invalidate = useResourceInvalidation();
  const localAttempt = useRef<ContextCreateAttempt["current"]>(null);
  const attempt = retainedAttempt ?? localAttempt;
  return useMutation({
    mutationFn: async (input: Input) => {
      const resource = { ...input, objectType } as Extract<
        ContextResource,
        { objectType: Type }
      >;
      if (eventId === undefined) {
        if (resource.objectType !== "task")
          throw new Error("Only a Task can be created outside an Event.");
        const { objectType: _type, ...payload } = resource as Extract<
          ContextResource,
          { objectType: "task" }
        >;
        return client.createTask({
          ...payload,
          commandId: commandFor(attempt, { standalone: resource }),
        });
      }
      const result = await client.createEventResource(eventId, {
        commandId: commandFor(attempt, { eventId, resource }),
        resource,
      });
      return result.resource;
    },
    onSuccess: (saved) => {
      attempt.current = null;
      // A confirmed write settles independently of projection refreshes.
      void invalidate(saved);
    },
  });
}

export function useCreateScheduledEvent(
  eventId: string,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "event", attempt);
}

export function useCreateTask(
  eventId: string | undefined,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "task", attempt);
}

export function useUpdateTask() {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const { credential } = useAuthSession();
  const invalidate = useResourceInvalidation();
  return useMutation({
    mutationFn: async ({
      id,
      workspaceId,
      input,
    }: {
      id: string;
      /** The Task's own workspace, where its commands are kept. */
      workspaceId: string;
      input: TaskUpdatePayload;
    }) => {
      const newest = async () => (await client.getTask(id)).version;
      if (input.metadata !== undefined)
        return (
          await saveOnNewest(
            (expectedVersion) =>
              client.updateTask(id, { ...input, expectedVersion }),
            input.expectedVersion,
            newest,
          )
        ).result;
      const { metadata: _, ...patch } = input;
      const history = recordCommandHistory(
        { id, workspaceId },
        credential?.workspaceId,
      );
      const { result: receipt, rebased } = await saveOnNewest(
        (expectedVersion) =>
          executeCommand(
            client,
            queryClient,
            {
              objectType: "task",
              objectId: id,
              patch: { ...patch, expectedVersion },
            },
            history,
          ),
        input.expectedVersion,
        newest,
      );
      // A save sent again on a newer version reads the record back, since
      // the copy on hand lacks what changed meanwhile.
      const saved =
        (rebased
          ? null
          : settledRecord(
              queryClient.getQueryData<TaskResponse>(
                queryKeys.objectResource(id),
              ),
              patch,
              receipt,
            )) ?? (await client.getTask(id));
      rememberCommand(
        receipt.commandId,
        commandDescription(input, saved.displayName),
      );
      return saved;
    },
    onSuccess: (saved, { input }) => {
      queryClient.setQueryData<TaskResponse>(
        queryKeys.objectResource(saved.id),
        (current) =>
          current && current.version > saved.version ? current : saved,
      );
      void invalidate(saved, input);
    },
  });
}

/** The caller's undo and redo heads on the stack this page's Undo edit acts on. */
export function useCommandState() {
  const client = useApiClient();
  const history = useCommandHistory();
  return useQuery({
    enabled: history !== null,
    queryFn: ({ signal }) =>
      client.withSignal(signal).getCommandState(history?.objectId),
    queryKey: commandHistoryKey(history),
  });
}

/**
 * Reverses or reapplies the pinned head. A head that is gone or unreachable
 * reports a stack conflict; the refreshed state then shows why.
 */
export function useCommandTransition(direction: "undo" | "redo") {
  const client = useApiClient();
  const queryClient = useQueryClient();
  const history = useCommandHistory();
  const invalidate = useCanonicalInvalidation();
  return useMutation({
    mutationFn: async () => {
      if (history === null)
        throw new ApiClientError(401, "unauthenticated", "Sign in again.");
      const state = await readCommandState(client, queryClient, history);
      const head = state[direction];
      if (head === null || !head.available)
        throw new ApiClientError(
          409,
          "command_stack_conflict",
          "The command stack changed. Refresh before undoing or redoing.",
        );
      const input = {
        operationId: newId(),
        commandId: head.commandId,
        expectedStackVersion: state.version,
      };
      return direction === "undo"
        ? client.undoCommand(input, history.objectId)
        : client.redoCommand(input, history.objectId);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.commands });
      void invalidate();
    },
  });
}

/**
 * Creates a copy of a task at a given place in manual order: its fields and
 * labels, not its subtasks, inside the same Event when it has one.
 */
export function useDuplicateTask() {
  const client = useApiClient();
  const invalidate = useResourceInvalidation();
  return useMutation({
    mutationFn: async ({
      eventId,
      rank,
      task,
    }: {
      readonly eventId: string | undefined;
      readonly rank: string;
      readonly task: TaskResponse;
    }) => {
      const fields = {
        displayName: `${task.displayName} (copy)`.slice(0, 240),
        dueOn: task.dueOn,
        dueAt: task.dueAt,
        durationMinutes: task.durationMinutes,
        repeatRule: task.repeatRule,
        repeatUntil: task.repeatUntil,
        parentTaskId: task.parentTaskId,
        assigneeId: task.assigneeId,
        location: task.location,
        labelIds: [...task.labelIds],
        rank,
      };
      if (eventId === undefined)
        return client.createTask({ ...fields, commandId: newId() });
      const result = await client.createEventResource(eventId, {
        commandId: newId(),
        resource: { objectType: "task", ...fields },
      });
      return result.resource;
    },
    onSuccess: (saved) => {
      void invalidate(saved);
    },
  });
}

export function useCreateExpense(
  eventId: string,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "expense", attempt);
}

export function useUpdateExpense() {
  const client = useApiClient();
  const invalidate = useResourceInvalidation();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: ExpenseUpdatePayload;
    }) =>
      (
        await saveOnNewest(
          (expectedVersion) =>
            client.updateExpense(id, { ...input, expectedVersion }),
          input.expectedVersion,
          async () => (await client.getExpense(id)).version,
        )
      ).result,
    onSuccess: (saved, { input }) => {
      void invalidate(saved, input);
    },
  });
}

export function useCreateReminder(
  eventId: string,
  attempt?: ContextCreateAttempt,
) {
  return useCreateInContext(eventId, "reminder", attempt);
}

/** Creates a note inside an Event: the note and its inclusion in one command. */
export function useCreateNote(eventId: string, attempt?: ContextCreateAttempt) {
  return useCreateInContext(eventId, "note", attempt);
}

export function useUpdateNote() {
  const client = useApiClient();
  const invalidate = useResourceInvalidation();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: NoteUpdatePayload;
    }) =>
      (
        await saveOnNewest(
          (expectedVersion) =>
            client.updateNote(id, { ...input, expectedVersion }),
          input.expectedVersion,
          async () => (await client.getNote(id)).version,
        )
      ).result,
    onSuccess: (saved, { input }) => {
      void invalidate(saved, input);
    },
  });
}

export function useUpdateReminder() {
  const client = useApiClient();
  const invalidate = useResourceInvalidation();
  return useMutation({
    mutationFn: async ({
      id,
      input,
    }: {
      id: string;
      input: ReminderUpdatePayload;
    }) =>
      (
        await saveOnNewest(
          (expectedVersion) =>
            client.updateReminder(id, { ...input, expectedVersion }),
          input.expectedVersion,
          async () => (await client.getReminder(id)).version,
        )
      ).result,
    onSuccess: (saved, { input }) => {
      void invalidate(saved, input);
    },
  });
}
