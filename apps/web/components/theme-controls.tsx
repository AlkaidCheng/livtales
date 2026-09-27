"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import {
  resetDisplayPreferences,
  useDisplayPreference,
} from "../lib/use-display-preference";
import { AppearanceControl } from "./appearance-control";
import { PaletteTiles, SealTiles } from "./appearance-tiles";

/**
 * The mode, the palette and add button tiles, density, and motion with
 * the reset link: the Theme panel's body, repeated by Settings under
 * Appearance. Choices apply to this browser only.
 */
export function ThemeControls() {
  const id = useId();
  const t = useTranslations("theme");
  const density = useDisplayPreference("density");
  const motion = useDisplayPreference("motion");
  return (
    <>
      <div className="theme-group">
        <span id={`${id}-mode`}>{t("mode")}</span>
        <AppearanceControl />
      </div>
      <div className="theme-group">
        <span id={`${id}-palette`}>{t("palette")}</span>
        <PaletteTiles aria-labelledby={`${id}-palette`} />
      </div>
      <div className="theme-group">
        <span id={`${id}-seal`}>{t("button")}</span>
        <SealTiles aria-labelledby={`${id}-seal`} />
      </div>
      <fieldset className="theme-group">
        <legend>{t("density")}</legend>
        <div className="theme-segment">
          <label>
            <input
              type="radio"
              name={`${id}-density`}
              checked={density.value === "comfortable"}
              onChange={() => density.setValue("comfortable")}
            />
            <span>{t("comfortable")}</span>
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-density`}
              checked={density.value === "compact"}
              onChange={() => density.setValue("compact")}
            />
            <span>{t("compact")}</span>
          </label>
        </div>
      </fieldset>
      <fieldset className="theme-group">
        <legend>{t("motion")}</legend>
        <div className="theme-segment">
          <label>
            <input
              type="radio"
              name={`${id}-motion`}
              checked={motion.value === "system"}
              onChange={() => motion.setValue("system")}
            />
            <span>{t("system")}</span>
          </label>
          <label>
            <input
              type="radio"
              name={`${id}-motion`}
              checked={motion.value === "reduced"}
              onChange={() => motion.setValue("reduced")}
            />
            <span>{t("reduced")}</span>
          </label>
        </div>
      </fieldset>
      <button
        type="button"
        className="theme-reset"
        onClick={resetDisplayPreferences}
      >
        {t("reset")}
      </button>
    </>
  );
}
