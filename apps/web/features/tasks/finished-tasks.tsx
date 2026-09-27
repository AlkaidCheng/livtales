"use client";

import { useTranslations } from "next-intl";

/**
 * The foot of a task list while it hides the finished tasks: how many
 * there are, and Show, which lists them after the open ones.
 */
export function FinishedFoot({
  count,
  more = false,
  onShow,
}: {
  readonly count: number;
  /** Whether more are finished than were counted. */
  readonly more?: boolean;
  readonly onShow: () => void;
}) {
  const t = useTranslations("todos");
  return (
    <button className="finished-foot" onClick={onShow} type="button">
      <span>
        {more ? t("finishedMore", { count }) : t("finished", { count })}
      </span>
      <span className="finished-foot-show">{t("showFinished")}</span>
    </button>
  );
}

/** The heading over the finished tasks listed after the open ones, with Hide. */
export function FinishedHead({
  count,
  onHide,
}: {
  readonly count: number;
  readonly onHide: () => void;
}) {
  const t = useTranslations("todos");
  return (
    <div className="finished-head">
      <h3 className="finished-head-title">{t("finishedHeading", { count })}</h3>
      <button onClick={onHide} type="button">
        {t("hideFinished")}
      </button>
    </div>
  );
}
