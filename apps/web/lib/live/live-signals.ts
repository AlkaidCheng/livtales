import type {
  LiveChange,
  LivePresence,
  LiveView,
  LiveWatch,
} from "@livtales/schemas";

import { newId } from "../new-id";

/** What the live connection hands every tab of the browser. */
export type LiveSignal =
  | {
      readonly kind: "change";
      readonly position: string;
      readonly change: LiveChange;
    }
  | { readonly kind: "presence"; readonly presence: LivePresence }
  | { readonly kind: "view"; readonly view: LiveView }
  | {
      readonly kind: "reset";
      readonly pages: readonly string[];
      readonly position: string;
    }
  | { readonly kind: "position"; readonly position: string };

/** One page a tab shows: the position its data was read from, whether it is in front, and where on it the tab is. */
export type TabPage = LiveWatch;

let tabId: string | undefined;

/** This tab's id among the browser's LivTales tabs, sent with its requests as `x-livtales-tab`. */
export function liveTabId(): string {
  tabId ??= `tab-${newId().replaceAll("-", "")}`;
  return tabId;
}

/** The run of the API a position belongs to. */
export function runOf(position: string): string {
  return position.split(".")[0] ?? "";
}

function numberOf(position: string): number {
  return Number(position.split(".")[1]);
}

/**
 * The position to replay a page from for every tab showing it: the
 * earliest, or one from a run other than `run`, which cannot be replayed
 * and so has the page read again. Null when no tab read from a position.
 */
export function replayFrom(
  positions: readonly (string | null)[],
  run: string | null,
): string | null {
  let from: string | null = null;
  for (const position of positions) {
    if (position === null) continue;
    if (run !== null && runOf(position) !== run) return position;
    if (from === null || numberOf(position) < numberOf(from)) from = position;
  }
  return from;
}
