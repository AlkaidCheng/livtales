"use client";

import type { AccessibleWorkspace, SessionResponse } from "@livtales/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { openCommandPalette } from "../lib/command-palette";
import { canSwitchWorkspace, isSwitchWorkspaceKeys } from "../lib/keyboard";
import { useCurrentWorkspaceIdentity } from "../lib/use-workspace-identity";
import { AccountBlock, AccountMenuItems } from "./account-menu";
import { BottomSheet } from "./bottom-sheet";
import { BrandLogo } from "./brand-logo";
import { MenuIcon } from "./icons";
import { useInstallControl } from "./install-app";
import { MoreMenuItems } from "./more-menu";
import { moveMenuFocus } from "./quiet-menu";
import { RailCollections } from "./rail-collections";
import { SearchEntry } from "./search-entry";
import { useSpaceDialogs } from "./space-dialogs";
import { ThemeControls } from "./theme-controls";
import { WorkspaceMark } from "./workspace-mark";
import {
  WorkspaceSwitcherList,
  switchWorkspaceShortcutKeys,
} from "./workspace-switcher";

/**
 * What is open: the drawer, the switcher's sheet, or one of the sheets
 * that rise over the open drawer (the account's, and Theme from it).
 */
type Sheet = "drawer" | "workspace" | "account" | "theme";

/**
 * The phone's app bar and what opens from it. At the left the menu
 * control opens the sidebar as a drawer: the brand, then the collections
 * (Search, Events, Tasks, People) in the account's order, and at its foot
 * the account block as the rail's foot shows it (the avatar, the
 * account's name, and the current space). A long press on a collection
 * enters customization, and the Collections header offers Done until it
 * is left. The account block opens the account sheet over the drawer:
 * Friends, Settings, Sign out, and what More offers under them (Trash,
 * Theme, Customize sidebar, Help, and Keyboard shortcuts on a keyboard
 * device). Dismissing that sheet, or Theme's from it, returns to the
 * drawer; an entry taken closes both. Beside the menu control the current
 * workspace as a mark and its name (the home symbol and "Personal" for the
 * account's own, the owner's initials and name for one shared with it),
 * opening the switcher as a sheet from the bottom, and on an event's page
 * a slash and the link back to Events. Cmd/Ctrl+Shift+K opens the
 * switcher sheet as it opens the rail's list.
 */
export function PhoneChrome({
  session,
  pathname,
  pendingRequests = 0,
  customizing,
  onCustomize,
  onSwitch,
  onSignOut,
}: {
  readonly session: SessionResponse;
  readonly pathname: string;
  readonly pendingRequests?: number | undefined;
  readonly customizing: boolean;
  readonly onCustomize: (customizing: boolean) => void;
  readonly onSwitch: (workspaceId: string) => void;
  readonly onSignOut: () => void;
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // What a choice inside a sheet or the drawer opens next (the palette,
  // the switcher, or the install steps), run once every modal has closed
  // and given focus back to its control, so the next one takes focus from
  // there.
  const [next, setNext] = useState<{ run: () => void } | null>(null);
  const t = useTranslations("workspace");
  const account = useTranslations("account");
  const nav = useTranslations("nav");
  const common = useTranslations("common");
  const theme = useTranslations("theme");
  const eventText = useTranslations("event");
  const install = useInstallControl();
  const identity = useCurrentWorkspaceIdentity(session);
  const spaceDialogs = useSpaceDialogs();
  const workspaceMenu = useRef<HTMLDivElement>(null);
  const accountMenu = useRef<HTMLDivElement>(null);
  const themeSheet = useRef<HTMLDivElement>(null);
  const drawerOpen =
    sheet === "drawer" || sheet === "account" || sheet === "theme";
  const onEvent = pathname.startsWith("/events/");

  const close = useCallback(() => setSheet(null), []);
  const backToDrawer = useCallback(() => setSheet("drawer"), []);
  const closeDrawer = useCallback(() => {
    setSheet(null);
    onCustomize(false);
  }, [onCustomize]);

  // Cmd/Ctrl+Shift+K toggles the switcher sheet; pressed inside it, closes
  // it. Over the drawer, the drawer closes first, so the switcher returns
  // focus to the bar.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        sheet === "workspace" &&
        event.target instanceof Node &&
        (workspaceMenu.current?.contains(event.target) ?? false) &&
        isSwitchWorkspaceKeys(event)
      ) {
        event.preventDefault();
        setSheet(null);
        return;
      }
      if (!canSwitchWorkspace(event)) return;
      event.preventDefault();
      if (sheet === "workspace") setSheet(null);
      else if (sheet === null) setSheet("workspace");
      else {
        setSheet(null);
        setNext({ run: () => setSheet("workspace") });
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sheet]);

  // The account sheet opens on Friends and the theme sheet on the chosen
  // appearance, as the rail's panels do; the switcher's list places its own.
  useEffect(() => {
    if (sheet === "account")
      accountMenu.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    if (sheet === "theme")
      themeSheet.current?.querySelector<HTMLElement>("input:checked")?.focus();
  }, [sheet]);

  // The sheets and the drawer close in their own layout effects, before
  // this one runs.
  useEffect(() => {
    if (sheet !== null || next === null) return;
    setNext(null);
    next.run();
  }, [sheet, next]);

  function closeThen(run: () => void) {
    setSheet(null);
    setNext({ run });
  }
  const openPalette = () => closeThen(() => openCommandPalette());

  function choose(workspace: AccessibleWorkspace) {
    close();
    if (workspace.id !== session.workspace.id) onSwitch(workspace.id);
  }
  function onMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (
      event.target instanceof HTMLInputElement &&
      (event.key === "Home" || event.key === "End")
    )
      return;
    moveMenuFocus(event, event.currentTarget);
  }

  return (
    <>
      <header className="phone-bar">
        <button
          type="button"
          className="phone-menu"
          aria-label={nav("menu")}
          aria-haspopup="dialog"
          aria-expanded={drawerOpen}
          onClick={() =>
            setSheet((open) => (open === "drawer" ? null : "drawer"))
          }
        >
          <MenuIcon />
          {/* The account's dot, while its block is out of sight in the drawer. */}
          {pendingRequests > 0 ? (
            <span className="profile-dot" aria-hidden="true" />
          ) : null}
        </button>
        <button
          type="button"
          className="phone-workspace"
          aria-haspopup="dialog"
          aria-expanded={sheet === "workspace"}
          aria-keyshortcuts={switchWorkspaceShortcutKeys}
          aria-label={`${t("section")}: ${identity.title}`}
          onClick={() =>
            setSheet((open) => (open === "workspace" ? null : "workspace"))
          }
        >
          <WorkspaceMark mark={identity.mark} />
          <span className="phone-workspace-name">{identity.title}</span>
        </button>
        {onEvent ? (
          <>
            <span aria-hidden="true" className="phone-crumb-separator">
              /
            </span>
            <Link
              aria-label={eventText("allEvents")}
              className="phone-crumb"
              href="/events"
            >
              {nav("events")}
            </Link>
          </>
        ) : null}
      </header>
      <BottomSheet
        open={sheet === "workspace"}
        label={t("switch")}
        onClose={close}
      >
        <div
          ref={workspaceMenu}
          role="menu"
          aria-label={t("switch")}
          className="sheet-menu"
          onKeyDown={onMenuKeyDown}
        >
          <WorkspaceSwitcherList
            session={session}
            onChoose={choose}
            onNewSpace={() => closeThen(spaceDialogs.openNewSpace)}
            onManageSpace={() => closeThen(spaceDialogs.openManageSpace)}
            onClose={close}
          />
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "account"}
        label={account("menu")}
        onClose={backToDrawer}
      >
        <p className="quiet-menu-heading account-identity sheet-identity">
          <strong>{session.user.displayName}</strong>
          <span>{session.user.email}</span>
        </p>
        {/* One menu, so the arrow keys walk from the account's entries
            into More's group under them. */}
        <div
          ref={accountMenu}
          role="menu"
          aria-label={account("menu")}
          className="sheet-menu"
          onKeyDown={onMenuKeyDown}
        >
          {/* Settings opens as the sheet and the drawer close, which gives
              focus back to the menu control, where closing Settings
              returns it. */}
          <AccountMenuItems
            pendingRequests={pendingRequests}
            onSignOut={onSignOut}
            onChoose={closeDrawer}
            onSettings={closeDrawer}
          />
          <hr className="quiet-menu-separator" />
          {/* biome-ignore lint/a11y/useSemanticElements: A group of menu items, not a form fieldset. */}
          <div role="group" aria-label={nav("more")} className="sheet-menu">
            <MoreMenuItems
              onChoose={closeDrawer}
              onSettings={closeDrawer}
              onTheme={() => setSheet("theme")}
              onCustomize={() => {
                setSheet("drawer");
                onCustomize(true);
              }}
              installMode={install.mode}
              onInstall={() => closeThen(install.activate)}
            />
          </div>
        </div>
      </BottomSheet>
      <BottomSheet
        open={sheet === "theme"}
        label={theme("title")}
        onClose={backToDrawer}
      >
        <div className="sheet-theme" ref={themeSheet}>
          <ThemeControls />
        </div>
      </BottomSheet>
      {/* After the sheets, so a sheet over the drawer closes first and
          gives focus back to the account block before the drawer closes
          and gives it back to the menu control. */}
      <PhoneDrawer open={drawerOpen} onClose={closeDrawer}>
        <div className="sidebar-head">
          <Link className="brand" href="/events" onClick={closeDrawer}>
            <BrandLogo />
          </Link>
          <button
            type="button"
            className="icon-control icon-control-quiet phone-drawer-close"
            aria-label={common("close")}
            onClick={closeDrawer}
          >
            <span aria-hidden="true">&#215;</span>
          </button>
        </div>
        <nav
          aria-label={nav("workspaceNavigation")}
          className="workspace-nav"
          // A collection chosen from the drawer closes it behind the
          // navigation; Search (the one button here outside customizing)
          // closes it and opens the palette over the page once it is gone.
          onClickCapture={(event) => {
            const target = event.target as HTMLElement;
            // The palette is the Search entry's portal: under this nav in
            // the tree, outside it on the page, and its clicks are its own.
            if (customizing || !event.currentTarget.contains(target)) return;
            if (target.closest("a") !== null) setSheet(null);
            else if (target.closest("button") !== null) {
              event.preventDefault();
              event.stopPropagation();
              openPalette();
            }
          }}
        >
          <SearchEntry current={pathname.startsWith("/search")} />
          <RailCollections
            pathname={pathname}
            customizing={customizing}
            onCustomize={onCustomize}
            onLongPress={() => onCustomize(true)}
            headingDone
          />
        </nav>
        <div className="sidebar-footer">
          <AccountBlock
            session={session}
            pendingRequests={pendingRequests}
            aria-haspopup="dialog"
            aria-expanded={sheet === "account"}
            onClick={() => setSheet("account")}
          />
        </div>
      </PhoneDrawer>
      {install.steps}
    </>
  );
}

/**
 * The sidebar as a drawer from the left: a modal dialog with a scrim, so
 * focus stays inside while it is open and returns to the menu control;
 * Escape, the scrim, or its close control closes it. Its content stays
 * mounted while it is closed: the Search entry inside owns the palette
 * and the Cmd/Ctrl+K that opens it, on the phone as on the rail.
 */
function PhoneDrawer({
  open,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const t = useTranslations("nav");
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog through its cancel event; the click closes on the scrim alone.
    <dialog
      ref={dialog}
      className="phone-drawer sidebar"
      aria-label={t("menu")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
