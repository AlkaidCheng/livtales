"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { usePresence } from "../../lib/live/live-provider";
import { faceOf, type LivePerson, others } from "../../lib/live/live-people";
import { useSessionQuery } from "../../lib/queries";
import { useIsPhone } from "../../lib/use-media";

function Face({ person }: { readonly person: LivePerson }) {
  const face = faceOf(person);
  return (
    <span
      aria-hidden="true"
      className="live-face"
      data-initials={face.initials}
      data-tone={face.tone}
    />
  );
}

/**
 * The other people on a page, as faces in its head: the three who arrived
 * last, newest first (two on a phone), then how many more. Pointing at a
 * face names the person; pressing or pointing at the count lists everyone
 * on the page.
 */
export function LiveFaces({ page }: { readonly page: string | null }) {
  const t = useTranslations("live");
  const viewerId = useSessionQuery().data?.user.id;
  const people = others(usePresence(page), viewerId);
  const shownFaces = useIsPhone() ? 2 : 3;
  const [pinned, setPinned] = useState(false);
  const [pointed, setPointed] = useState(false);
  const group = useRef<HTMLDivElement>(null);
  const listId = useId();
  const open = pinned || pointed;
  useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => {
      if (!group.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [pinned]);
  if (people.length === 0) return null;
  const shown = people.slice(0, shownFaces);
  const rest = people.length - shown.length;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset groups form controls; this groups faces and the count that lists them.
    <div
      className="live-faces"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setPinned(false);
          setPointed(false);
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") setPointed(false);
      }}
      ref={group}
      role="group"
    >
      <ul aria-label={t("here")} className="live-faces-row">
        {shown.map((person) => (
          <li
            aria-label={person.displayName}
            data-tip={person.displayName}
            key={person.userId}
          >
            <Face person={person} />
          </li>
        ))}
      </ul>
      {rest === 0 ? null : (
        <button
          aria-controls={listId}
          aria-expanded={open}
          aria-label={t("everyone", { count: people.length })}
          className="live-face live-face-more"
          onClick={() => setPinned((current) => !current)}
          onPointerEnter={(event) => {
            if (event.pointerType === "mouse") setPointed(true);
          }}
          type="button"
        >
          +{rest}
        </button>
      )}
      {open && rest > 0 ? (
        <ul aria-label={t("here")} className="live-people" id={listId}>
          {people.map((person) => (
            <li key={person.userId}>
              <Face person={person} />
              {person.displayName}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
