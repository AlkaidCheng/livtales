"use client";

import { accountPageSchema } from "@livtales/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useApiClient } from "./api-context";
import { eventLayoutKey } from "./event-layout-queries";
import { hasKeptViews, moveKeptEventViews } from "./kept-views";
import { loadPageChoices, pageChoicesKey } from "./view-choices";

/**
 * Moves what this browser kept of the account's views (event places and
 * choices, the collection pages' choices, the Events list's folds) to the
 * account once it is signed in, then forgets it. A page or event the app
 * is already reading moves through that read; the rest move here, one
 * after another, and a move that fails for a while is tried again on the
 * next visit.
 */
export function useMoveKeptViews(
  accountId: string | undefined,
  foldAccount: string | undefined,
): void {
  const client = useApiClient();
  const cache = useQueryClient();
  useEffect(() => {
    if (accountId === undefined || foldAccount === undefined) return;
    if (!hasKeptViews({ accountId, foldAccount })) return;
    void (async () => {
      for (const page of accountPageSchema.options)
        if (cache.getQueryState(pageChoicesKey(page)) === undefined)
          await cache.prefetchQuery({
            queryKey: pageChoicesKey(page),
            queryFn: () => loadPageChoices(client, cache, page, foldAccount),
          });
      await moveKeptEventViews(
        client,
        accountId,
        (eventId) => cache.getQueryState(eventLayoutKey(eventId)) !== undefined,
      );
    })();
  }, [accountId, cache, client, foldAccount]);
}
