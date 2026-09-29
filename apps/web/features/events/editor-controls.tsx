"use client";

import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { ErrorNotice } from "../../components/feedback";
import { EditorSubmitButton } from "../../components/editor-form";
import { useCanonicalInvalidation } from "../../lib/queries";

interface EditorControlsProps {
  readonly mutation: {
    readonly isPending: boolean;
    readonly isError: boolean;
    readonly isSuccess: boolean;
    readonly error: unknown;
    readonly reset: () => void;
  };
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly submitLabel: string;
  readonly disabled?: boolean;
}

/**
 * A form's foot: Cancel and the submit button, the save's status, and a
 * refusal with the draft kept and a way to read the newest version.
 */
export function EditorControls({
  mutation,
  onCancel,
  onRefresh,
  submitLabel,
  disabled = false,
}: EditorControlsProps) {
  const refreshing = useRef(false);
  const invalidate = useCanonicalInvalidation();
  const currentMutation = useRef(mutation);
  currentMutation.current = mutation;
  const t = useTranslations("editor");
  const common = useTranslations("common");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);

  /** Reads the newest version and clears the refusal once it lands. */
  async function refresh() {
    if (onRefresh === undefined || refreshing.current) return;
    refreshing.current = true;
    setIsRefreshing(true);
    setRefreshError(null);
    const failed = mutation.error;
    try {
      await onRefresh();
      // Whatever lists stand behind the editor learn of the newer version too.
      void invalidate();
      if (
        currentMutation.current.isError &&
        currentMutation.current.error === failed
      ) {
        mutation.reset();
      }
    } catch (error) {
      setRefreshError(error);
    } finally {
      refreshing.current = false;
      setIsRefreshing(false);
    }
  }

  return (
    <>
      {mutation.isError ? (
        <>
          <ErrorNotice
            error={mutation.error}
            onRefresh={
              onRefresh === undefined ? undefined : () => void refresh()
            }
            refreshLabel={t("refreshLatest")}
            isRefreshing={isRefreshing}
          />
          <p className="editor-help">
            {t("draftKept", { submit: submitLabel })}
            {onRefresh === undefined ? "" : ` ${t("refreshOnlyChecks")}`}
          </p>
          {refreshError === null ? null : <ErrorNotice error={refreshError} />}
        </>
      ) : null}
      <div className="form-actions">
        {onCancel === undefined ? null : (
          <button
            className="button button-quiet"
            disabled={mutation.isPending}
            onClick={onCancel}
            type="button"
          >
            {common("cancel")}
          </button>
        )}
        <EditorSubmitButton
          className="button button-primary"
          disabled={disabled || mutation.isPending}
        >
          {mutation.isPending ? t("saving") : submitLabel}
        </EditorSubmitButton>
      </div>
      <p
        aria-label={t("saveStatus")}
        className={mutation.isSuccess ? "editor-help" : "visually-hidden"}
        role="status"
      >
        {mutation.isPending
          ? t("savingChanges")
          : mutation.isSuccess
            ? t("saved")
            : ""}
      </p>
    </>
  );
}
