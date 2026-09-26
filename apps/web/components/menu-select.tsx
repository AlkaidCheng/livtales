"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { openPickerPanel, revealRow } from "../lib/picker-panel";
import { CheckIcon, ChevronDownIcon } from "./icons";

export interface MenuOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  /** The option's language, when it is written in one of its own. */
  readonly lang?: string | undefined;
}

/**
 * A menu of a few choices, drawn in the app's own style in place of the
 * browser's: a button showing the chosen option that opens a list of the
 * options next to it (on a phone, a titled pop-up in the middle of the
 * screen), the chosen one checked. The
 * arrow keys, Home and End, and a typed first letter move through the
 * list, Enter or Space chooses, and Escape or a click outside closes it,
 * returning to the button. The button is a select-only combobox; `label`
 * names the list.
 *
 * `variant` gives the button the look of a form's full-width field or of
 * a Settings row's compact menu.
 */
export function MenuSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  variant = "compact",
  align = variant === "compact" ? "end" : "start",
  id,
  className,
  ...described
}: {
  readonly value: T;
  readonly options: readonly MenuOption<T>[];
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly variant?: "field" | "compact";
  /** Which edge of the button the list lines up with. */
  readonly align?: "start" | "end";
  readonly id?: string | undefined;
  readonly className?: string | undefined;
  readonly "aria-describedby"?: string | undefined;
  readonly "aria-labelledby"?: string | undefined;
  readonly "aria-label"?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;
  const optionId = (index: number) => `${baseId}-option-${index}`;
  const chosen = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const current = options[chosen];

  function show() {
    setActive(chosen);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    dialog.current?.close();
    button.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (option !== undefined && option.value !== value) onChange(option.value);
    close();
  }

  function move(index: number) {
    const next = Math.max(0, Math.min(index, options.length - 1));
    setActive(next);
    revealRow(list.current, document.getElementById(optionId(next)));
  }

  useLayoutEffect(() => {
    const panel = dialog.current;
    const anchor = button.current;
    if (!open || panel === null || anchor === null) return;
    openPickerPanel(panel, anchor, {
      align,
      minWidth: 160,
      maxHeight: 360,
      fitContent: true,
    });
    list.current?.focus();
    revealRow(list.current, list.current?.querySelector(".is-chosen") ?? null, {
      center: true,
    });
  }, [open, align]);

  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      show();
    }
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    const moves: Record<string, number> = {
      ArrowDown: active + 1,
      ArrowUp: active - 1,
      Home: 0,
      End: options.length - 1,
    };
    const next = moves[event.key];
    if (next !== undefined) {
      event.preventDefault();
      move(next);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(active);
    } else if (event.key.length === 1 && /\S/u.test(event.key)) {
      // A typed letter moves to the next option that starts with it.
      const letter = event.key.toLocaleLowerCase();
      const order = options.map(
        (_, index) => (active + 1 + index) % options.length,
      );
      const found = order.find((index) =>
        optionText(options[index]?.label)
          .toLocaleLowerCase()
          .startsWith(letter),
      );
      if (found !== undefined) move(found);
    }
  }

  return (
    <>
      <button
        {...described}
        aria-controls={open ? listId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={[
          "picker-trigger",
          variant === "compact" && "is-compact",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        id={id}
        onClick={show}
        onKeyDown={onButtonKeyDown}
        ref={button}
        role="combobox"
        type="button"
      >
        <span className="picker-trigger-value" lang={current?.lang}>
          {current?.label}
        </span>
        <ChevronDownIcon className="picker-trigger-chevron" />
      </button>
      {/* The panel lives at the document's end, clear of the styles of the
          form or row that holds the button. */}
      {open
        ? createPortal(
            <dialog
              aria-label={label}
              className="picker-panel menu-panel"
              // The list closes alone: a dialog or sheet holding the button
              // hears neither the Escape nor the cancel.
              onCancel={(event) => {
                event.preventDefault();
                event.stopPropagation();
                close();
              }}
              onClick={(event) => {
                event.stopPropagation();
                if (event.target === event.currentTarget) close();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                event.stopPropagation();
                close();
              }}
              ref={dialog}
            >
              <p aria-hidden="true" className="menu-panel-title">
                {label}
              </p>
              <div
                aria-activedescendant={optionId(active)}
                aria-label={label}
                className="menu-list"
                id={listId}
                onKeyDown={onListKeyDown}
                ref={list}
                role="listbox"
                tabIndex={0}
              >
                {options.map((option, index) => (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: the list takes the keys for its options, which it names by aria-activedescendant
                  <div
                    aria-selected={index === active}
                    className={[
                      "menu-option",
                      index === active && "is-active",
                      index === chosen && "is-chosen",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    id={optionId(index)}
                    key={option.value}
                    lang={option.lang}
                    onClick={() => choose(index)}
                    onMouseMove={() => {
                      if (index !== active) setActive(index);
                    }}
                    role="option"
                    tabIndex={-1}
                  >
                    <span className="menu-option-label">{option.label}</span>
                    <CheckIcon className="menu-option-check" />
                  </div>
                ))}
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}

/** The text of an option's label, for moving to it by a typed letter. */
function optionText(label: ReactNode): string {
  return typeof label === "string" || typeof label === "number"
    ? String(label)
    : "";
}
