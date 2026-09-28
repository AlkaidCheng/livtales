"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useAuthSession } from "./auth-session";

/** The Event a page shows and the workspace it lives in. */
export interface EventScope {
  readonly eventId: string;
  readonly workspaceId: string;
}

interface EventPage {
  readonly scope: EventScope | null;
  readonly setScope: Dispatch<SetStateAction<EventScope | null>>;
}

const Context = createContext<EventPage | null>(null);

/**
 * Holds the Event the open page shows. It sits above the shell, so the
 * drawers the shell opens over the page read it too.
 */
export function EventScopeProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [scope, setScope] = useState<EventScope | null>(null);
  const value = useMemo(() => ({ scope, setScope }), [scope]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Names the Event a page shows, for as long as the page is open. */
export function useEventPageScope(
  event: { readonly id: string; readonly workspaceId: string } | undefined,
) {
  const setScope = useContext(Context)?.setScope;
  const eventId = event?.id;
  const workspaceId = event?.workspaceId;
  useEffect(() => {
    if (
      setScope === undefined ||
      eventId === undefined ||
      workspaceId === undefined
    )
      return;
    const scope: EventScope = { eventId, workspaceId };
    setScope(scope);
    return () => setScope((current) => (current === scope ? null : current));
  }, [eventId, setScope, workspaceId]);
}

/**
 * The Event of the open page when it lives in a workspace other than the
 * session's, as one shared from another space does: its people and labels
 * are read there, and its tasks name their assignees. Null elsewhere.
 */
export function useForeignEvent(): EventScope | null {
  const scope = useContext(Context)?.scope ?? null;
  const { credential } = useAuthSession();
  return scope === null || scope.workspaceId === credential?.workspaceId
    ? null
    : scope;
}
