import { describe, expect, it } from "vitest";
import {
  byRank,
  placeAtIndex,
  placeForStep,
  rankBetweenRows,
  staysInPlace,
} from "../lib/collection-order";

const a = { id: "a", rank: "00000001000" };
const b = { id: "b", rank: "00000002000" };
const c = { id: "c", rank: "00000003000" };
const rows = [a, b, c];

describe("collection order", () => {
  it("orders by rank, then id", () => {
    const shuffled = [c, { id: "a2", rank: "00000001000" }, a];
    expect([...shuffled].sort(byRank).map((row) => row.id)).toEqual([
      "a",
      "a2",
      "c",
    ]);
  });

  it("places a drop after the row before the gap, or before the first", () => {
    expect(placeAtIndex(rows, 0)).toEqual({ beforeId: "a" });
    expect(placeAtIndex(rows, 1)).toEqual({ afterId: "a" });
    expect(placeAtIndex(rows, 3)).toEqual({ afterId: "c" });
    expect(placeAtIndex([], 0)).toBeNull();
  });

  it("goes after the row before when the neighbours are out of order", () => {
    expect(rankBetweenRows(c, a)).toBe("00000004000");
    expect(rankBetweenRows(undefined, a)).toBe("00000000500");
  });

  it("steps one place before the row above or after the row below", () => {
    expect(placeForStep(rows, "c", -1)).toEqual({ beforeId: "b" });
    expect(placeForStep(rows, "a", 1)).toEqual({ afterId: "b" });
    expect(placeForStep(rows, "a", -1)).toBeNull();
    expect(placeForStep(rows, "c", 1)).toBeNull();
    expect(placeForStep(rows, "zz", 1)).toBeNull();
  });

  it("knows when a drop leaves a row where it was", () => {
    const others = [a, c];
    expect(staysInPlace(rows, "b", others, 1)).toBe(true);
    expect(staysInPlace(rows, "b", others, 0)).toBe(false);
    expect(staysInPlace(rows, "b", others, 2)).toBe(false);
    expect(staysInPlace(rows, "b", [a], 1)).toBe(false);
  });
});
