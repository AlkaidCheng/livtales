"use client";

import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  type ReactNode,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
  SlidersIcon,
} from "../../components/icons";
import { openPickerPanel } from "../../lib/picker-panel";

/** One choice of an option: its value and how it reads. */
export interface OptionChoice {
  readonly value: string;
  readonly label: string;
  /** Found by the list's search; the fixed choices at its top are not. */
  readonly searchable?: boolean;
  /** Drawn with the initials of its name, as a person is. */
  readonly person?: boolean;
}

/** A run of choices in a list, under a label when it has one. */
export interface OptionGroup {
  readonly label?: string | undefined;
  readonly choices: readonly OptionChoice[];
}

/**
 * One row of a view's options: a few choices side by side (Layout, Show),
 * a value that opens its list (Sort, Assigned to, Label), a switch
 * (Overdue only), a heading over the rows after it (Filter), a row of
 * buttons (Export), or an action (Share).
 */
export type ViewOption =
  | {
      readonly kind: "segments";
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly choices: readonly OptionChoice[];
      readonly onChange: (value: string) => void;
      readonly busy?: boolean | undefined;
    }
  | {
      readonly kind: "list";
      readonly id: string;
      readonly label: string;
      readonly value: string;
      readonly groups: readonly OptionGroup[];
      readonly onChange: (value: string) => void;
      /** Whether the value differs from the default, drawn in the accent. */
      readonly changed?: boolean | undefined;
      /** A search over the searchable choices, with what it says when nothing matches. */
      readonly search?:
        | {
            readonly label: string;
            readonly empty: string;
            /** Hears the typed search, for a list that asks the server. */
            readonly onQuery?: ((query: string) => void) | undefined;
          }
        | undefined;
      readonly busy?: boolean | undefined;
    }
  | {
      readonly kind: "switch";
      readonly id: string;
      readonly label: string;
      readonly checked: boolean;
      readonly onChange: (checked: boolean) => void;
    }
  | { readonly kind: "heading"; readonly id: string; readonly label: string }
  | {
      readonly kind: "buttons";
      readonly id: string;
      readonly label: string;
      readonly buttons: readonly {
        readonly id: string;
        readonly label: string;
        /** A fuller name for the button, when its label is short. */
        readonly name?: string | undefined;
        readonly onPress: () => void;
      }[];
    }
  | {
      readonly kind: "action";
      readonly id: string;
      readonly label: string;
      readonly onPress: () => void;
    };

/** A choice shown as a removable chip under the strip. */
export interface ViewChip {
  readonly id: string;
  readonly label: string;
  readonly onClear: () => void;
}

/** An option whose value is one of its choices. */
type ChoosingOption = Extract<ViewOption, { kind: "list" | "segments" }>;

/** An option's choices, for the row that shows its value. */
function choicesOf(option: ChoosingOption): readonly OptionChoice[] {
  return option.kind === "segments"
    ? option.choices
    : option.groups.flatMap((group) => group.choices);
}

/** The first control of the rows, where focus starts as they open. */
const firstControl =
  '.view-option-rows :is(button, input):not([tabindex="-1"]):not(:disabled)';

/** How many choices still sit side by side; more open as a list. */
const segmentLimit = 3;

/** A person's initials, for the mark beside their name. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const letters =
    words.length > 1
      ? [words[0], words.at(-1)].map((word) => Array.from(word ?? "")[0] ?? "")
      : Array.from(words[0] ?? "").slice(0, 2);
  return letters.join("").toLocaleUpperCase();
}

/**
 * A view's options as rows, each a name and its control; a row holding a
 * value opens its list in the same place, with a way back and, for a long
 * list, a search. Every choice applies at once. `title` heads the rows
 * (with Done, when `onDone` is given) and names the way back from a list;
 * a button or an action closes the options through `onClose` before it
 * runs.
 */
export function OptionRows({
  title,
  options,
  onDone,
  onClose,
}: {
  readonly title: string;
  readonly options: readonly ViewOption[];
  readonly onDone?: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const t = useTranslations("viewOptions");
  const baseId = useId();
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const option = options.find(
    (candidate): candidate is ChoosingOption =>
      candidate.id === picking &&
      (candidate.kind === "list" || candidate.kind === "segments"),
  );

  // A list opens on its search, or on its chosen row; closing it returns
  // to the row it came from.
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null) return;
    if (picking !== null) {
      (
        element.querySelector<HTMLElement>("input") ??
        element.querySelector<HTMLElement>('[role="option"][tabindex="0"]')
      )?.focus();
      return;
    }
    if (returnTo !== null)
      element
        .querySelector<HTMLElement>(`[data-option="${returnTo}"]`)
        ?.focus();
  }, [picking, returnTo]);

  function open(id: string) {
    setQuery("");
    setPicking(id);
  }

  function back() {
    setReturnTo(picking);
    setPicking(null);
    setQuery("");
    if (option?.kind === "list") option.search?.onQuery?.("");
  }

  // Escape in a list goes back to the rows rather than closing them.
  function onEscape(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    back();
  }

  if (option !== undefined)
    return (
      <div className="view-options" ref={root}>
        <OptionList
          back={
            <button
              className="view-options-back"
              onClick={back}
              onKeyDown={onEscape}
              type="button"
            >
              <ChevronLeftIcon className="view-options-back-icon" />
              {title}
            </button>
          }
          onEscape={onEscape}
          onChoose={(value) => {
            if (value !== option.value) option.onChange(value);
            back();
          }}
          onQuery={(next) => {
            setQuery(next);
            if (option.kind === "list") option.search?.onQuery?.(next);
          }}
          option={option}
          query={query}
        />
      </div>
    );

  const labelId = (id: string) => `${baseId}-${id}`;
  const row = (item: ViewOption): ReactNode => {
    const label = <span id={labelId(item.id)}>{item.label}</span>;
    switch (item.kind) {
      case "heading":
        return (
          <p className="view-option-heading" key={item.id}>
            {item.label}
          </p>
        );
      case "switch":
        return (
          <div className="view-option" key={item.id}>
            {label}
            <input
              aria-checked={item.checked}
              aria-labelledby={labelId(item.id)}
              checked={item.checked}
              className="settings-switch-input"
              data-option={item.id}
              onChange={(event) => item.onChange(event.target.checked)}
              role="switch"
              type="checkbox"
            />
          </div>
        );
      case "buttons":
        return (
          <div className="view-option" key={item.id}>
            {label}
            {/* biome-ignore lint/a11y/useSemanticElements: A row of buttons named by its label, not a form's fieldset. */}
            <div
              aria-labelledby={labelId(item.id)}
              className="view-option-buttons"
              role="group"
            >
              {item.buttons.map((button) => (
                <button
                  aria-label={button.name}
                  data-option={`${item.id}:${button.id}`}
                  key={button.id}
                  onClick={() => {
                    onClose();
                    button.onPress();
                  }}
                  type="button"
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>
        );
      case "action":
        return (
          <button
            className="view-option view-option-press"
            data-option={item.id}
            key={item.id}
            onClick={() => {
              onClose();
              item.onPress();
            }}
            type="button"
          >
            <span>{item.label}</span>
            <ChevronRightIcon className="view-option-chevron" />
          </button>
        );
      case "segments":
        if (item.choices.length <= segmentLimit)
          return (
            <div className="view-option" key={item.id}>
              {label}
              <Segments
                busy={item.busy === true}
                labelledBy={labelId(item.id)}
                name={item.id}
                onChange={item.onChange}
                option={item}
              />
            </div>
          );
        return valueRow(item, false);
      case "list":
        return valueRow(item, item.changed === true);
      default:
        return null;
    }
  };
  const valueRow = (item: ChoosingOption, changed: boolean) => {
    const chosen = choicesOf(item).find(
      (choice) => choice.value === item.value,
    );
    return (
      <button
        aria-haspopup="listbox"
        className="view-option view-option-press"
        data-option={item.id}
        disabled={item.busy === true}
        key={item.id}
        onClick={() => open(item.id)}
        type="button"
      >
        <span>{item.label}</span>
        <span className={`view-option-value${changed ? " is-set" : ""}`}>
          {chosen?.label ?? ""}
          <ChevronRightIcon className="view-option-chevron" />
        </span>
      </button>
    );
  };

  return (
    <div className="view-options" ref={root}>
      {onDone === undefined ? null : (
        <div className="view-options-head">
          <h2>{title}</h2>
          <button className="view-options-done" onClick={onDone} type="button">
            {t("done")}
          </button>
        </div>
      )}
      <div className="view-option-rows">{options.map(row)}</div>
    </div>
  );
}

/** Choices side by side, the chosen one raised; the arrow keys move along them. */
function Segments({
  busy,
  labelledBy,
  name,
  onChange,
  option,
}: {
  readonly busy: boolean;
  readonly labelledBy: string;
  readonly name: string;
  readonly onChange: (value: string) => void;
  readonly option: Extract<ViewOption, { kind: "segments" }>;
}) {
  const group = useRef<HTMLDivElement>(null);
  const { choices, value } = option;
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const at = choices.findIndex((choice) => choice.value === value);
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = choices[(at + step + choices.length) % choices.length];
    if (next === undefined) return;
    onChange(next.value);
    group.current
      ?.querySelector<HTMLElement>(`[data-value="${next.value}"]`)
      ?.focus();
  }
  return (
    <div
      aria-labelledby={labelledBy}
      className="view-option-segments"
      data-option={name}
      onKeyDown={onKeyDown}
      ref={group}
      role="radiogroup"
    >
      {choices.map((choice) => (
        // biome-ignore lint/a11y/useSemanticElements: A segmented control's choices are buttons in a radio group.
        <button
          aria-checked={choice.value === value}
          data-value={choice.value}
          disabled={busy}
          key={choice.value}
          onClick={() => {
            if (choice.value !== value) onChange(choice.value);
          }}
          role="radio"
          tabIndex={choice.value === value ? 0 : -1}
          type="button"
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

/**
 * An option's list in place of the rows: the way back and its name, a
 * search when it has one, then its choices in their groups, the chosen one
 * checked. With a search typed, only the searchable choices that hold it
 * show. The arrow keys move through the choices, from the search too.
 */
function OptionList({
  back,
  onChoose,
  onEscape,
  onQuery,
  option,
  query,
}: {
  readonly back: ReactNode;
  readonly onChoose: (value: string) => void;
  /** Hears the keys of the search and the list, for Escape. */
  readonly onEscape: (event: KeyboardEvent<HTMLElement>) => void;
  readonly onQuery: (query: string) => void;
  readonly option: ChoosingOption;
  readonly query: string;
}) {
  const titleId = useId();
  const list = useRef<HTMLDivElement>(null);
  const search = option.kind === "list" ? option.search : undefined;
  const groups: readonly OptionGroup[] =
    option.kind === "list" ? option.groups : [{ choices: option.choices }];
  const needle = query.trim().toLocaleLowerCase();
  const shown = groups
    .map((group) => ({
      ...group,
      choices:
        needle === ""
          ? group.choices
          : group.choices.filter(
              (choice) =>
                choice.searchable === true &&
                choice.label.toLocaleLowerCase().includes(needle),
            ),
    }))
    .filter((group) => group.choices.length > 0);
  const values = shown.flatMap((group) =>
    group.choices.map((choice) => choice.value),
  );
  const focusable = values.includes(option.value) ? option.value : values[0];

  function move(from: number, step: number) {
    const buttons = Array.from(
      list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    const next = Math.max(0, Math.min(from + step, buttons.length - 1));
    buttons[next]?.focus();
  }

  function onListKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    onEscape(event);
    const buttons = Array.from(
      list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    const active = document.activeElement;
    const at = active instanceof HTMLElement ? buttons.indexOf(active) : -1;
    const moves: Record<string, number> = {
      ArrowDown: 1,
      ArrowUp: -1,
      Home: -buttons.length,
      End: buttons.length,
    };
    const step = moves[event.key];
    if (step === undefined) return;
    event.preventDefault();
    move(at, step);
  }

  return (
    <>
      <div className="view-options-pick-head">
        {back}
        <h2 id={titleId}>{option.label}</h2>
        <span />
      </div>
      {search === undefined ? null : (
        <div className="view-options-search">
          <SearchIcon className="view-options-search-icon" />
          <input
            aria-label={search.label}
            autoComplete="off"
            className="view-options-search-input"
            enterKeyHint="search"
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              onEscape(event);
              if (event.key !== "ArrowDown" || event.nativeEvent.isComposing)
                return;
              event.preventDefault();
              move(-1, 1);
            }}
            placeholder={search.label}
            spellCheck={false}
            type="search"
            value={query}
          />
        </div>
      )}
      <div
        aria-labelledby={titleId}
        className="view-options-list"
        onKeyDown={onListKeyDown}
        ref={list}
        role="listbox"
      >
        {shown.map((group, index) => (
          // biome-ignore lint/a11y/useSemanticElements: These are listbox option groups, not form fieldsets.
          <div
            aria-label={group.label}
            key={group.label ?? `group-${index}`}
            role="group"
          >
            {group.label === undefined || needle !== "" ? null : (
              <p aria-hidden="true" className="view-options-group">
                {group.label}
              </p>
            )}
            {group.choices.map((choice) => (
              <button
                aria-selected={choice.value === option.value}
                className="view-options-choice"
                key={choice.value}
                onClick={() => onChoose(choice.value)}
                role="option"
                tabIndex={choice.value === focusable ? 0 : -1}
                type="button"
              >
                {choice.person === true ? (
                  <span aria-hidden="true" className="view-options-initials">
                    {initials(choice.label)}
                  </span>
                ) : null}
                <span className="view-options-choice-label">
                  {choice.label}
                </span>
                <CheckIcon className="view-options-check" />
              </button>
            ))}
          </div>
        ))}
      </div>
      {shown.length === 0 && search !== undefined ? (
        <p className="view-options-empty">{search.empty}</p>
      ) : null}
    </>
  );
}

/**
 * A view's options on a phone: a button at the strip's end, marked with a
 * dot while any choice differs from its default, that opens the options
 * as a pop-up in the middle of the screen, titled with the view.
 */
export function ViewOptionsButton({
  active,
  options,
  title,
}: {
  readonly active: boolean;
  readonly options: readonly ViewOption[];
  readonly title: string;
}) {
  const t = useTranslations("viewOptions");
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current;
    if (!open || element === null) return;
    if (!element.open) element.showModal?.();
    element.querySelector<HTMLElement>(firstControl)?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    dialog.current?.close();
    button.current?.focus();
  }

  return (
    <>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={t("options", { name: title })}
        className="view-options-button"
        onClick={() => setOpen(true)}
        ref={button}
        type="button"
      >
        <SlidersIcon className="view-options-icon" />
        {active ? (
          <span aria-hidden="true" className="view-options-dot" />
        ) : null}
      </button>
      {open
        ? createPortal(
            <dialog
              aria-label={t("options", { name: title })}
              className="view-options-dialog"
              onCancel={(event) => {
                event.preventDefault();
                close();
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) close();
              }}
              onKeyDown={(event) => {
                if (event.key !== "Escape" || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                close();
              }}
              ref={dialog}
            >
              <OptionRows
                onClose={close}
                onDone={close}
                options={options}
                title={title}
              />
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * A heading control on a wide screen whose choices are option rows, not a
 * menu (Filter, with its searchable lists): the button reads its purpose,
 * or `name` when choices are on, and opens the rows in a panel under it.
 */
export function OptionsPopover({
  active,
  icon,
  label,
  name,
  options,
}: {
  readonly active: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly name?: string | undefined;
  readonly options: readonly ViewOption[];
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const panel = dialog.current;
    const anchor = button.current;
    if (!open || panel === null || anchor === null) return;
    openPickerPanel(panel, anchor, {
      align: "end",
      minWidth: 300,
      maxHeight: 480,
    });
    panel.querySelector<HTMLElement>(firstControl)?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    dialog.current?.close();
    button.current?.focus();
  }

  return (
    <div className="head-menu">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`button button-quiet head-menu-button${active ? " is-active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        ref={button}
        type="button"
      >
        {icon}
        {name === undefined ? (
          <span className="head-menu-text">{label}</span>
        ) : (
          <>
            <span className="visually-hidden">{label}: </span>
            <span className="head-menu-text">{name}</span>
          </>
        )}
      </button>
      {open
        ? createPortal(
            <dialog
              aria-label={label}
              className="picker-panel view-options-popover"
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
              <OptionRows onClose={close} options={options} title={label} />
            </dialog>,
            document.body,
          )
        : null}
    </div>
  );
}

/**
 * The choices on a view, each a chip that sets it back to its default,
 * and Clear all when there are several.
 */
export function ActiveChips({
  chips,
  onClearAll,
}: {
  readonly chips: readonly ViewChip[];
  readonly onClearAll: () => void;
}) {
  const t = useTranslations("viewOptions");
  if (chips.length === 0) return null;
  return (
    <ul aria-label={t("chips")} className="view-chips">
      {chips.map((chip) => (
        <li key={chip.id}>
          <button
            aria-label={t("remove", { name: chip.label })}
            className="view-chip"
            onClick={chip.onClear}
            type="button"
          >
            {chip.label}
            <span aria-hidden="true" className="view-chip-x">
              ×
            </span>
          </button>
        </li>
      ))}
      {chips.length > 1 ? (
        <li>
          <button
            className="view-chip-clear"
            onClick={onClearAll}
            type="button"
          >
            {t("clearAll")}
          </button>
        </li>
      ) : null}
    </ul>
  );
}
