"use client";

import { useTranslations } from "next-intl";
import {
  type KeyboardEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  displayChoices,
  palettes,
  type SealShape,
  type SealStyle,
  sealOf,
  sealStyles,
} from "../lib/display-preferences";
import { useDisplayPreference, useSeal } from "../lib/use-display-preference";
import { SealMark } from "./seal-mark";

/** What names a group of tiles: the label of the row or panel group that holds it. */
interface TileGroupLabel {
  readonly "aria-labelledby"?: string;
  readonly "aria-describedby"?: string;
}

/** How the arrow keys step through a row of choices. */
const arrowSteps: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * The palettes as tiles side by side, each a miniature of the app in that
 * palette and the current mode: its ground, a top bar, a tab in its accent
 * and one beside it, and two rows. The chosen tile carries the accent's
 * outline. The tiles are radios, so Tab reaches the chosen one and the
 * arrow keys choose another.
 */
export function PaletteTiles(label: TileGroupLabel) {
  const name = useId();
  const t = useTranslations("theme");
  const palette = useDisplayPreference("palette");
  return (
    <fieldset {...label} className="appearance-tiles">
      {palettes.map((choice) => (
        <label className="appearance-tile" key={choice.id}>
          <input
            checked={palette.value === choice.id}
            className="appearance-tile-input"
            name={name}
            onChange={() => palette.setValue(choice.id)}
            type="radio"
            value={choice.id}
          />
          <span
            aria-hidden="true"
            className="palette-miniature"
            data-palette={choice.id}
          >
            <i className="palette-miniature-bar" />
            <i className="palette-miniature-tab is-current" />
            <i className="palette-miniature-tab" />
            <i className="palette-miniature-row" />
            <i className="palette-miniature-row is-second" />
          </span>
          {t(`palettes.${choice.id}`)}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The add button's four shapes as tiles, each drawn in the style it keeps.
 * A small styles control in each tile's top corner opens that shape's
 * styles; the tiles themselves are radios like the palettes'.
 */
export function SealTiles(label: TileGroupLabel) {
  const name = useId();
  const t = useTranslations("theme");
  const seal = useSeal();
  const [styling, setStyling] = useState<SealShape | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <fieldset {...label} className="appearance-tiles seal-tiles">
        {displayChoices.seal.map((shape) => (
          <div className="seal-tile" key={shape}>
            <label className="appearance-tile seal-tile-choice">
              <input
                aria-label={t("sealChoice", {
                  shape: t(`seals.${shape}`),
                  style: t(`sealStyles.${seal.styleOf(shape)}`),
                })}
                checked={seal.shape === shape}
                className="appearance-tile-input"
                name={name}
                onChange={() => seal.chooseShape(shape)}
                type="radio"
                value={shape}
              />
              <SealMark seal={seal.sealOf(shape)} />
              {t(`seals.${shape}`)}
            </label>
            <button
              aria-haspopup="dialog"
              aria-label={t("sealStylesOf", { shape: t(`seals.${shape}`) })}
              className="seal-tile-styles"
              onClick={(event) => {
                opener.current = event.currentTarget;
                setStyling(shape);
              }}
              title={t("sealStylesOf", { shape: t(`seals.${shape}`) })}
              type="button"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
                <rect x="13.5" y="4" width="6.5" height="6.5" rx="3.25" />
                <rect x="4" y="13.5" width="6.5" height="6.5" rx="3.25" />
                <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
              </svg>
            </button>
          </div>
        ))}
      </fieldset>
      {styling === null ? null : (
        <SealStylesDialog
          onClose={() => {
            setStyling(null);
            opener.current?.focus();
          }}
          shape={styling}
        />
      )}
    </>
  );
}

/**
 * A shape's styles as large previews in a pop-up titled with the shape.
 * Each is a button pressed while it is the shape's style; choosing one
 * applies it, with its shape, and closes the pop-up. Focus starts on the
 * current style and the arrow keys move between them; Escape, the close
 * control, or a press outside closes the pop-up alone, leaving whatever
 * holds the tiles open.
 */
function SealStylesDialog({
  shape,
  onClose,
}: {
  readonly shape: SealShape;
  readonly onClose: () => void;
}) {
  const t = useTranslations("theme");
  const common = useTranslations("common");
  const seal = useSeal();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const chosen = seal.styleOf(shape);
  const styles: readonly SealStyle[] = sealStyles[shape];

  useLayoutEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (!element.open) element.showModal?.();
    element.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }, []);

  // The pop-up leaves the top layer first, so whatever holds the tiles is
  // no longer inert when focus goes back to it.
  function close() {
    dialog.current?.close();
    onClose();
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLFieldSetElement>) {
    const step = arrowSteps[event.key];
    const choices = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(".seal-style"),
    );
    const at = choices.indexOf(document.activeElement as HTMLElement);
    if (step === undefined || at < 0) return;
    event.preventDefault();
    choices.at((at + step) % choices.length)?.focus();
  }

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      className="seal-styles"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPress.current && event.target === event.currentTarget)
          close();
        backdropPress.current = false;
      }}
      ref={dialog}
    >
      <header className="seal-styles-head">
        <h2 className="seal-styles-title" id={`${id}-title`}>
          {t(`seals.${shape}`)}
        </h2>
        <button
          aria-label={common("close")}
          className="dialog-close"
          onClick={close}
          type="button"
        >
          &#215;
        </button>
      </header>
      <fieldset
        aria-labelledby={`${id}-title`}
        className="seal-styles-grid"
        onKeyDown={onGridKeyDown}
      >
        {styles.map((style) => (
          <button
            aria-pressed={style === chosen}
            className="seal-style"
            key={style}
            onClick={() => {
              seal.chooseStyle(shape, style);
              close();
            }}
            type="button"
          >
            <SealMark seal={sealOf(shape, style)} />
            {t(`sealStyles.${style}`)}
          </button>
        ))}
      </fieldset>
    </dialog>
  );
}
