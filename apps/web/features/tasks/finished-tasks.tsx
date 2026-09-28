"use client";

import { useTranslations } from "next-intl";

/** The heading over the finished tasks a list shows after the open ones. */
export function FinishedHead({ count }: { readonly count: number }) {
  const t = useTranslations("todos");
  return (
    <div className="finished-head">
      <h3 className="finished-head-title">{t("finishedHeading", { count })}</h3>
    </div>
  );
}
