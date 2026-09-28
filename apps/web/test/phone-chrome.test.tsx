// @vitest-environment jsdom
import type { SessionResponse } from "@livtales/schemas";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { Providers } from "../app/providers";
import { PhoneChrome } from "../components/phone-chrome";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/events",
}));
vi.mock("../lib/use-command-search", () => ({
  useCommandSearch: () => ({
    items: [],
    hasMore: false,
    isSearching: false,
    isError: false,
    isEmpty: false,
  }),
}));

const userId = "019d6e7d-0000-7000-8000-000000000002";
const personalId = "019d6e7d-0000-7000-8000-000000000001";

const session = {
  principal: { type: "user", userId, workspaceId: personalId },
  user: {
    id: userId,
    displayName: "Planner",
    email: "planner@example.test",
    username: "planner",
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
  workspace: { id: personalId, displayName: "Planner's workspace" },
  availableWorkspaces: [
    {
      id: personalId,
      displayName: "Planner's workspace",
      personal: true,
      ownerDisplayName: "Planner",
      role: "owner",
    },
  ],
} as unknown as SessionResponse;

const methods = ["showModal", "close"] as const;
const descriptors = methods.map((method) =>
  Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, method),
);

beforeEach(() => {
  window.history.replaceState(null, "", "/events");
  window.sessionStorage.setItem(
    "chronelle.session",
    JSON.stringify({ accessToken: "test-session", workspaceId: personalId }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify(session), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  // jsdom has no modal dialogs: opening and closing toggle `open`.
  for (const method of methods)
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value: function (this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  methods.forEach((method, index) => {
    const descriptor = descriptors[index];
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, method, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, method);
  });
});

function renderChrome({
  pathname = "/events",
  pendingRequests = 0,
}: { pathname?: string; pendingRequests?: number } = {}) {
  const onCustomize = vi.fn();
  const onSignOut = vi.fn();
  render(
    <div className="workspace-shell">
      <PhoneChrome
        session={session}
        pathname={pathname}
        pendingRequests={pendingRequests}
        customizing={false}
        onCustomize={onCustomize}
        onSwitch={vi.fn()}
        onSignOut={onSignOut}
      />
    </div>,
    { wrapper: Providers },
  );
  return { onCustomize, onSignOut, user: userEvent.setup() };
}

const bar = () => screen.getByRole("banner");
const drawer = () => document.querySelector<HTMLDialogElement>(".phone-drawer");
const accountSheet = () =>
  document.querySelector<HTMLDialogElement>(
    'dialog.bottom-sheet[aria-label="Account"]',
  );
const moreSheet = () =>
  document.querySelector<HTMLDialogElement>(
    'dialog.bottom-sheet[aria-label="More"]',
  );

it("holds the menu and the space in the bar, without the account", () => {
  renderChrome();
  const controls = within(bar()).getAllByRole("button");
  expect(controls.map((control) => control.getAttribute("aria-label"))).toEqual(
    ["Menu", "Space: Personal"],
  );
  expect(within(bar()).queryByRole("link")).not.toBeInTheDocument();
  expect(bar().querySelector(".profile-mark")).toBeNull();
});

it("follows the space with the way back to Events on an event's page", () => {
  renderChrome({ pathname: "/events/019d6e7d-0000-7000-8000-000000000009" });
  expect(bar()).toHaveTextContent("Personal/Events");
  expect(
    within(bar()).getByRole("link", { name: "All events" }),
  ).toHaveAttribute("href", "/events");
});

it("carries the account's dot on the menu while friend requests wait", () => {
  renderChrome({ pendingRequests: 2 });
  const menu = within(bar()).getByRole("button", { name: "Menu" });
  expect(menu.querySelector(".profile-dot")).not.toBeNull();
});

it("ends the drawer with the account block and More, whose sheets rise over it and lead back to it", async () => {
  const { user } = renderChrome();
  const menu = within(bar()).getByRole("button", { name: "Menu" });
  await user.click(menu);
  expect(drawer()).toHaveAttribute("open");
  expect(menu).toHaveAttribute("aria-expanded", "true");
  const footer = drawer()?.querySelector(".sidebar-footer");
  if (!(footer instanceof HTMLElement)) throw new Error("No drawer footer.");
  const block = within(footer).getByRole("button", {
    name: "Planner Personal",
  });
  expect(block).toHaveAttribute("aria-haspopup", "dialog");
  expect(block.querySelector(".profile-mark")).toHaveTextContent("P");

  await user.click(block);
  expect(accountSheet()).toHaveAttribute("open");
  expect(drawer()).toHaveAttribute("open");
  expect(block).toHaveAttribute("aria-expanded", "true");
  const account = screen.getByRole("menu", { name: "Account" });
  expect(
    within(account)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["Friends", "Settings", "Sign out"]);

  // Escape dismisses the sheet alone, back to the drawer.
  expect(
    within(account).getByRole("menuitem", { name: "Friends" }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(accountSheet()).not.toHaveAttribute("open");
  expect(drawer()).toHaveAttribute("open");
  expect(block).toHaveAttribute("aria-expanded", "false");

  // More beside it opens the rail's More entries in a sheet of its own.
  const more = within(footer).getByRole("button", { name: "More" });
  expect(more).toHaveAttribute("aria-haspopup", "dialog");
  await user.click(more);
  expect(moreSheet()).toHaveAttribute("open");
  expect(more).toHaveAttribute("aria-expanded", "true");
  const moreMenu = screen.getByRole("menu", { name: "More" });
  expect(
    within(moreMenu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent),
  ).toEqual(["Trash", "Theme", "Customize sidebar"]);
  expect(
    within(moreMenu).getByRole("menuitem", { name: "Trash" }),
  ).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(moreSheet()).not.toHaveAttribute("open");
  expect(drawer()).toHaveAttribute("open");
});

it("closes the sheet and the drawer as an entry is taken", async () => {
  const { onSignOut, user } = renderChrome();
  await user.click(within(bar()).getByRole("button", { name: "Menu" }));
  await user.click(screen.getByRole("button", { name: "Planner Personal" }));
  await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
  expect(onSignOut).toHaveBeenCalledOnce();
  expect(accountSheet()).not.toHaveAttribute("open");
  expect(drawer()).not.toHaveAttribute("open");
});

it("keeps the drawer open to customize it from the More sheet", async () => {
  const { onCustomize, user } = renderChrome();
  await user.click(within(bar()).getByRole("button", { name: "Menu" }));
  await user.click(screen.getByRole("button", { name: "More" }));
  await user.click(screen.getByRole("menuitem", { name: "Customize sidebar" }));
  expect(onCustomize).toHaveBeenLastCalledWith(true);
  expect(moreSheet()).not.toHaveAttribute("open");
  expect(drawer()).toHaveAttribute("open");
});
