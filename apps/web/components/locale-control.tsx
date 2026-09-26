"use client";

import { useTranslations } from "next-intl";

import {
  isLocale,
  type LocaleChoice,
  useLocaleChoice,
} from "../i18n/locale-preference";
import { locales } from "../i18n/locales";
import { MenuSelect } from "./menu-select";

/**
 * The language menu: System for the browser's, then each language in its
 * own language. Settings shows it under Language & time, labelled by its
 * row, where a change is also kept on the account through `onChange`.
 */
export function LocaleControl({
  onChange,
  label,
  ...attributes
}: {
  readonly id?: string;
  readonly label: string;
  readonly "aria-labelledby"?: string;
  readonly "aria-describedby"?: string;
  readonly onChange?: ((choice: LocaleChoice) => void) | undefined;
}) {
  const t = useTranslations("theme");
  const { choice, setChoice } = useLocaleChoice();
  return (
    <MenuSelect<LocaleChoice>
      {...attributes}
      label={label}
      onChange={(next) => {
        const chosen = isLocale(next) ? next : "system";
        setChoice(chosen);
        onChange?.(chosen);
      }}
      options={[
        { value: "system", label: t("system") },
        ...locales.map((locale) => ({
          value: locale.tag,
          label: locale.native,
          lang: locale.tag,
        })),
      ]}
      value={choice}
    />
  );
}
