"use client";

import type { EventListItem } from "@livtales/schemas";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { ChevronDownIcon } from "../../components/icons";
import type { EventFolds } from "../../lib/event-folds";
import { type EventGroups, undatedGroupKey } from "../../lib/event-groups";
import { useDisplayPreferences } from "../../lib/use-display-preferences";

/** The first day of a month as a UTC instant, for naming it in any zone. */
function monthStart(year: number, month: number): Date {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, 1);
  return date;
}

/**
 * A group's heading: one button that folds the group to this line and
 * opens it again, its chevron turned while folded. A year reads in the
 * display face and shows its count only when folded; a month reads in
 * small capitals with its count.
 */
function FoldHeading({
  level,
  tone,
  name,
  count,
  open,
  onToggle,
}: {
  readonly level: 2 | 3;
  readonly tone: "year" | "month";
  readonly name: string;
  readonly count: number | null;
  readonly open: boolean;
  readonly onToggle: () => void;
}) {
  const t = useTranslations("events");
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <Heading className={`event-fold-heading event-fold-${tone}`}>
      <button
        aria-expanded={open}
        className="event-fold"
        onClick={onToggle}
        type="button"
      >
        <span className="event-fold-name">{name}</span>
        {count === null ? null : (
          // The space parts the name and the count when read aloud; the
          // flex row does not draw it.
          <>
            {" "}
            <span className="event-fold-count">
              {t("groupCount", { count })}
            </span>
          </>
        )}
        <ChevronDownIcon className="event-fold-chevron" />
      </button>
    </Heading>
  );
}

/**
 * The Events list by year, then month, with the undated events last under
 * No date yet. Each heading folds its group; the cards of a month keep
 * the list's layout, so on a wide screen the headings run across the grid.
 */
export function EventMonthGroups({
  groups,
  folds,
  layout,
  card,
}: {
  readonly groups: EventGroups<EventListItem>;
  readonly folds: EventFolds;
  readonly layout: "grid" | "list";
  /** One card, its name a heading one level under the group's. */
  readonly card: (event: EventListItem, level: 3 | 4) => ReactNode;
}) {
  const t = useTranslations("events");
  const { locale } = useDisplayPreferences();
  const yearName = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    timeZone: "UTC",
  });
  const monthName = new Intl.DateTimeFormat(locale, {
    month: "long",
    timeZone: "UTC",
  });
  const cards = (events: readonly EventListItem[], level: 3 | 4) => (
    <div className={`event-grid event-layout-${layout}`}>
      {events.map((event) => card(event, level))}
    </div>
  );
  const undatedOpen = !folds.isFolded(undatedGroupKey);
  return (
    <div className="event-groups">
      {groups.years.map((year) => {
        const open = !folds.isFolded(year.key);
        return (
          <div className="event-year" key={year.key}>
            <FoldHeading
              count={open ? null : year.count}
              level={2}
              name={yearName.format(monthStart(year.year, 1))}
              onToggle={() => folds.toggle(year.key)}
              open={open}
              tone="year"
            />
            {open
              ? year.months.map((month) => {
                  const monthOpen = !folds.isFolded(month.key);
                  return (
                    <div className="event-month" key={month.key}>
                      <FoldHeading
                        count={month.events.length}
                        level={3}
                        name={monthName.format(
                          monthStart(year.year, month.month),
                        )}
                        onToggle={() => folds.toggle(month.key)}
                        open={monthOpen}
                        tone="month"
                      />
                      {monthOpen ? cards(month.events, 4) : null}
                    </div>
                  );
                })
              : null}
          </div>
        );
      })}
      {groups.undated.length > 0 ? (
        <div className="event-month event-undated">
          <FoldHeading
            count={groups.undated.length}
            level={2}
            name={t("noDate")}
            onToggle={() => folds.toggle(undatedGroupKey)}
            open={undatedOpen}
            tone="month"
          />
          {undatedOpen ? cards(groups.undated, 3) : null}
        </div>
      ) : null}
    </div>
  );
}
