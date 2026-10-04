"use client";

import type { LivTalesApiClient } from "@livtales/api-client";
import type {
  EventLayoutResponse,
  EventLayoutRestore,
  EventLayoutWithViewResponse,
  EventPage,
  EventViewState,
  EventViewStateUpdate,
} from "@livtales/schemas";
import {
  useInfiniteQuery,
  useIsMutating,
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { useErrorMessage } from "../components/feedback";
import { useNotices } from "../components/notices";
import { useApiClient, useLeavingApiClient } from "./api-context";
import { useAuthSession } from "./auth-session";
import { saveOnNewest } from "./commands";
import { mayHoldKeptViews, moveKeptEventView } from "./kept-views";
import {
  advanceLayoutUndo,
  emptyLayoutUndo,
  type LayoutIntent,
  type LayoutUndoState,
} from "./layout-undo";
import { applyEventViewUpdate, resolveEventView } from "./personal-views";
import { queryKeys, sessionAccountId } from "./queries";

const layoutUpdateKey = (eventId: string) =>
  ["event-layout-update", eventId] as const;
const eventLayoutKey = (eventId: string) =>
  [...queryKeys.event(eventId), "layout"] as const;
const historyKey = (eventId: string) =>
  [...eventLayoutKey(eventId), "history"] as const;
const undoKey = (eventId: string) => ["layout-undo", eventId] as const;
const viewUpdateKey = (eventId: string) =>
  ["event-view-update", eventId] as const;

/**
 * How many saves of the account's view of each event have been taken
 * into the cache, per query cache: a read that began before one of them
 * answers with an older view.
 */
const viewSaves = new WeakMap<QueryClient, Map<string, number>>();

function viewSavesOf(cache: QueryClient, eventId: string): number {
  return viewSaves.get(cache)?.get(eventId) ?? 0;
}

function noteViewSave(cache: QueryClient, eventId: string): void {
  const saves = viewSaves.get(cache) ?? new Map<string, number>();
  saves.set(eventId, viewSavesOf(cache, eventId) + 1);
  viewSaves.set(cache, saves);
}

/** The account's view as the layout now stands, kept across a change of the layout. */
function keepView(
  layout: EventLayoutResponse,
  yours: EventViewState,
): EventLayoutWithViewResponse {
  return {
    ...layout,
    yours: resolveEventView(layout, yours.stored ? yours : null),
  };
}

async function acceptLayout(
  cache: QueryClient,
  layout: EventLayoutResponse,
  previousVersion: number | null,
  intent: LayoutIntent,
) {
  const key = eventLayoutKey(layout.eventId);
  await cache.cancelQueries({ queryKey: key, exact: true });
  const current = cache.getQueryData<EventLayoutWithViewResponse>(key);
  if (current && current.version > layout.version) return;
  // A layout read rather than written leaves the undo stacks as they are.
  if (previousVersion !== null)
    cache.setQueryData<LayoutUndoState>(undoKey(layout.eventId), (state) =>
      advanceLayoutUndo(
        state ?? emptyLayoutUndo,
        previousVersion,
        layout.version,
        intent,
      ),
    );
  // The layout routes answer with the event's layout alone; the account's
  // view of it is kept, as the new layout reads it.
  if (current === undefined)
    await cache.invalidateQueries({ queryKey: key, exact: true });
  else cache.setQueryData(key, keepView(layout, current.yours));
  await cache.invalidateQueries({ queryKey: historyKey(layout.eventId) });
}

/**
 * The undo and redo stacks of an event's layout, kept in the query cache
 * for the tab's lifetime. The mutations write it; the query is never
 * fetched, and its fetch function only names the empty state.
 */
export function useLayoutUndo(eventId: string) {
  return useQuery({
    queryKey: undoKey(eventId),
    queryFn: () => emptyLayoutUndo,
    initialData: emptyLayoutUndo,
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useEventLayoutHistory(eventId: string) {
  const client = useApiClient();
  const { credential } = useAuthSession();
  return useInfiniteQuery({
    enabled: credential !== null,
    queryKey: historyKey(eventId),
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam, signal }) =>
      client
        .withSignal(signal)
        .getEventLayoutHistory(
          eventId,
          pageParam === undefined ? {} : { beforeVersion: pageParam },
        ),
    getNextPageParam: (page) => page.nextBeforeVersion ?? undefined,
  });
}

export function useRestoreEventLayout(eventId: string) {
  const client = useApiClient();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: ({
      intent = "edit",
      ...input
    }: EventLayoutRestore & { intent?: LayoutIntent }) => {
      if (intent !== "edit") {
        const state = cache.getQueryData<LayoutUndoState>(undoKey(eventId));
        if (
          state?.version !== input.expectedVersion ||
          state[intent].at(-1) !== input.targetVersion
        )
          throw new Error(
            "The layout changed. Refresh before using undo or redo.",
          );
      }
      return client.restoreEventLayout(eventId, input);
    },
    onSuccess: (layout, input) =>
      acceptLayout(
        cache,
        layout,
        input.expectedVersion,
        input.intent ?? "edit",
      ),
  });
}

/**
 * The event's layout with the account's own view of it. What this browser
 * still keeps for the event (see `keptViewStores`) is saved to the account
 * on the first read. A read never replaces what is newer in the cache: a
 * later layout, or a view saved while the read was on its way.
 */
async function loadEventLayout(
  client: LivTalesApiClient,
  cache: QueryClient,
  eventId: string,
  signal?: AbortSignal,
): Promise<EventLayoutWithViewResponse> {
  const saves = viewSavesOf(cache, eventId);
  const read = await moveKept(
    client,
    cache,
    await (
      signal === undefined ? client : client.withSignal(signal)
    ).getEventLayoutWithView(eventId),
  );
  const current = cache.getQueryData<EventLayoutWithViewResponse>(
    eventLayoutKey(eventId),
  );
  if (current === undefined) return read;
  if (current.version > read.version) return current;
  return viewSavesOf(cache, eventId) === saves
    ? read
    : keepView(read, current.yours);
}

/** The layout read, with what this browser still keeps for the event moved into the view. */
async function moveKept(
  client: LivTalesApiClient,
  cache: QueryClient,
  layout: EventLayoutWithViewResponse,
): Promise<EventLayoutWithViewResponse> {
  if (!mayHoldKeptViews()) return layout;
  const accountId = await sessionAccountId(client, cache);
  if (accountId === undefined) return layout;
  const yours = await moveKeptEventView(client, accountId, layout);
  return yours === layout.yours ? layout : keepView(layout, yours);
}

export function useEventLayout(eventId: string) {
  const client = useApiClient();
  const cache = useQueryClient();
  const { credential } = useAuthSession();
  return useQuery({
    queryKey: eventLayoutKey(eventId),
    enabled: credential !== null,
    queryFn: ({ signal }) => loadEventLayout(client, cache, eventId, signal),
  });
}

/**
 * A change to an event's layout: the layout it was made on, and the change
 * itself as a function of the pages. A save refused because the layout
 * moved on makes the change again on the newest pages, so what others
 * changed meanwhile stays around it; a change that leaves the newest pages
 * as they are writes nothing.
 */
export interface LayoutChange {
  readonly source: EventLayoutResponse;
  readonly change: (pages: EventPage[]) => readonly EventPage[];
}

/**
 * The layout after a change, and the version it replaced; null when the
 * change had nothing left to do on the newest layout.
 */
export interface LayoutChangeResult {
  readonly layout: EventLayoutResponse;
  readonly previousVersion: number | null;
}

export function useUpdateEventLayout(eventId: string) {
  const client = useApiClient();
  const cache = useQueryClient();
  return useMutation({
    mutationKey: layoutUpdateKey(eventId),
    mutationFn: async ({
      source,
      change,
    }: LayoutChange): Promise<LayoutChangeResult> =>
      (
        await saveOnNewest(
          async (base: EventLayoutResponse) => {
            const pages = change(base.pages);
            if (pages === base.pages)
              return { layout: base, previousVersion: null };
            const layout = await client.updateEventLayout(eventId, {
              expectedVersion: base.version,
              pages: [...pages],
            });
            return { layout, previousVersion: base.version };
          },
          source,
          () => client.getEventLayout(eventId),
        )
      ).result,
    onSuccess: ({ layout, previousVersion }) =>
      acceptLayout(cache, layout, previousVersion, "edit"),
  });
}

/** True while any layout write for the event is in flight. */
export function useIsLayoutSaving(eventId: string) {
  return useIsMutating({ mutationKey: layoutUpdateKey(eventId) }) > 0;
}

/** A change to the account's view of the event, and whether it is sent as the page is left. */
interface ViewChangeRequest {
  readonly change: EventViewStateUpdate;
  readonly leaving: boolean;
}

/** The changes to the account's view of the event still on their way. */
function pendingViewChanges(
  cache: QueryClient,
  eventId: string,
): EventViewStateUpdate[] {
  return cache
    .getMutationCache()
    .findAll({ mutationKey: viewUpdateKey(eventId), status: "pending" })
    .map((mutation) => (mutation.state.variables as ViewChangeRequest).change);
}

function withChanges(
  layout: EventLayoutWithViewResponse,
  changes: readonly EventViewStateUpdate[],
): EventViewState {
  return changes.reduce(
    (view, change) => applyEventViewUpdate(layout, view, change),
    layout.yours,
  );
}

/**
 * The account's own view of the event as it shows: the view the account
 * keeps, with the changes still on their way already applied. Undefined
 * until the layout has loaded.
 */
export function useEventViewState(eventId: string): EventViewState | undefined {
  const layout = useEventLayout(eventId);
  const changes = useMutationState({
    filters: { mutationKey: viewUpdateKey(eventId), status: "pending" },
    select: (mutation) =>
      (mutation.state.variables as ViewChangeRequest).change,
  });
  const data = layout.data;
  return useMemo(
    () => (data === undefined ? undefined : withChanges(data, changes)),
    [data, changes],
  );
}

/**
 * Changes the account's own view of the event. The change shows at once
 * and is sent as it is made, one after another for the event; the reply
 * becomes the kept view, and a refusal takes the change back and says so
 * (a place, saved on the account's behalf, is taken back quietly). `make`
 * reads the view as it shows at that moment, changes already sent
 * included, and returns the change, or null for none. `leaving` sends it
 * so that it completes after the page is gone.
 */
export function useChangeEventView(eventId: string) {
  const client = useApiClient();
  const leavingClient = useLeavingApiClient();
  const cache = useQueryClient();
  const { post } = useNotices();
  const describe = useErrorMessage();
  const { mutate } = useMutation({
    mutationKey: viewUpdateKey(eventId),
    scope: { id: `event-view:${eventId}` },
    mutationFn: ({ change, leaving }: ViewChangeRequest) =>
      (leaving ? leavingClient : client).updateEventView(eventId, change),
    onSuccess: async (yours) => {
      const key = eventLayoutKey(eventId);
      // A read sent before this change could answer without it: it is
      // dropped and sent again once the reply is in.
      const reading = cache.getQueryState(key)?.fetchStatus === "fetching";
      await cache.cancelQueries({ queryKey: key, exact: true });
      noteViewSave(cache, eventId);
      cache.setQueryData<EventLayoutWithViewResponse>(key, (current) =>
        current === undefined ? current : keepView(current, yours),
      );
      if (reading) void cache.invalidateQueries({ queryKey: key, exact: true });
    },
    onError: (error, { change }) => {
      if (Object.keys(change).some((name) => name !== "place"))
        post({ message: describe(error), tone: "danger" });
    },
  });
  return useCallback(
    (
      make: (view: EventViewState) => EventViewStateUpdate | null,
      { leaving = false }: { readonly leaving?: boolean } = {},
    ) => {
      const layout = cache.getQueryData<EventLayoutWithViewResponse>(
        eventLayoutKey(eventId),
      );
      if (layout === undefined) return;
      const change = make(
        withChanges(layout, pendingViewChanges(cache, eventId)),
      );
      if (change !== null) mutate({ change, leaving });
    },
    [cache, eventId, mutate],
  );
}
