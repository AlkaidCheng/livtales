"use client";

import type { EventResponse } from "@livtales/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { RefObject } from "react";

import { HeadMenu } from "../../components/head-menu";
import { DownloadIcon } from "../../components/icons";
import { dayKeyOf } from "../../lib/day-placement";
import { csvFile, exportFileName, saveFile } from "../../lib/export/csv";
import { type CalendarItem, icsFile } from "../../lib/export/ics";
import { printPanel } from "../../lib/export/print";
import type { ExportSheet } from "../../lib/export/sheets";
import { queryKeys } from "../../lib/queries";
import type { ViewOption } from "./view-options";

/** One way a view is exported: a short label for a button, a full name for a menu. */
export interface ExportFormat {
  readonly id: "pdf" | "csv" | "ics";
  readonly label: string;
  readonly name: string;
  readonly run: () => void;
}

/**
 * The ways a view is exported, as it is shown, with its sort, filter, and
 * layout applied: as a PDF (the browser's print dialog over the view
 * alone), as data (a CSV file named after the event, the view, and the
 * day), and, for a view of scheduled items, as a calendar file (.ics)
 * named after the event.
 */
export function useViewExport({
  calendar,
  eventId,
  panel,
  sheet,
  view,
  viewName,
}: {
  /** The scheduled items the view shows, for a view that offers a calendar file. */
  readonly calendar?: (() => readonly CalendarItem[]) | undefined;
  readonly eventId: string;
  readonly panel: RefObject<HTMLElement | null>;
  /**
   * The rows the view holds, in its order, built when an export is asked
   * for; the event's name is passed for a sheet that carries it.
   */
  readonly sheet: (eventName: string) => ExportSheet;
  /** The view's kind, marked on the document while it prints. */
  readonly view: string;
  /** The view as people read it: the file's name and the printed heading. */
  readonly viewName: string;
}): readonly ExportFormat[] {
  const t = useTranslations("export");
  const cache = useQueryClient();
  const eventName = () =>
    cache.getQueryData<EventResponse>(queryKeys.eventResource(eventId))
      ?.displayName ?? "";

  function exportCsv() {
    const name = eventName();
    const { columns, rows } = sheet(name);
    saveFile(
      `${exportFileName([name, viewName, dayKeyOf(new Date())])}.csv`,
      csvFile(
        columns.map((column) => t(`columns.${column}`)),
        rows,
      ),
      "text/csv;charset=utf-8",
    );
  }

  function exportPdf() {
    if (panel.current === null) return;
    printPanel(panel.current, view);
  }

  function exportCalendar(items: () => readonly CalendarItem[]) {
    const name = eventName();
    saveFile(
      `${exportFileName([name === "" ? viewName : name])}.ics`,
      icsFile(items(), { name, now: new Date() }),
      "text/calendar;charset=utf-8",
    );
  }

  return [
    { id: "pdf", label: t("short.pdf"), name: t("pdf"), run: exportPdf },
    { id: "csv", label: t("short.csv"), name: t("csv"), run: exportCsv },
    ...(calendar === undefined
      ? []
      : [
          {
            id: "ics" as const,
            label: t("short.ics"),
            name: t("ics"),
            run: () => exportCalendar(calendar),
          },
        ]),
  ];
}

/** Export among a view's controls: one quiet control whose menu lists the formats. */
export function ExportControl({
  formats,
}: {
  readonly formats: readonly ExportFormat[];
}) {
  const t = useTranslations("export");
  return (
    <HeadMenu
      entries={formats.map((format) => ({
        kind: "item",
        label: format.name,
        onSelect: format.run,
      }))}
      icon={<DownloadIcon />}
      label={t("title")}
    />
  );
}

/** Export as a row of the phone's options: one small button per format. */
export function exportOption(
  formats: readonly ExportFormat[],
  label: string,
): ViewOption {
  return {
    kind: "buttons",
    id: "export",
    label,
    buttons: formats.map((format) => ({
      id: format.id,
      label: format.label,
      name: format.name,
      onPress: format.run,
    })),
  };
}
