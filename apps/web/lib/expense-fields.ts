import type { ExpenseResponse } from "@livtales/schemas";
import { tr } from "../i18n/active-locale";
import { changedFields } from "./changed-entries";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";
import { sectionPayload } from "./task-fields";
import type { FieldGroups } from "./use-editor-draft";

export function readExpenseFields(
  expense?: Pick<
    ExpenseResponse,
    "displayName" | "amount" | "currency" | "occurredAt"
  > & { readonly sectionId?: string | null | undefined },
): ExpenseFields {
  return {
    displayName: expense?.displayName ?? "",
    amount: expense?.amount ?? "",
    currency: expense?.currency ?? "USD",
    occurredAt: toDateTimeInput(
      expense?.occurredAt ?? new Date().toISOString(),
    ),
    // The section's id, empty for a loose expense; a source that names no
    // section (a draft kept before the field existed) leaves it out.
    ...(expense?.sectionId === undefined
      ? {}
      : { section: expense.sectionId ?? "" }),
  };
}

/** The editor's flat fields, every one text. */
export type ExpenseFields = {
  readonly displayName: string;
  readonly amount: string;
  readonly currency: string;
  readonly occurredAt: string;
  readonly section?: string | undefined;
};

/** Keeps decimal text and unchanged transaction instants lossless. */
export function expenseFieldsPayload(
  fields: ExpenseFields,
  source?: Pick<ExpenseResponse, "occurredAt">,
) {
  const occurredAt = editedInstant(
    fields.occurredAt,
    source?.occurredAt,
    "transaction",
  );
  if (occurredAt === null)
    throw new Error(tr("validation")("transactionInstant"));
  const { section, ...rest } = fields;
  return { ...rest, occurredAt, ...sectionPayload(section) };
}

/** An expense's amount and currency, which a draft keeps or follows together. */
export const expenseFieldGroups: FieldGroups<ExpenseFields> = [
  ["amount", "currency"],
];

/**
 * What an expense's draft changed from the version it stands on, as the
 * API takes it: only those entries, the amount and currency together.
 */
export function expenseChanges(
  fields: ExpenseFields,
  baseline: ExpenseFields,
  source?: Pick<ExpenseResponse, "occurredAt">,
) {
  return changedFields(
    (draft: ExpenseFields) => expenseFieldsPayload(draft, source),
    fields,
    baseline,
    [["amount", "currency"]],
  );
}
