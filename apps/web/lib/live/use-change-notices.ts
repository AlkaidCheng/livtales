"use client";

import type { LiveChange, SessionResponse } from "@livtales/schemas";
import type { QueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { useNotices } from "../../components/notices";
import { queryKeys } from "../queries";
import { heldState } from "./apply-live-change";
import { faceOf } from "./live-people";
import { noticeOf, noticeWords } from "./live-notice";

/** How long a pop-up stays. */
const shownMs = 5_000;
/** Changes by one person within this long share one pop-up. */
const burstMs = 4_000;

/** Flashes the rows showing the objects, once. */
export function flashRows(ids: readonly string[]): void {
  if (typeof document === "undefined" || document.visibilityState !== "visible")
    return;
  window.requestAnimationFrame(() => {
    for (const id of ids)
      for (const row of document.querySelectorAll<HTMLElement>(
        `[data-row-id="${CSS.escape(id)}"]`,
      )) {
        row.classList.remove("live-flash");
        // Reading the layout restarts the animation on a row still flashing.
        void row.offsetWidth;
        row.classList.add("live-flash");
        row.addEventListener(
          "animationend",
          () => row.classList.remove("live-flash"),
          { once: true },
        );
      }
  });
}

/** Scrolls to the row showing an object and flashes it. */
function reveal(id: string): void {
  document
    .querySelector(`[data-row-id="${CSS.escape(id)}"]`)
    ?.scrollIntoView({ block: "center", behavior: "smooth" });
  flashRows([id]);
}

/**
 * The pop-up for another person's change on the page this tab shows in
 * front, unless the account turned them off: who, what, and which parts,
 * or how many changes when one person makes several within a few seconds.
 * Changes from the account's own other devices arrive without one.
 */
export function useChangeNotices(cache: QueryClient) {
  const t = useTranslations("live");
  const { post } = useNotices();
  const latest = useRef({ t, post });
  useEffect(() => {
    latest.current = { t, post };
  });
  const bursts = useRef(
    new Map<string, { count: number; timer: ReturnType<typeof setTimeout> }>(),
  );
  useEffect(() => {
    const pending = bursts.current;
    return () => {
      for (const burst of pending.values()) clearTimeout(burst.timer);
      pending.clear();
    };
  }, []);

  // Words the change for a pop-up from what the page holds before it is
  // applied, and returns the step that shows it; null for none.
  const [prepare] = useState(
    () =>
      (change: LiveChange): (() => void) | null => {
        const { t, post } = latest.current;
        // The session the pages already read names the viewer and their choice.
        const user = cache.getQueryData<SessionResponse>(
          queryKeys.session,
        )?.user;
        if (
          change.kind !== "objects" ||
          user === undefined ||
          user.changeNotices === false ||
          change.actor.userId === user.id
        )
          return null;
        const notice = noticeOf(change, (id) => heldState(cache, id));
        if (notice === null) return null;
        const eventId = change.page.startsWith("event:")
          ? change.page.slice(6)
          : null;
        const page =
          eventId === null
            ? t("tasksPage")
            : (heldState(cache, eventId)?.displayName ?? t("thisEvent"));
        const actor = change.actor;
        return () => {
          const key = `live:${actor.userId}`;
          const burst = bursts.current.get(key);
          if (burst !== undefined) clearTimeout(burst.timer);
          const count = (burst?.count ?? 0) + 1;
          bursts.current.set(key, {
            count,
            timer: setTimeout(() => bursts.current.delete(key), burstMs),
          });
          const name = actor.displayName;
          const object = notice.objectName;
          const words = noticeWords(notice);
          const message =
            count > 1
              ? t("notice.several", { name, count, page })
              : words.key === "renamed"
                ? t("notice.renamed", { name, object, before: words.before })
                : words.key === "changedOne"
                  ? t("notice.changedOne", {
                      name,
                      object,
                      part: t(`parts.${words.part}`),
                    })
                  : words.key === "changedTwo"
                    ? t("notice.changedTwo", {
                        name,
                        object,
                        first: t(`parts.${words.first}`),
                        second: t(`parts.${words.second}`),
                      })
                    : t(`notice.${words.key}`, { name, object });
          post({
            key,
            message,
            face: faceOf(actor),
            durationMs: shownMs,
            ...(count === 1 &&
              notice.verb !== "trashed" &&
              notice.verb !== "removed" && {
                onOpen: () => reveal(notice.objectId),
              }),
          });
        };
      },
  );
  return prepare;
}
