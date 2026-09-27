"use client";

import type { ShareView } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useRef, useState } from "react";

import { ShareIcon } from "../../components/icons";
import { useKnownEventAccess } from "../../lib/queries";
import { ShareSheet } from "./share-sheet";

/** Whether the account may share the Event, as the event page read it; the view controls and section menus follow. */
export function useCanShareEvent(eventId: string | undefined): boolean {
  const access = useKnownEventAccess(eventId);
  return access.data?.actions.includes("share") ?? false;
}

/** One view's share: whether the account may share it, and its sheet while open. */
export interface ViewShare {
  readonly canShare: boolean;
  readonly isOpen: boolean;
  /** Opens the sheet; a keyboard close returns focus to `opener`. */
  readonly show: (opener: HTMLElement | null) => void;
  readonly hide: () => void;
  /** The open sheet, drawn under whatever holds it. */
  readonly sheet: ReactNode;
}

/**
 * The share of one view of the Event, for whoever may share the Event:
 * the sheet that shares that view with people at a role, opened from the
 * view's Share control or from its options on a phone.
 */
export function useViewShare(
  eventId: string,
  view: ShareView,
  viewName: string,
): ViewShare {
  const t = useTranslations("share");
  const canShare = useCanShareEvent(eventId);
  const [isOpen, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback((byKeyboard: boolean) => {
    setOpen(false);
    if (byKeyboard) opener.current?.focus();
  }, []);
  const show = useCallback((from: HTMLElement | null) => {
    opener.current = from;
    setOpen(true);
  }, []);
  const hide = useCallback(() => setOpen(false), []);
  return {
    canShare,
    isOpen,
    show,
    hide,
    sheet:
      canShare && isOpen ? (
        <ShareSheet
          eventId={eventId}
          hint={t("viewHint", { what: viewName })}
          name={viewName}
          onClose={close}
          scope={{ view, sectionId: null }}
        />
      ) : null,
  };
}

/**
 * Share, at the end of a view's controls, for whoever may share the
 * Event: opens the sheet that shares that view of the Event with people
 * at a role.
 */
export function ShareControl({ share }: { readonly share: ViewShare }) {
  const t = useTranslations("share");
  const trigger = useRef<HTMLButtonElement>(null);
  if (!share.canShare) return null;
  return (
    <div className="head-menu share-control">
      <button
        aria-expanded={share.isOpen}
        aria-haspopup="dialog"
        className={`button button-quiet head-menu-button${share.isOpen ? " is-active" : ""}`}
        onClick={() =>
          share.isOpen ? share.hide() : share.show(trigger.current)
        }
        ref={trigger}
        type="button"
      >
        <ShareIcon />
        <span className="head-menu-text">{t("view")}</span>
      </button>
      {share.sheet}
    </div>
  );
}
