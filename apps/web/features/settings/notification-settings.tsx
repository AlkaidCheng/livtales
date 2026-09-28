"use client";

import { useTranslations } from "next-intl";

import { ErrorNotice } from "../../components/feedback";
import { useSessionQuery, useUpdatePreferences } from "../../lib/queries";
import { SettingRow } from "./setting-row";

/**
 * The Notifications section of Settings: whether a pop-up names the
 * changes others make on the page being viewed. The choice is kept on the
 * account; the changes arrive either way.
 */
export function NotificationSettings() {
  const t = useTranslations("settings");
  const user = useSessionQuery().data?.user;
  const preferences = useUpdatePreferences();
  const on = user?.changeNotices ?? true;
  return (
    <>
      <SettingRow caption={t("othersChangesNote")} label={t("othersChanges")}>
        {(control) => (
          <input
            {...control}
            aria-checked={on}
            checked={on}
            className="settings-switch-input"
            disabled={user === undefined}
            onChange={(event) =>
              preferences.mutate({ changeNotices: event.target.checked })
            }
            role="switch"
            type="checkbox"
          />
        )}
      </SettingRow>
      {preferences.isError ? <ErrorNotice error={preferences.error} /> : null}
    </>
  );
}
