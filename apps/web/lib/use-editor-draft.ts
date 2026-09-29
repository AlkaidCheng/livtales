"use client";

import { useState } from "react";

interface VersionedResource {
  readonly id: string;
  readonly version: number;
}

export interface EditorDraftSnapshot<Resource, Fields> {
  readonly source: Resource | undefined;
  readonly fields: Fields;
  readonly baseline: Fields;
}

/** Fields an editor changes together: one changed carries the others. */
export type FieldGroups<Fields> = readonly (readonly (keyof Fields)[])[];

/** The fields a draft changed from its baseline, each with the rest of its group. */
function changedKeys<Fields extends object>(
  fields: Fields,
  baseline: Fields,
  groups: FieldGroups<Fields> = [],
): Set<keyof Fields> {
  const changed = new Set(
    (Object.keys(fields) as (keyof Fields)[]).filter(
      (key) => !Object.is(fields[key], baseline[key]),
    ),
  );
  for (const group of groups)
    if (group.some((key) => changed.has(key)))
      for (const key of group) changed.add(key);
  return changed;
}

/**
 * Keeps flat editor fields and their baseline on the newest version of
 * their record. When a newer version arrives, the draft moves onto it: the
 * fields the person changed keep their values (with the rest of their
 * group), and the others take the newer version's, so a save sends the
 * person's changes over what others changed meanwhile.
 */
export function useEditorDraft<
  Resource extends VersionedResource,
  Fields extends object,
>(
  latest: Resource | undefined,
  initialize: (source: Resource | undefined) => Fields,
  initial?: EditorDraftSnapshot<Resource, Fields>,
  groups: FieldGroups<Fields> = [],
) {
  function read(source: Resource | undefined) {
    const fields = initialize(source);
    return { source, fields, baseline: fields };
  }
  const [draft, setDraft] = useState(() => initial ?? read(latest));

  function load(source: Resource | undefined) {
    setDraft(read(source));
  }

  if (draft.source?.id !== latest?.id) {
    load(latest);
  } else if (
    draft.source !== undefined &&
    latest !== undefined &&
    latest.version > draft.source.version
  ) {
    const theirs = initialize(latest);
    const fields = { ...theirs };
    for (const key of changedKeys(draft.fields, draft.baseline, groups))
      fields[key] = draft.fields[key];
    setDraft({ source: latest, fields, baseline: theirs });
  }

  return {
    snapshot: draft,
    source: draft.source,
    fields: draft.fields,
    baseline: draft.baseline,
    isDirty: changedKeys(draft.fields, draft.baseline).size > 0,
    change: (fields: Partial<Fields>) =>
      setDraft((current) => ({
        ...current,
        fields: { ...current.fields, ...fields },
      })),
    accept: (saved: Resource) => load(saved),
  };
}
