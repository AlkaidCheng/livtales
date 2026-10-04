// @vitest-environment jsdom

import type { RevisionListResponse } from "@livtales/schemas";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { useCommandTransition } from "../lib/queries";
import { refusalWords, useStepRefusalNotice } from "../lib/undo-refusal";

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const viewerId = "019d6e7d-0000-7000-8000-000000000002";
const chenId = "019d6e7d-0000-7000-8000-000000000003";
const taskId = "019d6e7d-0000-7000-8000-000000000010";
const commandId = "019d6e7d-0000-7000-8000-000000000020";

type Revision = RevisionListResponse["items"][number];

function revision(overrides: Partial<Revision> = {}): Revision {
  return {
    id: "019d6e7d-0000-7000-8000-000000000030",
    objectId: taskId,
    objectVersion: 4,
    mutationKind: "updated",
    actorType: "user",
    actorId: chenId,
    actorDisplayName: "Chen Li",
    createdAt: "2030-01-01T00:00:00.000Z",
    snapshotSchemaVersion: 1,
    sourceRevisionId: null,
    changedFields: [],
    changedFieldCount: 0,
    ...overrides,
  };
}

function changed(...fields: string[]): Partial<Revision> {
  return {
    changedFields: fields.map((field) => ({
      field,
      label: field,
      valueType: "text" as const,
      before: null,
      after: null,
      beforePresent: true,
      afterPresent: true,
      restorable: true,
    })),
    changedFieldCount: fields.length,
  };
}

describe("refusalWords", () => {
  const chen = { userId: chenId, displayName: "Chen Li" };

  it("names the person and the one or two parts they changed", () => {
    expect(refusalWords(revision(changed("dueOn", "dueAt")), viewerId)).toEqual(
      { key: "changedOne", actor: chen, part: "due" },
    );
    expect(
      refusalWords(revision(changed("displayName", "labelIds")), viewerId),
    ).toEqual({
      key: "changedTwo",
      actor: chen,
      first: "name",
      second: "labels",
    });
  });

  it("names only the person for three parts, parts not shown, or none", () => {
    for (const fields of [
      changed("displayName", "dueOn", "location"),
      { ...changed("displayName"), changedFieldCount: 4 },
      changed("customProperties.room"),
      changed(),
    ])
      expect(refusalWords(revision(fields), viewerId)).toEqual({
        key: "updated",
        actor: chen,
      });
  });

  it("says only that the object changed for the viewer's own change or no person", () => {
    for (const latest of [
      revision({ actorId: viewerId }),
      revision({ actorType: "system", actorId: null }),
      revision({ actorDisplayName: null }),
      undefined,
    ])
      expect(refusalWords(latest, viewerId)).toEqual({ key: "changed" });
  });
});

const session = {
  principal: { type: "user", userId: viewerId, workspaceId },
  user: {
    id: viewerId,
    displayName: "Kai",
    email: "kai@example.com",
    username: "kai",
    findByName: true,
    findByEmail: true,
    onboardedAt: "2026-09-01T09:00:00.000Z",
    locale: null,
    timeZone: null,
    hourCycle: null,
    weekStart: null,
    rail: {},
    eventTabs: {},
    workspaceRecency: {},
    changeNotices: true,
  },
  workspace: { id: workspaceId, displayName: "Kai's workspace" },
  availableWorkspaces: [
    {
      id: workspaceId,
      displayName: "Kai's workspace",
      personal: true,
      ownerDisplayName: "Kai",
      role: "owner",
    },
  ],
};

/** Answers the command, revision, and session routes; records each request. */
function stubApi(latest: Revision) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url === "/api/auth/session") return Response.json(session);
      if (url === "/api/commands")
        return Response.json({
          version: 4,
          undo: { commandId, available: false },
          redo: null,
        });
      if (url === "/api/commands/undo")
        return Response.json(
          {
            error: {
              code: "version_conflict",
              message:
                "The object changed after the supplied version was read.",
              objectId: taskId,
            },
          },
          { status: 409 },
        );
      if (url.startsWith(`/api/objects/${taskId}/revisions`))
        return Response.json({ items: [latest], nextBeforeVersion: 3 });
      return Response.json({}, { status: 404 });
    }),
  );
  return calls;
}

function UndoButton() {
  const undo = useCommandTransition("undo", useStepRefusalNotice("undo"));
  return (
    <button onClick={() => undo.mutate()} type="button">
      Undo
    </button>
  );
}

describe("a refused undo", () => {
  beforeEach(() => {
    window.sessionStorage.setItem(
      "chronelle.session",
      JSON.stringify({ accessToken: "test-session", workspaceId }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  it("is sent though the step is marked changed, and says who changed what since", async () => {
    const calls = stubApi(revision(changed("dueOn")));
    render(<UndoButton />, { wrapper: Providers });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't undo: Chen Li changed the due date since",
    );
    expect(calls).toContain("POST /api/commands/undo");
    expect(calls).toContain(`GET /api/objects/${taskId}/revisions?limit=1`);
  });

  it("says only that it was changed when the viewer changed it", async () => {
    stubApi(revision({ actorId: viewerId, actorDisplayName: "Kai" }));
    render(<UndoButton />, { wrapper: Providers });
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Can't undo: this record was changed since",
    );
  });
});
