import { rankAfter, rankBetween } from "@livtales/schemas";

interface Ranked {
  readonly id: string;
  readonly rank: string;
}

/** Ranks first, then ids, as the API lists a collection in manual order. */
export function byRank(a: Ranked, b: Ranked): number {
  return a.rank < b.rank
    ? -1
    : a.rank > b.rank
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
}

/**
 * The rank of a record placed between two neighbours. When the neighbours
 * are not themselves in rank order (a subtask nested under its parent, a
 * group ordered by something else) the record goes just after the one
 * before it.
 */
export function rankBetweenRows(
  before: Ranked | undefined,
  after: Ranked | undefined,
): string {
  try {
    return rankBetween(before?.rank ?? null, after?.rank ?? null);
  } catch {
    return before === undefined
      ? rankAfter(after?.rank ?? null)
      : rankBetween(before.rank, null);
  }
}

/**
 * A move in manual order as the API takes it: the record the moved one now
 * follows, or, at the top, the one it now precedes. The server places it
 * there in the order as it stands.
 */
export type Placement =
  { readonly afterId: string } | { readonly beforeId: string };

/**
 * The move that drops a record at `index` among `rows` (which exclude it):
 * after the row before the gap, or before the first. Null among no rows,
 * where any place is the same.
 */
export function placeAtIndex(
  rows: readonly Ranked[],
  index: number,
): Placement | null {
  const before = rows[index - 1];
  if (before !== undefined) return { afterId: before.id };
  const after = rows[index];
  return after === undefined ? null : { beforeId: after.id };
}

/**
 * Whether dropping a record at `index` among `rows` (which exclude it)
 * leaves it where it was in `from`: the same neighbours on both sides.
 */
export function staysInPlace(
  from: readonly Ranked[],
  id: string,
  rows: readonly Ranked[],
  index: number,
): boolean {
  const at = from.findIndex((row) => row.id === id);
  if (at < 0) return false;
  const others = from.filter((row) => row.id !== id);
  if (others.length !== rows.length) return false;
  if (others.some((row, position) => row.id !== rows[position]?.id))
    return false;
  return index === at;
}

/**
 * The move one place up or down among its rows: before the row above or
 * after the row below. Null when the record is already first or last.
 */
export function placeForStep(
  rows: readonly Ranked[],
  id: string,
  direction: -1 | 1,
): Placement | null {
  const at = rows.findIndex((row) => row.id === id);
  if (at < 0) return null;
  const neighbour = rows[at + direction];
  if (neighbour === undefined) return null;
  return direction < 0 ? { beforeId: neighbour.id } : { afterId: neighbour.id };
}
