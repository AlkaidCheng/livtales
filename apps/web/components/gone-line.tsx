"use client";

import { useTranslations } from "next-intl";

import type { Gone } from "../lib/live/object-news";

/**
 * The line saying why a confirmation no longer applies: who did what to
 * the object when the change named them, in the words of the pop-up that
 * announces it, and the plain fact otherwise.
 */
export function useGoneWords(): (gone: Gone, object: string) => string {
  const live = useTranslations("live.notice");
  const t = useTranslations("confirm.gone");
  return (gone, object) =>
    gone.actor !== null &&
    (gone.kind === "trashed" ||
      gone.kind === "restored" ||
      gone.kind === "removed")
      ? live(gone.kind, { name: gone.actor, object })
      : t(gone.kind, { object });
}

/** In place of a confirmation that no longer applies: why, in one line, and Close. */
export function GoneLine({
  gone,
  object,
  onClose,
}: {
  readonly gone: Gone;
  readonly object: string;
  readonly onClose: () => void;
}) {
  const common = useTranslations("common");
  const words = useGoneWords();
  return (
    <div className="confirm-line" role="status">
      <span>{words(gone, object)}</span>
      <button
        className="button button-primary button-small"
        onClick={onClose}
        type="button"
      >
        {common("close")}
      </button>
    </div>
  );
}
