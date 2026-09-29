import { describe, expect, it } from "vitest";

import { changedFields } from "../lib/changed-entries";

const build = (fields: { name: string; amount: string; currency: string }) => {
  if (fields.amount === "") throw new Error("An amount is needed.");
  return {
    displayName: fields.name,
    amount: fields.amount,
    currency: fields.currency,
    labels: [fields.currency],
  };
};
const baseline = { name: "Tickets", amount: "12", currency: "EUR" };

describe("changedFields", () => {
  it("sends only the entries that differ from the baseline", () => {
    expect(changedFields(build, baseline, baseline)).toEqual({});
    expect(
      changedFields(build, { ...baseline, name: "Rail" }, baseline),
    ).toEqual({ displayName: "Rail" });
  });

  it("compares objects by value and sends a whole group for one entry", () => {
    expect(
      changedFields(build, { ...baseline, currency: "JPY" }, baseline, [
        ["amount", "currency"],
      ]),
    ).toEqual({ amount: "12", currency: "JPY", labels: ["JPY"] });
  });

  it("sends the whole save when the baseline no longer builds", () => {
    expect(changedFields(build, baseline, { ...baseline, amount: "" })).toEqual(
      build(baseline),
    );
  });

  it("refuses fields that do not build", () => {
    expect(() =>
      changedFields(build, { ...baseline, amount: "" }, baseline),
    ).toThrow("An amount is needed.");
  });
});
