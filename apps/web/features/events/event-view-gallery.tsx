"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { CheckIcon, PlusIcon } from "../../components/icons";
import { ViewMark } from "../../components/view-marks";
import { fixedViews, galleryViews } from "../../lib/event-tabs";
import {
  type EventView,
  eventViewDescription,
  eventViewLabel,
} from "../../lib/event-views";
import { useSessionDialog } from "../../lib/use-session-dialog";
import type { EventTabsState } from "./use-event-tabs";

/**
 * The gallery: every specialized view the event can show, as cards with a
 * mark, a name and one line. A card is a switch: pressing it puts the
 * view on the strip or takes it off again, and the dialog stays open. A
 * fixed view is marked as always on. New page, for an editor, starts a
 * page of the event's own.
 */
export function EventViewGallery({
  eventName,
  tabs,
  onClose,
  onNewPage,
}: {
  readonly eventName: string;
  readonly tabs: EventTabsState;
  readonly onClose: () => void;
  /** Opens the Add page dialog; absent when the account cannot add one. */
  readonly onNewPage?: (() => void) | undefined;
}) {
  const t = useTranslations("gallery");
  const dialog = useSessionDialog(onClose);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  const cards = galleryViews.filter((view) => tabs.known.includes(view));

  function toggle(view: EventView) {
    if (tabs.arranged.removed.has(view)) tabs.add(view);
    else tabs.remove(view);
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog gallery-dialog"
      aria-labelledby="gallery-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="event-create-header">
        <h2 id="gallery-heading">{t("title", { name: eventName })}</h2>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("close")}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body">
        <p className="gallery-intro">{t("intro")}</p>
        <div className="gallery-scroll">
          <div className="gallery-grid">
            {cards.map((view, index) => {
              const fixed = fixedViews.has(view);
              const added = !tabs.arranged.removed.has(view);
              return (
                <button
                  key={view}
                  ref={index === 0 ? first : undefined}
                  type="button"
                  className="gallery-card"
                  aria-pressed={added}
                  aria-disabled={fixed || undefined}
                  data-added={added || undefined}
                  data-fixed={fixed || undefined}
                  onClick={() => {
                    if (!fixed) toggle(view);
                  }}
                >
                  <span className="gallery-glyph">
                    <ViewMark view={view} />
                  </span>
                  <strong>{eventViewLabel(view)}</strong>
                  <span className="gallery-line">
                    {eventViewDescription(view)}
                  </span>
                  {added ? (
                    <span className="gallery-mark">
                      <CheckIcon />
                      {fixed ? t("always") : t("added")}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <footer className="event-create-footer">
        {onNewPage === undefined ? null : (
          <button
            type="button"
            className="button button-quiet gallery-new-page"
            onClick={onNewPage}
          >
            <PlusIcon />
            {t("newPage")}
          </button>
        )}
        <button type="button" className="button button-quiet" onClick={onClose}>
          {t("done")}
        </button>
      </footer>
    </dialog>
  );
}
