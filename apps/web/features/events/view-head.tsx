"use client";

import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useEffect } from "react";
import { createPortal } from "react-dom";

import { useIsPhone } from "../../lib/use-media";
import { PanelHeading } from "./component-frame";
import type { ViewShare } from "./share-control";
import {
  ActiveChips,
  type ViewChip,
  type ViewOption,
  ViewOptionsButton,
} from "./view-options";

/**
 * What the event page gives the view shown as its tab: the places on the
 * strip for the view's controls and its chips, and a way to show its
 * count on the tab.
 */
export interface ViewTab {
  /** The strip's end, where the view's controls (or its options button) go. */
  readonly controls: HTMLElement | null;
  /** The line under the strip, where the view's chips go. */
  readonly chips: HTMLElement | null;
  /** Shows the view's count on its tab, or nothing for null. */
  readonly onCount: (count: TabCount | null) => void;
}

/** A count on a tab: the figure it shows, and what it counts for a screen reader. */
export interface TabCount {
  readonly value: number;
  readonly label: string;
}

const ViewTabContext = createContext<ViewTab | null>(null);

export const ViewTabProvider = ViewTabContext.Provider;

/** The event page's places for the view shown as its tab; null inside a page. */
export function useViewTab(): ViewTab | null {
  return useContext(ViewTabContext);
}

/**
 * The head of an Event view. Inside a page it is the component's heading:
 * its title, its count, its controls, and one action. Shown as the event's
 * tab, its heading is off the screen (on paper and among a screen reader's
 * headings alone): the tab names the view and carries `tabCount`, the
 * controls and the action go to the strip's end (on a phone, one options
 * button over `options`), and the chips go under the strip.
 */
export function ViewHead({
  action,
  caption,
  chips = [],
  controls,
  count,
  onClearChips,
  options = [],
  share,
  tabCount,
  title,
}: {
  readonly action?: ReactNode;
  /** The sort and filter the view is read with, printed under the title. */
  readonly caption?: string | undefined;
  /** The choices that differ from their defaults, each able to clear itself. */
  readonly chips?: readonly ViewChip[];
  /** The controls on a wide screen: Sort, Filter, Layout, Export, Share. */
  readonly controls?: ReactNode;
  /** What the view holds, beside a page component's title: "3 open". */
  readonly count?: string | undefined;
  /** Sets every chip's choice back to its default. */
  readonly onClearChips?: (() => void) | undefined;
  /** The rows of the options pop-up on a phone. */
  readonly options?: readonly ViewOption[];
  /** The view's share, offered at the end of the phone's options. */
  readonly share?: ViewShare | undefined;
  /** How many open items the view holds, shown on its tab. */
  readonly tabCount?: TabCount | undefined;
  readonly title: string;
}) {
  const t = useTranslations("share");
  const tab = useViewTab();
  const isPhone = useIsPhone();
  const onCount = tab?.onCount;
  const countValue = tabCount?.value;
  const countLabel = tabCount?.label;
  useEffect(() => {
    onCount?.(
      countValue === undefined || countLabel === undefined
        ? null
        : { value: countValue, label: countLabel },
    );
  }, [onCount, countValue, countLabel]);
  useEffect(() => () => onCount?.(null), [onCount]);
  // The options close before Share opens, handing focus back to their
  // button, which the sheet then returns focus to.
  const phoneOptions: readonly ViewOption[] =
    share?.canShare === true
      ? [
          ...options,
          {
            kind: "action",
            id: "share",
            label: t("view"),
            onPress: () =>
              share.show(
                document.activeElement instanceof HTMLElement
                  ? document.activeElement
                  : null,
              ),
          },
        ]
      : options;
  if (tab === null)
    return (
      <PanelHeading
        action={action}
        caption={caption}
        controls={controls}
        count={count}
        title={title}
      />
    );
  const strip = isPhone ? (
    phoneOptions.length === 0 ? null : (
      <span className="view-options-host">
        <ViewOptionsButton
          active={chips.length > 0}
          options={phoneOptions}
          title={title}
        />
        {share?.sheet}
      </span>
    )
  ) : controls === undefined && action === undefined ? null : (
    <span className="event-strip-controls">
      {controls}
      {action}
    </span>
  );
  return (
    <>
      <PanelHeading caption={caption} count={count} offScreen title={title} />
      {tab.controls === null || strip === null
        ? null
        : createPortal(strip, tab.controls)}
      {tab.chips === null || chips.length === 0
        ? null
        : createPortal(
            <ActiveChips
              chips={chips}
              onClearAll={
                onClearChips ??
                (() => {
                  for (const chip of chips) chip.onClear();
                })
              }
            />,
            tab.chips,
          )}
    </>
  );
}
