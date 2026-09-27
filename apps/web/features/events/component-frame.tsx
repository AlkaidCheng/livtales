"use client";

import type { EventComponentView } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { HeadMenu } from "../../components/head-menu";
import { LayoutIcon } from "../../components/icons";
import { tr } from "../../i18n/active-locale";
import { componentViewLabel } from "../../lib/event-components";
import type { ViewOption } from "./view-options";

/**
 * The heading every Event component shares: title, a count when the
 * component keeps one, then its controls and one action. `offScreen`
 * keeps it off the screen, for a view whose tab names it there: it still
 * prints, and a screen reader still finds it among the headings.
 */
export function PanelHeading({
  action,
  caption,
  controls,
  count,
  offScreen = false,
  title,
}: {
  readonly action?: ReactNode;
  /** The sort and filter the view is read with, printed under the title. */
  readonly caption?: string | undefined;
  readonly controls?: ReactNode;
  /** What the component holds, read beside the title: "3 open". */
  readonly count?: string | undefined;
  readonly offScreen?: boolean;
  readonly title: string;
}) {
  return (
    <header className={`panel-heading${offScreen ? " off-screen" : ""}`}>
      <div>
        <h2>{title}</h2>
        {count === undefined ? null : <p className="panel-count">{count}</p>}
        {caption === undefined ? null : (
          <p className="print-caption">{caption}</p>
        )}
      </div>
      {controls === undefined && action === undefined ? null : (
        <div className="panel-tools">
          {controls}
          {action}
        </div>
      )}
    </header>
  );
}

/**
 * One quiet control reading the current layout that opens the templates a
 * component offers (List, By day, By week, Calendar); nothing when it
 * offers one.
 */
export function LayoutControl({
  busy = false,
  labelOf = componentViewLabel,
  onChange,
  view,
  views,
}: {
  readonly busy?: boolean;
  /** What a view is called on this kind, when not the shared name ("Day" for the itinerary's by-day). */
  readonly labelOf?: (view: EventComponentView) => string;
  readonly onChange: (view: EventComponentView) => void;
  readonly view: EventComponentView;
  readonly views: readonly EventComponentView[];
}) {
  const t = useTranslations("controls");
  if (views.length < 2) return null;
  return (
    <HeadMenu
      busy={busy}
      entries={views.map((option) => ({
        kind: "radio",
        label: labelOf(option),
        checked: option === view,
        onSelect: () => {
          if (option !== view) onChange(option);
        },
      }))}
      icon={<LayoutIcon />}
      label={t("layout")}
      name={labelOf(view)}
    />
  );
}

/**
 * Layout as a row of a view's options on a phone, its templates side by
 * side (or a list, past three); nothing when the view offers one.
 */
export function layoutOption({
  busy = false,
  labelOf = componentViewLabel,
  onChange,
  view,
  views,
}: {
  readonly busy?: boolean;
  readonly labelOf?: (view: EventComponentView) => string;
  readonly onChange: (view: EventComponentView) => void;
  readonly view: EventComponentView;
  readonly views: readonly EventComponentView[];
}): ViewOption | null {
  if (views.length < 2) return null;
  return {
    kind: "segments",
    id: "layout",
    label: tr("controls")("layout"),
    value: view,
    choices: views.map((option) => ({ value: option, label: labelOf(option) })),
    onChange: (value) => {
      const next = views.find((option) => option === value);
      if (next !== undefined) onChange(next);
    },
    busy,
  };
}

/**
 * The actions of one row, in the shared order: the row's own action (Edit,
 * Download), then a state change (Dismiss), then History, then Actions.
 */
export function RowActions({ children }: { readonly children: ReactNode }) {
  return <div className="row-actions">{children}</div>;
}

/** A calendar-style date mark: the month above the day. */
export function DateTile({
  dateTime,
  day,
  month,
}: {
  readonly dateTime: string | undefined;
  readonly day: string;
  readonly month: string;
}) {
  return (
    <time className="date-tile" dateTime={dateTime}>
      <span>{month.toUpperCase()}</span>
      <strong>{day}</strong>
    </time>
  );
}

const statuses = [
  "cancelled",
  "dismissed",
  "done",
  "in_progress",
  "pending",
  "todo",
  "triggered",
] as const;

function isStatus(value: string): value is (typeof statuses)[number] {
  return (statuses as readonly string[]).includes(value);
}

/** A status of a Task or Reminder as a labelled chip. */
export function StatusChip({ status }: { readonly status: string }) {
  const t = useTranslations("taskRow.status");
  return (
    <span className={`status-chip status-${status}`}>
      {isStatus(status) ? t(status) : status}
    </span>
  );
}

const objectTypeKeys = {
  event: "scheduledEvent",
  expense: "expense",
  note: "note",
  person: "person",
  reminder: "reminder",
  task: "task",
} as const;

/** The kind of a canonical object as people read it, in the active language. */
export function objectTypeLabel(objectType: string): string {
  const key = objectTypeKeys[objectType as keyof typeof objectTypeKeys];
  return key === undefined ? objectType : tr("objectTypes")(key);
}
