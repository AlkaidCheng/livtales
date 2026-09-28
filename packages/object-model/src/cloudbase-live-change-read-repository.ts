import {
  grantScopes,
  type CloudBaseRdbReader,
  type GrantScope,
} from "@livtales/db";

import {
  cloudbaseIdBatchSize,
  readCloudBaseObjectRows,
  readCloudBaseResources,
} from "./cloudbase-object-read-support.js";
import {
  cloudbaseFilters,
  cloudbaseNullableDate,
  cloudbaseNullableText,
  cloudbaseText,
  readCloudBaseSubtasks,
  type CloudBaseGrantRow,
} from "./cloudbase-read-support.js";
import {
  shownOnFrom,
  type LiveChangeReadRepository,
  type ShownObject,
  type WorkspaceSight,
} from "./live-change-reads.js";
import type { EventPlanningResource } from "./types.js";

type RelationRow = {
  readonly source_object_id: unknown;
  readonly target_object_id: unknown;
};

/** The reads for announcing confirmed changes, served by the gateway. */
export class CloudBaseLiveChangeReadRepository implements LiveChangeReadRepository {
  readonly #client: CloudBaseRdbReader;

  constructor(client: CloudBaseRdbReader) {
    this.#client = client;
  }

  async readSight(
    userId: string,
    workspaceId: string,
    now: Date,
  ): Promise<WorkspaceSight> {
    const memberships = await this.#client.select<{ readonly role: unknown }>(
      "workspace_members",
      {
        columns: "role",
        filters: cloudbaseFilters(
          ["workspace_id", "eq", workspaceId],
          ["user_id", "eq", userId],
        ),
      },
    );
    if (memberships.length > 0) return { member: true, grants: [] };
    const rows = await this.#client.select<CloudBaseGrantRow>(
      "resource_grants",
      {
        columns: "resource_id,scope,section_id,expires_at",
        filters: cloudbaseFilters(
          ["workspace_id", "eq", workspaceId],
          ["principal_type", "eq", "user"],
          ["principal_id", "eq", userId],
        ),
      },
    );
    return {
      member: false,
      grants: rows.flatMap((row) => {
        const expiresAt = cloudbaseNullableDate(row.expires_at, "grant expiry");
        if (expiresAt !== null && expiresAt <= now) return [];
        const scope = cloudbaseText(row.scope, "grant scope");
        if (!grantScopes.includes(scope as GrantScope))
          throw new Error("CloudBase returned an invalid grant scope.");
        return [
          {
            resourceId: cloudbaseText(row.resource_id, "grant resource"),
            scope: scope as GrantScope,
            sectionId: cloudbaseNullableText(row.section_id, "grant section"),
            expiresAt,
          },
        ];
      }),
    };
  }

  async readStates(
    workspaceId: string,
    objectIds: readonly string[],
    options: { readonly subtasks?: boolean | undefined } = {},
  ): Promise<EventPlanningResource[]> {
    const ids = [...new Set(objectIds)];
    if (ids.length === 0) return [];
    const workspace = { workspaceId };
    const subtasks =
      options.subtasks === true
        ? await readCloudBaseSubtasks(this.#client, workspace, ids)
        : [];
    const rows = await readCloudBaseObjectRows(
      this.#client,
      workspace,
      [
        ...ids,
        ...subtasks.map((row) => cloudbaseText(row.object_id, "subtask id")),
      ],
      { includeDeleted: true },
    );
    return [
      ...(await readCloudBaseResources(this.#client, workspace, rows)).values(),
    ];
  }

  async readShownOn(
    workspaceId: string,
    shown: readonly ShownObject[],
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    if (shown.length === 0) return new Map();
    const documents = shown
      .filter(({ objectType }) => objectType === "document")
      .map(({ id }) => id);
    const attachments = (
      await this.#relations(
        workspaceId,
        "attached_to",
        "source_object_id",
        documents,
      )
    ).map((row) => ({
      document: cloudbaseText(row.source_object_id, "attached document"),
      target: cloudbaseText(row.target_object_id, "attachment target"),
    }));
    const inclusions = (
      await this.#relations(workspaceId, "includes", "target_object_id", [
        ...shown.map(({ id }) => id),
        ...attachments.map(({ target }) => target),
      ])
    ).map((row) => ({
      event: cloudbaseText(row.source_object_id, "including event"),
      target: cloudbaseText(row.target_object_id, "included object"),
    }));
    return shownOnFrom(shown, attachments, inclusions);
  }

  async #relations(
    workspaceId: string,
    relationType: "includes" | "attached_to",
    column: "source_object_id" | "target_object_id",
    values: readonly string[],
  ): Promise<RelationRow[]> {
    const unique = [...new Set(values)];
    const rows: RelationRow[] = [];
    for (let start = 0; start < unique.length; start += cloudbaseIdBatchSize)
      rows.push(
        ...(await this.#client.select<RelationRow>("object_relations", {
          columns: "source_object_id,target_object_id",
          filters: cloudbaseFilters(
            ["workspace_id", "eq", workspaceId],
            ["relation_type", "eq", relationType],
            ["deleted_at", "is", null],
            [column, "in", unique.slice(start, start + cloudbaseIdBatchSize)],
          ),
        })),
      );
    return rows;
  }
}
