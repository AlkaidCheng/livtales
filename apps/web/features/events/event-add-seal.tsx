"use client";

import type { SectionView } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useState } from "react";

import { AddSeal } from "../../components/add-seal";
import { type EventAddKind, eventAddKindsFor } from "../../lib/event-add-kinds";
import type { EventView } from "../../lib/event-views";
import { useEventSectionsQuery } from "../../lib/queries";
import { CreateScheduleDialog } from "./create-schedule-dialog";
import { ExpenseForm } from "./expense-form";
import { NoteForm } from "./note-form";
import { ReminderForm } from "./reminder-form";
import { TaskForm } from "./task-form";

const kindIcons: Record<EventAddKind, ReactNode> = {
  task: (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  ),
  schedule: (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </svg>
  ),
  expense: (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18M16 14h2" />
    </svg>
  ),
  reminder: (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  ),
  note: (
    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M9 11h7M9 15h7" />
    </svg>
  ),
};

/**
 * The add button on an Event, for an account that may edit it: its menu
 * offers a Task, a Schedule item, an Expense, a Reminder, and a Note, the
 * kind the current view lists first, and each opens the editor that kind
 * uses on its own view, with the Event's sections where the kind has them.
 */
export function EventAddSeal({
  eventId,
  eventName,
  view,
}: {
  readonly eventId: string;
  readonly eventName: string;
  readonly view: EventView;
}) {
  const t = useTranslations("addSeal");
  const types = useTranslations("objectTypes");
  const [adding, setAdding] = useState<EventAddKind | null>(null);
  const sections = useEventSectionsQuery(
    eventId,
    adding === "task" || adding === "expense",
  );
  const sectionsOf = (of: SectionView) =>
    sections.data?.filter((section) => section.view === of);
  const close = useCallback(() => setAdding(null), []);
  const labels: Record<EventAddKind, string> = {
    task: types("task"),
    schedule: types("scheduleItem"),
    expense: types("expense"),
    reminder: types("reminder"),
    note: types("note"),
  };
  return (
    <>
      <AddSeal
        items={eventAddKindsFor(view).map((kind) => ({
          id: kind,
          label: labels[kind],
          icon: kindIcons[kind],
          onSelect: () => setAdding(kind),
        }))}
        label={t("addTo", { name: eventName })}
        title={t("title")}
      />
      {adding === "task" ? (
        <TaskForm
          eventId={eventId}
          onCancel={close}
          sections={sectionsOf("todos")}
        />
      ) : null}
      {adding === "schedule" ? (
        <CreateScheduleDialog eventId={eventId} onClose={close} />
      ) : null}
      {adding === "expense" ? (
        <ExpenseForm
          eventId={eventId}
          onCancel={close}
          sections={sectionsOf("expenses")}
        />
      ) : null}
      {adding === "reminder" ? (
        <ReminderForm eventId={eventId} onCancel={close} />
      ) : null}
      {adding === "note" ? (
        <NoteForm eventId={eventId} onCancel={close} />
      ) : null}
    </>
  );
}
