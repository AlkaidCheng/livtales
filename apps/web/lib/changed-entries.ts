/** Entries of a save the API checks together: one changed sends them all. */
export type EntryGroups<Payload> = readonly (readonly (keyof Payload)[])[];

const same = (first: unknown, second: unknown) =>
  Object.is(first, second) ||
  (typeof first === "object" &&
    typeof second === "object" &&
    JSON.stringify(first) === JSON.stringify(second));

/**
 * The entries of a save that differ from the version it was made on, so a
 * save sends only what its editor changed and leaves the rest as others
 * left it; an entry of a group sends the whole group.
 */
function changedEntries<Payload extends Record<string, unknown>>(
  next: Payload,
  base: Payload,
  groups: EntryGroups<Payload> = [],
): Partial<Payload> {
  const changed = new Set(
    (Object.keys(next) as (keyof Payload)[]).filter(
      (key) => !same(next[key], base[key]),
    ),
  );
  for (const group of groups)
    if (group.some((key) => changed.has(key)))
      for (const key of group) if (key in next) changed.add(key);
  const entries: Partial<Payload> = {};
  for (const key of changed) entries[key] = next[key];
  return entries;
}

/**
 * The entries a draft changed, as `build` turns fields into a save. A
 * baseline `build` refuses (a version the editor's checks would not pass
 * now) counts as changed throughout, so the whole save is sent.
 */
export function changedFields<Fields, Payload extends Record<string, unknown>>(
  build: (fields: Fields) => Payload,
  fields: Fields,
  baseline: Fields,
  groups: EntryGroups<Payload> = [],
): Partial<Payload> {
  const next = build(fields);
  let base: Payload;
  try {
    base = build(baseline);
  } catch {
    return next;
  }
  return changedEntries(next, base, groups);
}
