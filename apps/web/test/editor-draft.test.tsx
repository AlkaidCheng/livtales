// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEditorDraft } from "../lib/use-editor-draft";

interface Resource {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
  readonly currency?: string;
}

const initial: Resource = { id: "first", version: 1, displayName: "Initial" };
const initialize = (source: Resource | undefined) => ({
  displayName: source?.displayName ?? "",
  amount: "",
  currency: source?.currency ?? "USD",
});

afterEach(cleanup);

describe("useEditorDraft", () => {
  it("moves a recovered draft onto the newest version, keeping what it changed", () => {
    const baseline = initialize(initial);
    const recovered = {
      source: initial,
      baseline,
      fields: { ...baseline, displayName: "Kept draft" },
    };
    const latest = { ...initial, version: 2, currency: "EUR" };
    const { result, rerender } = renderHook(
      (resource: Resource) => useEditorDraft(resource, initialize, recovered),
      { initialProps: latest },
    );
    expect(result.current.source).toBe(latest);
    expect(result.current.baseline).toEqual(initialize(latest));
    expect(result.current.fields).toEqual({
      displayName: "Kept draft",
      amount: "",
      currency: "EUR",
    });
    expect(result.current.isDirty).toBe(true);
    rerender({ ...latest, id: "different", displayName: "Another event" });
    expect(result.current.fields.displayName).toBe("Another event");
    expect(result.current.isDirty).toBe(false);
  });

  it("compares flat fields with their loaded baseline", () => {
    const { result } = renderHook(() => useEditorDraft(initial, initialize));
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.change({ displayName: "Draft" }));
    expect(result.current.isDirty).toBe(true);
    act(() => result.current.change({ displayName: "Initial" }));
    expect(result.current.isDirty).toBe(false);
    act(() =>
      result.current.accept({ ...initial, version: 2, displayName: "Saved" }),
    );
    expect(result.current.isDirty).toBe(false);
    act(() => result.current.change({ currency: "EUR" }));
    expect(result.current.isDirty).toBe(true);
  });

  it("follows a newer version, keeping the fields changed and taking the others", () => {
    const { result, rerender } = renderHook(
      (latest: Resource) => useEditorDraft(latest, initialize),
      { initialProps: initial },
    );
    act(() => result.current.change({ amount: "12" }));
    const latest = {
      ...initial,
      version: 2,
      displayName: "Collaborator",
      currency: "EUR",
    };
    rerender(latest);
    expect(result.current.source).toBe(latest);
    expect(result.current.fields).toEqual({
      displayName: "Collaborator",
      amount: "12",
      currency: "EUR",
    });
    expect(result.current.isDirty).toBe(true);
  });

  it("keeps a changed field's group together when following a newer version", () => {
    const { result, rerender } = renderHook(
      (latest: Resource) =>
        useEditorDraft(latest, initialize, undefined, [["amount", "currency"]]),
      { initialProps: initial },
    );
    act(() => result.current.change({ amount: "12" }));
    rerender({ ...initial, version: 2, currency: "EUR" });
    expect(result.current.fields).toEqual({
      displayName: "Initial",
      amount: "12",
      currency: "USD",
    });
  });

  it("accepts saved fields and version while parent data is behind", () => {
    const { result, rerender } = renderHook(
      (latest: Resource) => useEditorDraft(latest, initialize),
      { initialProps: initial },
    );
    const saved = { ...initial, version: 2, displayName: "Saved" };
    act(() => result.current.accept(saved));
    act(() => result.current.change({ displayName: "Next draft" }));
    rerender({ ...initial });
    expect(result.current.source).toBe(saved);
    expect(result.current.fields.displayName).toBe("Next draft");
    rerender({ ...saved });
    expect(result.current.fields.displayName).toBe("Next draft");
  });

  it("resets fields and source together when switching objects or entering creation", () => {
    const { result, rerender } = renderHook(
      (latest: Resource | undefined) => useEditorDraft(latest, initialize),
      { initialProps: initial as Resource | undefined },
    );
    act(() =>
      result.current.change({ displayName: "First draft", currency: "EUR" }),
    );
    const second = { ...initial, id: "second", displayName: "Second" };
    rerender(second);
    expect(result.current.source).toBe(second);
    expect(result.current.fields).toEqual(initialize(second));
    rerender(undefined);
    expect(result.current.source).toBeUndefined();
    expect(result.current.fields).toEqual(initialize(undefined));
    rerender(initial);
    expect(result.current.source).toBe(initial);
    expect(result.current.fields).toEqual(initialize(initial));
  });

  it("merges queued field changes and partial creation resets without reinitializing", () => {
    const createFields = vi.fn(initialize);
    const { result, rerender } = renderHook(() =>
      useEditorDraft(undefined, createFields),
    );
    act(() => {
      result.current.change({ displayName: "Deposit", amount: "12.3400" });
      result.current.change({ currency: "EUR" });
    });
    expect(result.current.fields).toEqual({
      displayName: "Deposit",
      amount: "12.3400",
      currency: "EUR",
    });
    act(() => result.current.change({ displayName: "", amount: "" }));
    rerender();
    expect(result.current.fields).toEqual({
      displayName: "",
      amount: "",
      currency: "EUR",
    });
    expect(createFields).toHaveBeenCalledOnce();
  });
});
