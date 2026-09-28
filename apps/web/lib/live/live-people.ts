import type { LivePresence } from "@livtales/schemas";

import { personInitials } from "../person-collection";

export type LivePerson = LivePresence["people"][number];

type People = LivePresence["people"];
const nobody: People = [];

/** How many tones faces take, each one of the palette's own colors. */
const tones = 6;

/** A person's tone, the same on every page and device. */
export function faceTone(userId: string): number {
  let hash = 0;
  for (const character of userId)
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % tones;
}

/** The letters and tone of a person's face. */
export function faceOf(person: {
  readonly userId: string;
  readonly displayName: string;
}) {
  return {
    initials: personInitials(person.displayName),
    tone: faceTone(person.userId),
  };
}

/** The people on a page other than the viewer. */
export function others(
  people: readonly LivePerson[],
  viewerId: string | undefined,
): LivePerson[] {
  return people.filter((person) => person.userId !== viewerId);
}

/** Who is on each page, as the connection last said, newest arrival first. */
export class PresenceStore {
  readonly #people = new Map<string, People>();
  readonly #listeners = new Set<() => void>();

  set(presence: LivePresence): void {
    const before = this.#people.get(presence.page) ?? nobody;
    const now = new Map(
      presence.people.map((person) => [person.userId, person]),
    );
    const arrived = presence.people.filter(
      (person) => !before.some((known) => known.userId === person.userId),
    );
    const stayed = before.flatMap((known) => {
      const person = now.get(known.userId);
      return person === undefined ? [] : [person];
    });
    const people = [...arrived, ...stayed];
    if (people.length === 0) this.#people.delete(presence.page);
    else this.#people.set(presence.page, people);
    for (const listener of this.#listeners) listener();
  }

  get(page: string): People {
    return this.#people.get(page) ?? nobody;
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}
