"use client";

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
 * because it changed or went away.
 */
export function useFollowedObject(
  target: Target,
  {
    inTrash = false,
    refusals = [],
  }: {
    readonly inTrash?: boolean;
    /** The failures of the confirmation's requests, newest first. */
    readonly refusals?: readonly unknown[];
  } = {},
): FollowedObject {
  const news = useObjectNews(target.id);
  const state = news?.state;
  const newest =
    state !== undefined && state.version > target.version ? state : target;
  let gone = news === null ? null : goneOf(news, inTrash);
  for (const error of refusals) gone ??= refusalOf(error);
  return {
    name: newest.displayName,
    version: newest.version,
    news,
    gone,
  };
}
