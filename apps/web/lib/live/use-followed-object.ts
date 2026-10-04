"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { invalidateCanonical } from "../queries";
import { useObjectNews } from "./live-provider";
import { type Gone, goneOf, type ObjectNews, refusalOf } from "./object-news";

interface Target {
  readonly id: string;
  readonly displayName: string;
  readonly version: number;
}

export interface FollowedObject {
  /** The object's newest name, which the confirmation states. */
  readonly name: string;
  /** The object's newest version, which the confirmed action sends. */
  readonly version: number;
  /** The latest change others made to it since the confirmation opened. */
  readonly news: ObjectNews | null;
  /** Why the confirmation no longer applies; null while it does. */
  readonly gone: Gone | null;
}

/**
 * Follows the object an open confirmation is about, through the changes
 * the live stream brings: its name and version move to the newest, and
 * `gone` says why the confirmation no longer applies once the object went
 * to Trash (or, for one about a record in Trash, came out of it), left the
 * page, or stopped being visible, or once the server refused the action
 * because it changed or went away. A refusal also has the page's copies
 * read again, since the change behind it did not reach them.
 */
export function useFollowedObject(
  target: Target,
  {
    inTrash = false,
    refusals = [],
  }: {
    readonly inTrash?: boolean;
    /** The failures of the confirmation's requests, most telling first. */
    readonly refusals?: readonly unknown[];
  } = {},
): FollowedObject {
  const cache = useQueryClient();
  const news = useObjectNews(target.id);
  const state = news?.state;
  const newest =
    state !== undefined && state.version > target.version ? state : target;
  let refused: Gone | null = null;
  for (const error of refusals) refused ??= refusalOf(error);
  const refusedKind = refused?.kind;
  useEffect(() => {
    if (refusedKind !== undefined) void invalidateCanonical(cache);
  }, [cache, refusedKind]);
  return {
    name: newest.displayName,
    version: newest.version,
    news,
    gone: (news === null ? null : goneOf(news, inTrash)) ?? refused,
  };
}
