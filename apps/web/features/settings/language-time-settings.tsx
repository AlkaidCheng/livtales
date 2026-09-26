"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import type { PreferencesRequest } from "@livtales/schemas";

import { ErrorNotice } from "../../components/feedback";
import { LocaleControl } from "../../components/locale-control";
import { TimeZonePicker } from "../../components/time-zone-picker";
import { formatDateTime } from "../../lib/format";
import { useSessionQuery, useUpdatePreferences } from "../../lib/queries";
import { useClock } from "../../lib/use-clock";
import { languageHourCycle, languageWeekStart } from "../../i18n/locales";
import { useDisplayPreferences } from "../../lib/use-display-preferences";
import { SettingRow } from "./setting-row";

/**
 * Language & time, a row each: the language (also kept on the account), the
 * clock, with the moment under its name, the first day of the week, and
 * the time zone (the device's, or one found by city, country, or name in
 * the zone picker). Each change is kept on the account and applies at
 * once. The menus show a choice from the moment it is made: the pending
 * keys overlay the session's user until the account has answered.
 */
export function LanguageTimeSettings() {
  const t = useTranslations("preferences");
  const session = useSessionQuery();
  const update = useUpdatePreferences();
  const [pending, setPending] = useState<PreferencesRequest>({});
  const user = session.data?.user;
  const now = useClock();
  const { locale } = useDisplayPreferences();
  const choose = (input: PreferencesRequest) => {
    setPending((current) => ({ ...current, ...input }));
    update.mutate(input, { onSettled: () => setPending({}) });
  };
  const timeZone =
    pending.timeZone !== undefined
      ? pending.timeZone
      : (user?.timeZone ?? null);
  const hourCycle =
    pending.hourCycle !== undefined
      ? pending.hourCycle
      : (user?.hourCycle ?? null);
  const weekStart =
    pending.weekStart !== undefined
      ? pending.weekStart
      : (user?.weekStart ?? null);
  // What From language comes to in the display language.
  const languageClock =
    languageHourCycle(locale) === "h23" ? t("twentyFourHour") : t("twelveHour");
  const languageDay =
    languageWeekStart(locale) === 1 ? t("monday") : t("sunday");
  return (
    <div className="setting-rows setting-rows-menus">
      <SettingRow label={t("language")}>
        {(control) => (
          <LocaleControl
            {...control}
            className="setting-select"
            onChange={(choice) =>
              update.mutate({ locale: choice === "system" ? null : choice })
            }
          />
        )}
      </SettingRow>
      <SettingRow
        caption={t("now", {
          time: formatDateTime(new Date(now).toISOString(), locale),
        })}
        label={t("timeFormat")}
      >
        {(control) => (
          <select
            {...control}
            className="setting-select"
            onChange={(event) => {
              const next = event.target.value;
              choose({
                hourCycle: next === "h12" || next === "h23" ? next : null,
              });
            }}
            value={hourCycle ?? ""}
          >
            <option value="">
              {t("fromLanguageChoice", { choice: languageClock })}
            </option>
            <option value="h12">{t("twelveHour")}</option>
            <option value="h23">{t("twentyFourHour")}</option>
          </select>
        )}
      </SettingRow>
      <SettingRow label={t("weekStart")}>
        {(control) => (
          <select
            {...control}
            className="setting-select"
            onChange={(event) => {
              const next = Number(event.target.value);
              choose({ weekStart: next === 1 || next === 7 ? next : null });
            }}
            value={weekStart ?? ""}
          >
            <option value="">
              {t("fromLanguageChoice", { choice: languageDay })}
            </option>
            <option value={1}>{t("monday")}</option>
            <option value={7}>{t("sunday")}</option>
          </select>
        )}
      </SettingRow>
      <TimeZoneRow
        onChange={(timeZone) => choose({ timeZone })}
        value={timeZone}
      />
      {update.isError ? <ErrorNotice error={update.error} /> : null}
    </div>
  );
}

/** The time zone as Settings shows it: a row with the zone picker. */
function TimeZoneRow({
  onChange,
  value,
}: {
  readonly onChange: (timeZone: string | null) => void;
  readonly value: string | null;
}) {
  const t = useTranslations("preferences");
  return (
    <SettingRow caption={t("timeZoneNote")} label={t("timeZone")}>
      {(control) => (
        <TimeZonePicker
          {...control}
          align="end"
          className="setting-zone"
          onChange={onChange}
          value={value}
        />
      )}
    </SettingRow>
  );
}

/**
 * The time zone alone, as the Welcome step asks for it; the picker's times
 * follow the clock the step has chosen.
 */
export function TimeZoneField({
  hourCycle,
  onChange,
  value,
}: {
  readonly hourCycle?: "h12" | "h23" | null;
  readonly onChange: (timeZone: string | null) => void;
  readonly value: string | null;
}) {
  const t = useTranslations("preferences");
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {t("timeZone")}
      </label>
      <TimeZonePicker
        hourCycle={hourCycle}
        id={id}
        onChange={onChange}
        value={value}
      />
    </div>
  );
}
