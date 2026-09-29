import type { ReminderResponse } from "@livtales/schemas";
import { tr } from "../i18n/active-locale";
import { changedFields } from "./changed-entries";
import { type DayKey, parseDayKey, today } from "./day-placement";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";
import { wallInstant } from "./zone";

export function readReminderFields(
  reminder?: Pick<ReminderResponse, "displayName" | "remindAt">,
) {
  return {
    displayName: reminder?.displayName ?? "",
    remindAt: toDateTimeInput(reminder?.remindAt ?? null),
  };
}

/** The fields a reminder's editors hold: the name and the moment as a datetime-local value. */
export type ReminderFields = ReturnType<typeof readReminderFields>;

export function reminderFieldsPayload(
  fields: ReminderFields,
  source?: Pick<ReminderResponse, "remindAt">,
) {
  const remindAt = editedInstant(fields.remindAt, source?.remindAt, "reminder");
  if (remindAt === null) throw new Error(tr("validation")("reminderInstant"));
  return { displayName: fields.displayName, remindAt };
}

/** What a reminder's draft changed from the version it stands on, as the API takes it. */
export function reminderChanges(
  fields: ReminderFields,
  baseline: ReminderFields,
  source?: Pick<ReminderResponse, "remindAt">,
) {
  return changedFields(
    (draft: ReminderFields) => reminderFieldsPayload(draft, source),
    fields,
    baseline,
  );
}

/**
 * The instant a quickly added reminder is due: 9:00 in the account's zone
 * on the given day, or, with no day, the next 9:00 (today's while it is
 * ahead, otherwise tomorrow's).
 */
export function quickReminderInstant(day: DayKey | null, now: Date): string {
  const nineOn = (date: Date) =>
    wallInstant({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: 9,
      minute: 0,
    });
  if (day !== null) return nineOn(parseDayKey(day)).toISOString();
  const todayAtNine = nineOn(today(now));
  if (todayAtNine > now) return todayAtNine.toISOString();
  const tomorrow = today(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return nineOn(tomorrow).toISOString();
}
