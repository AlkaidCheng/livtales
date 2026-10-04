"use client";

import type { RevisionListResponse } from "@livtales/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useCallback } from "react";

import { useNotices } from "../components/notices";
import { useApiClient } from "./api-context";
import { heldState } from "./live/apply-live-change";
import { type Part, partsOfFields } from "./live/live-notice";
import { faceOf } from "./live/live-people";
import { sessionAccountId } from "./queries";

type Revision = RevisionListResponse["items"][number];

/** The person whose change stands in a refused step's way. */
interface Actor {
  readonly userId: string;
  readonly displayName: string;
}

/**
 * What a refused undo or redo says: who changed the object since and the
 * one or two parts they changed, who changed it, or only that it changed.
 */
export type RefusalWords =
  | { readonly key: "changedOne"; readonly actor: Actor; readonly part: Part }
  | {
      readonly key: "changedTwo";
      readonly actor: Actor;
      readonly first: Part;
      readonly second: Part;
    }
  | { readonly key: "updated"; readonly actor: Actor }
  | { readonly key: "changed" };

/**
 * The words for a step refused because its object changed since, from the
 * object's latest revision. A revision by the viewer, or one that names no
 * person, says only that the object changed.
 */
export function refusalWords(
  latest: Revision | undefined,
  viewerId: string | undefined,
): RefusalWords {
  if (
    latest === undefined ||
    latest.actorType !== "user" ||
    latest.actorId === null ||
    latest.actorId === viewerId ||
    latest.actorDisplayName === null
  )
    return { key: "changed" };
  const actor = {
    userId: latest.actorId,
    displayName: latest.actorDisplayName,
  };
  const parts =
    latest.changedFieldCount === latest.changedFields.length
      ? partsOfFields(latest.changedFields.map((change) => change.field))
      : null;
  const [first, second, ...more] = parts ?? [];
  if (first === undefined || more.length > 0) return { key: "updated", actor };
  if (second === undefined) return { key: "changedOne", actor, part: first };
  return { key: "changedTwo", actor, first, second };
}

/**
 * Says why the server refused an undo or redo, in a notice with the face
 * of the person whose change stands in its way. The step has already left
 * the stack.
 */
export function useStepRefusalNotice(direction: "undo" | "redo") {
  const t = useTranslations("undo.refused");
  const parts = useTranslations("live.parts");
  const client = useApiClient();
  const cache = useQueryClient();
  const { post } = useNotices();
  return useCallback(
    async (objectId: string) => {
      const [latest, viewerId] = await Promise.all([
        client
          .listObjectRevisions(objectId, { limit: 1 })
          .then((page) => page.items[0])
          .catch(() => undefined),
        sessionAccountId(client, cache),
      ]);
      const words = refusalWords(latest, viewerId);
      const type = heldState(cache, objectId)?.objectType ?? "other";
      const message =
        words.key === "changed"
          ? t("changed", { direction, type })
          : words.key === "updated"
            ? t("updated", { direction, type, name: words.actor.displayName })
            : words.key === "changedOne"
              ? t("changedOne", {
                  direction,
                  name: words.actor.displayName,
                  part: parts(words.part),
                })
              : t("changedTwo", {
                  direction,
                  name: words.actor.displayName,
                  first: parts(words.first),
                  second: parts(words.second),
                });
      post({
        key: "undo-refused",
        message,
        tone: "danger",
        ...(words.key !== "changed" && { face: faceOf(words.actor) }),
      });
    },
    [cache, client, direction, parts, post, t],
  );
}
