"use client";

import type { EventTabsPreference, ShareNarrowing } from "@livtales/schemas";
import {
  useChangeEventView,
  useEventViewState,
} from "../../lib/event-layout-queries";
import {
  arrangeEventTabs,
  eventTabsPreferenceOf,
  fixedViews,
  stripViews,
  type TabArrangement,
} from "../../lib/event-tabs";
import type { EventView } from "../../lib/event-views";
import { moveKey, placeKey } from "../../lib/key-order";

/** An event's tabs for the account, and the changes the strip and Manage tabs make to them. */
export interface EventTabsState {
  /** The views the account may put on this event. */
  readonly known: readonly EventView[];
  readonly arranged: TabArrangement;
  readonly toggleHidden: (key: string) => void;
  /** Puts a view back on the event, at the end of the strip. */
  readonly add: (view: EventView) => void;
  /** Takes a view off the event; a fixed view stays. */
  readonly remove: (view: EventView) => void;
  readonly moveView: (view: EventView, delta: number) => void;
  readonly placeView: (view: EventView, before: EventView | null) => void;
}

/** The views a narrowed viewer sees: those shared whole and those holding a shared section. */
export function narrowedViews(
  narrowing: ShareNarrowing,
): ReadonlySet<EventView> | null {
  if (narrowing === null) return null;
  return new Set<EventView>([
    ...narrowing.views,
    ...narrowing.sections.map((section) => section.view),
  ]);
}

/**
 * The account's tabs for one event: the arrangement kept in the account's
 * own view of the event, applied to the views the account may see. A
 * change shows at once and is sent as it is made; a refusal puts the tabs
 * back.
 */
export function useEventTabs(
  eventId: string,
  pageIds: readonly string[],
  canShare: boolean,
  narrowing: ShareNarrowing = null,
): EventTabsState {
  const view = useEventViewState(eventId);
  const changeView = useChangeEventView(eventId);
  // A viewer whose shares are narrowed sees the shared views alone; the
  // Sharing view is for whoever may share.
  const admitted = narrowedViews(narrowing);
  const known = stripViews.filter((view) =>
    admitted === null ? canShare || view !== "sharing" : admitted.has(view),
  );
  // A narrowed viewer sees every view shared with them. The defaults are
  // for an account that may arrange the event's whole strip, and hold
  // until it arranges it, whatever else its view of the event keeps (a
  // place saved alone leaves the tabs unarranged).
  const arrange = (tabs: EventTabsPreference) =>
    arrangeEventTabs(tabs, known, { defaults: admitted === null });
  const arranged = arrange(view?.tabs ?? {});

  /** Keeps the arrangement `change` makes of the tabs as they now stand, if any. */
  function keep(change: (arranged: TabArrangement) => TabArrangement | null) {
    changeView((current) => {
      const next = change(arrange(current.tabs));
      return next === null
        ? null
        : { tabs: eventTabsPreferenceOf(next, current.tabs, known, pageIds) };
    });
  }

  return {
    known,
    arranged,
    toggleHidden: (key) =>
      keep((arranged) => {
        const hidden = new Set(arranged.hidden);
        if (hidden.has(key)) hidden.delete(key);
        else hidden.add(key);
        return { ...arranged, hidden };
      }),
    add: (view) =>
      keep((arranged) => {
        if (!arranged.removed.has(view)) return null;
        const removed = new Set(arranged.removed);
        removed.delete(view);
        return { ...arranged, order: [...arranged.order, view], removed };
      }),
    remove: (view) =>
      keep((arranged) => {
        if (fixedViews.has(view) || arranged.removed.has(view)) return null;
        const hidden = new Set(arranged.hidden);
        hidden.delete(view);
        return {
          order: arranged.order.filter((candidate) => candidate !== view),
          hidden,
          removed: new Set([...arranged.removed, view]),
        };
      }),
    moveView: (view, delta) =>
      keep((arranged) => {
        const order = moveKey(
          arranged.order,
          view,
          delta,
        ) as readonly EventView[];
        return order === arranged.order ? null : { ...arranged, order };
      }),
    placeView: (view, before) =>
      keep((arranged) => {
        const order = placeKey(
          arranged.order,
          view,
          before,
        ) as readonly EventView[];
        return order === arranged.order ? null : { ...arranged, order };
      }),
  };
}
