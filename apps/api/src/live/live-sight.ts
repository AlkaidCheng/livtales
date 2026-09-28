import { grantReaches, type GrantedRecord } from "@livtales/authorization";
import type { SightGrant, WorkspaceSight } from "@livtales/object-model";

function active(grant: SightGrant, now: Date): boolean {
  return grant.expiresAt === null || grant.expiresAt > now;
}

/** Whether a viewer with this sight of the record's workspace may view the record. */
export function seesRecord(
  sight: WorkspaceSight,
  record: GrantedRecord,
  now: Date,
): boolean {
  return (
    sight.member ||
    sight.grants.some(
      (grant) => active(grant, now) && grantReaches(grant, record),
    )
  );
}

/**
 * Whether a viewer may see a section of an Event: all of them through
 * membership or a whole grant, else the sections of a view shared whole
 * and those shared on their own.
 */
export function seesSection(
  sight: WorkspaceSight,
  event: { readonly id: string; readonly scopeId: string },
  section: { readonly id: string; readonly view: string },
  now: Date,
): boolean {
  return (
    sight.member ||
    sight.grants.some(
      (grant) =>
        active(grant, now) &&
        (grant.resourceId === event.id || grant.resourceId === event.scopeId) &&
        (grant.scope === "all" ||
          (grant.scope === section.view &&
            (grant.sectionId === null || grant.sectionId === section.id))),
    )
  );
}
