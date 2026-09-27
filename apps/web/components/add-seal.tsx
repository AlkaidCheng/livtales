"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { useSessionQuery } from "../lib/queries";
import { useSeal } from "../lib/use-display-preference";
import { canAddToWorkspace } from "../lib/workspace-identity";
import { moveMenuFocus, useMenuDismissal } from "./quiet-menu";
import { SealMark } from "./seal-mark";

/** One thing the add button's menu offers to add. */
export interface AddSealItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  readonly onSelect: () => void;
}

type AddSealAction =
  | {
      /** Adds at once, opening the dialog that adds. */
      readonly onAdd: () => void;
    }
  | {
      /** The menu's heading, shown above its choices. */
      readonly title: string;
      /** The choices, the one nearest the button first. */
      readonly items: readonly AddSealItem[];
    };

/**
 * The phone's add button: the seal in the shape Appearance keeps, fixed at
 * the page's bottom right clear of the home indicator, where the page
 * leaves room for it. A press presses it briefly. With `onAdd` it adds at
 * once; with `items` it opens a menu over a scrim, each choice a pill
 * rising above it with the first nearest and focused, while its plus turns
 * into a close mark. The arrow keys move through the choices, and Escape,
 * the scrim, or the button again closes the menu with focus back on the
 * button; choosing one closes it the same way before adding, so the dialog
 * it opens returns focus there. The stylesheet hides it while a dialog is
 * open. The caller shows it on a phone to accounts that may add.
 */
export function AddSeal({
  label,
  ...action
}: { readonly label: string } & AddSealAction) {
  const { seal } = useSeal();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const choices = "items" in action ? action : null;

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  }, []);
  const contains = useCallback(
    (target: Node) => root.current?.contains(target) ?? false,
    [],
  );
  const dismiss = useCallback(() => close(true), [close]);
  useMenuDismissal(open, contains, dismiss);

  useEffect(() => {
    if (!open) return;
    const entries =
      menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [];
    entries[entries.length - 1]?.focus();
  }, [open]);

  function press() {
    const node = button.current;
    if (node !== null) {
      // Restarts the press when the button is pressed again mid-way, and
      // holds focus where a dialog it opens returns it.
      delete node.dataset.pressed;
      void node.offsetWidth;
      node.dataset.pressed = "";
      node.focus();
    }
    if ("onAdd" in action) action.onAdd();
    else if (open) close(true);
    else setOpen(true);
  }

  return (
    <div className="add-seal" data-seal={seal} ref={root}>
      {open && choices !== null ? (
        <>
          <div
            aria-hidden="true"
            className="add-seal-scrim"
            onClick={() => close(true)}
          />
          <div
            aria-label={label}
            className="add-seal-menu"
            id={`${id}-menu`}
            onKeyDown={(event) => {
              if (moveMenuFocus(event, menu.current) === "left") close(false);
            }}
            ref={menu}
            role="menu"
          >
            <p aria-hidden="true" className="add-seal-title">
              {choices.title}
            </p>
            {[...choices.items].reverse().map((item, index) => (
              <button
                className="add-seal-item"
                key={item.id}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                role="menuitem"
                style={
                  {
                    "--fan-order": choices.items.length - 1 - index,
                  } as CSSProperties
                }
                tabIndex={-1}
                type="button"
              >
                <span className="add-seal-bubble">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <button
        aria-controls={open ? `${id}-menu` : undefined}
        aria-expanded={choices === null ? undefined : open}
        aria-haspopup={choices === null ? "dialog" : "menu"}
        aria-label={label}
        className="add-seal-button"
        onAnimationEnd={(event) => {
          delete event.currentTarget.dataset.pressed;
        }}
        onClick={press}
        ref={button}
        type="button"
      >
        <SealMark seal={seal} />
      </button>
    </div>
  );
}

/**
 * The add button of a space's collection (Events, Tasks, People), which
 * adds at once: shown to an Owner or Editor of the current space, the
 * accounts that may add to it.
 */
export function SpaceAddSeal({
  label,
  onAdd,
}: {
  readonly label: string;
  readonly onAdd: () => void;
}) {
  const session = useSessionQuery().data;
  if (session === undefined || !canAddToWorkspace(session)) return null;
  return <AddSeal label={label} onAdd={onAdd} />;
}
