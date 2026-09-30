// @vitest-environment jsdom
import type { LiveChange } from "@livtales/schemas";
import {
  act,
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { useOpenLifecycle } from "../features/recovery/lifecycle-provider";
import type { LiveSignal } from "../lib/live/live-signals";
import { useFollowedObject } from "../lib/live/use-followed-object";
import type { LifecycleTarget } from "../lib/recovery-queries";

const live = vi.hoisted(() => ({
  send: null as ((signal: LiveSignal) => void) | null,
}));
vi.mock("../lib/live/live-transport", () => ({
  openLiveTransport: ({
    onSignal,
  }: {
    readonly onSignal: (signal: LiveSignal) => void;
  }) => {
    live.send = onSignal;
    return { setPages() {}, setActive() {}, close() {} };
  },
}));

const workspaceId = "019d6e7d-0000-7000-8000-000000000001";
const eventId = "019d6e7d-0000-7000-8000-000000000002";
const taskId = "019d6e7d-0000-7000-8000-000000000003";
const relationId = "019d6e7d-0000-7000-8000-000000000005";
const chen = "019d6e7d-0000-7000-8000-00000000000c";
const target: LifecycleTarget = {
  id: taskId,
  eventId,
  displayName: "Buy tickets",
  version: 1,
};

let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
let refusal: { status: number; code: string } | null;
let position = 0;

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: taskId,
    objectType: "task",
    displayName: "Buy tickets",
    version: 1,
    deletedAt: null,
    ...overrides,
  };
}

/** Hands the tab a change Chen confirmed on the Event's page. */
function receive(
  cause: Extract<LiveChange, { kind: "objects" }>["cause"],
  objects: readonly Record<string, unknown>[],
  removed: readonly string[] = [],
) {
  position += 1;
  act(() =>
    live.send?.({
      kind: "change",
      position: `0000000a.${position}`,
      change: {
        kind: "objects",
        page: `event:${eventId}`,
        actor: { userId: chen, displayName: "Chen", tabId: null },
        at: "2026-09-29T10:00:00.000Z",
        cause,
        objects,
        removed,
      } as unknown as LiveChange,
    }),
  );
}

beforeEach(() => {
  refusal = null;
  live.send = null;
  for (const method of ["showModal", "close"] as const)
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = method === "showModal";
      },
    });
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "test-session", workspaceId }),
  );
  fetch = vi.fn<typeof globalThis.fetch>(async (input, options) => {
    const url = new URL(String(input), "http://example.test");
    if (options?.method === "DELETE") {
      if (refusal !== null)
        return Response.json(
          { error: { code: refusal.code, message: "Refused." } },
          { status: refusal.status },
        );
      return Response.json({
        id: taskId,
        version: Number(url.searchParams.get("expectedVersion")) + 1,
        deletedAt: "2026-09-29T10:00:00.000Z",
      });
    }
    if (url.pathname.endsWith("/access"))
      return Response.json({
        resourceId: url.pathname.split("/").at(-2),
        actions: ["view", "edit", "delete"],
        source: { kind: "own" },
      });
    if (url.pathname.endsWith("/relations"))
      return Response.json({
        items: [
          {
            id: relationId,
            version: 3,
            workspaceId,
            sourceObjectId: eventId,
            targetObjectId: taskId,
            relationType: "includes",
            metadata: {},
            createdBy: workspaceId,
            createdAt: "2026-09-02T20:00:00.000Z",
            deletedAt: null,
          },
        ],
        nextCursor: null,
      });
    return Response.json({});
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

function Opener() {
  const open = useOpenLifecycle();
  return (
    <button onClick={() => open(target)} type="button">
      Open
    </button>
  );
}

async function openDialog() {
  const user = userEvent.setup();
  render(
    <Providers>
      <Opener />
    </Providers>,
  );
  await waitFor(() => expect(live.send).not.toBeNull());
  await user.click(screen.getByRole("button", { name: "Open" }));
  const dialog = within(screen.getByRole("dialog"));
  await dialog.findByRole("button", { name: "Move to Trash" });
  return { user, dialog };
}

describe("useFollowedObject", () => {
  it("follows the name and version, and says who took the object away", async () => {
    const { result } = renderHook(() => useFollowedObject(target), {
      wrapper: Providers,
    });
    await waitFor(() => expect(live.send).not.toBeNull());
    expect(result.current).toMatchObject({
      name: "Buy tickets",
      version: 1,
      gone: null,
    });
    receive("updated", [
      task({ displayName: "Buy train tickets", version: 2 }),
    ]);
    expect(result.current).toMatchObject({
      name: "Buy train tickets",
      version: 2,
      gone: null,
    });
    receive("trashed", [
      task({
        displayName: "Buy train tickets",
        version: 3,
        deletedAt: "2026-09-29T10:00:00.000Z",
      }),
    ]);
    expect(result.current.gone).toEqual({ kind: "trashed", actor: "Chen" });
  });
});

describe("the Move to Trash dialog", () => {
  it("states the newest name and trashes the newest version", async () => {
    const { user, dialog } = await openDialog();
    receive("updated", [
      task({ displayName: "Buy train tickets", version: 2 }),
    ]);
    expect(
      dialog.getByRole("heading", { name: "Buy train tickets" }),
    ).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Move to Trash" }));
    expect(
      dialog.getByText(
        "Move Buy train tickets to Trash? You can restore it from Trash.",
      ),
    ).toBeVisible();
    await user.click(dialog.getByRole("button", { name: "Move to Trash" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const deletion = fetch.mock.calls.find(
      ([, options]) => options?.method === "DELETE",
    );
    expect(String(deletion?.[0])).toContain("expectedVersion=2");
  });

  it("says who moved the record to Trash in place of the confirmation, and closes", async () => {
    const { user, dialog } = await openDialog();
    await user.click(dialog.getByRole("button", { name: "Move to Trash" }));
    receive("trashed", [
      task({ version: 2, deletedAt: "2026-09-29T10:00:00.000Z" }),
    ]);
    const reason = dialog.getByRole("status");
    expect(reason).toHaveTextContent("Chen moved Buy tickets to Trash");
    expect(dialog.queryByRole("button", { name: "Move to Trash" })).toBeNull();
    expect(
      dialog.queryByRole("button", { name: "Remove from this event" }),
    ).toBeNull();
    await user.click(within(reason).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Move to Trash when the record only left the event", async () => {
    const { dialog } = await openDialog();
    await dialog.findByRole("button", { name: "Remove from this event" });
    receive(
      "excluded",
      [{ ...task({ id: eventId }), objectType: "event" }],
      [taskId],
    );
    expect(dialog.getByRole("status")).toHaveTextContent(
      "Chen took Buy tickets off this page",
    );
    expect(
      dialog.queryByRole("button", { name: "Remove from this event" }),
    ).toBeNull();
    expect(dialog.getByRole("button", { name: "Move to Trash" })).toBeVisible();
  });

  it("says a refused Move to Trash found the record changed or gone", async () => {
    refusal = { status: 409, code: "version_conflict" };
    const { user, dialog } = await openDialog();
    await user.click(dialog.getByRole("button", { name: "Move to Trash" }));
    await user.click(dialog.getByRole("button", { name: "Move to Trash" }));
    expect(await dialog.findByRole("status")).toHaveTextContent(
      "Buy tickets changed after you opened this",
    );
    expect(dialog.queryByRole("alert")).toBeNull();
  });

  it("says a record no longer there is unavailable", async () => {
    refusal = { status: 404, code: "not_found" };
    const { user, dialog } = await openDialog();
    await user.click(dialog.getByRole("button", { name: "Move to Trash" }));
    await user.click(dialog.getByRole("button", { name: "Move to Trash" }));
    expect(await dialog.findByRole("status")).toHaveTextContent(
      "Buy tickets is no longer available to you",
    );
  });
});
