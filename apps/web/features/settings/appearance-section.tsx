"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";

import { PaletteTiles, SealTiles } from "../../components/appearance-tiles";
import { useInstallControl } from "../../components/install-app";
import { displayChoices } from "../../lib/display-preferences";
import {
  resetDisplayPreferences,
  useDisplayPreference,
} from "../../lib/use-display-preference";
import { type SettingControl, SettingRow } from "./setting-row";

/**
 * Appearance, a row each: the Theme panel's mode, palette and add button
 * tiles, density, and motion, repeated here so Settings holds every
 * preference, and the install control, which like them concerns this
 * device. The display choices' reset sits at the foot.
 */
export function AppearanceSection() {
  const t = useTranslations("theme");
  const settings = useTranslations("settings");
  const install = useTranslations("install");
  const appearance = useDisplayPreference("appearance");
  const density = useDisplayPreference("density");
  const motion = useDisplayPreference("motion");
  const installer = useInstallControl();
  return (
    <div className="setting-rows">
      <SettingRow
        caption={settings("appearanceNote")}
        kind="choices"
        label={t("mode")}
      >
        {(control) => (
          <Choices
            {...control}
            choices={displayChoices.appearance}
            label={(choice) => t(choice)}
            onChange={appearance.setValue}
            value={appearance.value}
          />
        )}
      </SettingRow>
      <SettingRow kind="choices" label={t("palette")} stacked>
        {(control) => <PaletteTiles {...control} />}
      </SettingRow>
      <SettingRow kind="choices" label={t("button")} stacked>
        {(control) => <SealTiles {...control} />}
      </SettingRow>
      <SettingRow kind="choices" label={t("density")}>
        {(control) => (
          <Choices
            {...control}
            choices={displayChoices.density}
            label={(choice) => t(choice)}
            onChange={density.setValue}
            value={density.value}
          />
        )}
      </SettingRow>
      <SettingRow kind="choices" label={t("motion")}>
        {(control) => (
          <Choices
            {...control}
            choices={displayChoices.motion}
            label={(choice) => t(choice)}
            onChange={motion.setValue}
            value={motion.value}
          />
        )}
      </SettingRow>
      <SettingRow
        caption={
          installer.mode === "none" ? install("browserMenu") : install("note")
        }
        kind="action"
        label={install("title")}
      >
        {(control) =>
          installer.mode === "none" ? null : (
            <button
              {...control}
              aria-haspopup={installer.mode === "ios" ? "dialog" : undefined}
              className="setting-button"
              onClick={installer.activate}
              type="button"
            >
              {install("title")}
            </button>
          )
        }
      </SettingRow>
      {installer.steps}
      <button
        className="setting-reset"
        onClick={resetDisplayPreferences}
        type="button"
      >
        {t("reset")}
      </button>
    </div>
  );
}

/**
 * A few short choices side by side, the current one marked: radios in a
 * group the row's label names.
 */
function Choices<Value extends string>({
  choices,
  label,
  onChange,
  value,
  ...control
}: SettingControl & {
  readonly choices: readonly Value[];
  readonly label: (choice: Value) => string;
  readonly onChange: (choice: Value) => void;
  readonly value: Value;
}) {
  const name = useId();
  return (
    <fieldset {...control} className="setting-choices">
      {choices.map((choice) => (
        <label className="setting-choice" key={choice}>
          <input
            checked={value === choice}
            className="setting-choice-input"
            name={name}
            onChange={() => onChange(choice)}
            type="radio"
            value={choice}
          />
          <span className="setting-choice-label">{label(choice)}</span>
        </label>
      ))}
    </fieldset>
  );
}
