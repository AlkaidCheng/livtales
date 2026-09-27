import { randomUUID } from "node:crypto";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { expectHorizontalReflow } from "./helpers/page-navigation";
import {
  accountBlock,
  accountReturn,
  drawer,
  focusAccountBlock,
  menuControl,
  searchPalette,
  workspaceControl,
  workspaceEntry,
  workspaceNavigation,
  workspaceSwitcher,
} from "./helpers/quiet-chrome";

/** A finger held on a row past the long press. */
async function longPress(row: Locator) {
  const box = await row.boundingBox();
  if (box === null) throw new Error("The row has no box.");
  const at = { clientX: box.x + 12, clientY: box.y + box.height / 2 };
  const touch = { pointerId: 1, pointerType: "touch", bubbles: true, ...at };
  await row.dispatchEvent("pointerdown", touch);
  await row.page().waitForTimeout(650);
  await row.dispatchEvent("pointerup", touch);
}

/** An element's box, in viewport pixels. */
async function boxOf(locator: Locator) {
  const found = await locator.boundingBox();
  if (found === null) throw new Error("The element has no box.");
  return found;
}

/** The bottom edge of an element, in viewport pixels. */
async function bottom(locator: Locator) {
  const { y, height } = await boxOf(locator);
  return y + height;
}

const signIn = async (page: Page, name: string, email: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("gives the phone an app bar whose menu opens the sidebar as a drawer ending with the account, and the workspace as a sheet @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.endsWith("mobile"),
    "The app bar is the phone's; a wider viewport keeps the rail.",
  );
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const ana = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: anaEmail, displayName: "Ana Souza" },
    })
  ).json();
  const ben = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email: benEmail, displayName: "Ben Wu" },
    })
  ).json();
  const chen = await (
    await request.post("/api/auth/development/sign-in", {
      data: {
        email: `chen-${randomUUID()}@example.test`,
        displayName: "Chen Li",
      },
    })
  ).json();
  const anaHeaders = { authorization: `Bearer ${ana.accessToken}` };
  const benHeaders = { authorization: `Bearer ${ben.accessToken}` };
  // Ana makes Ben a member of her workspace, so his switcher lists her by
  // name and role; Chen shares one event with him as a viewer, which his
  // own Events list shows.
  const trip = await (
    await request.post("/api/events", {
      headers: { authorization: `Bearer ${chen.accessToken}` },
      data: { displayName: "Kyoto in November" },
    })
  ).json();
  expect(
    (
      await request.post("/api/shares", {
        headers: { authorization: `Bearer ${chen.accessToken}` },
        data: { resourceId: trip.id, principalEmail: benEmail, role: "viewer" },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await request.post("/api/events", {
        headers: anaHeaders,
        data: { displayName: "Ana's plan" },
      })
    ).status(),
  ).toBe(201);
  const sent = await (
    await request.post("/api/friends/invitations", {
      headers: anaHeaders,
      data: { email: benEmail },
    })
  ).json();
  const friend = await (
    await request.post(`/api/friends/requests/${sent.id}/accept`, {
      headers: benHeaders,
    })
  ).json();
  expect(
    (
      await request.post("/api/workspaces/current/members", {
        headers: anaHeaders,
        data: { friendId: friend.id, role: "viewer" },
      })
    ).status(),
  ).toBe(201);

  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Ben Wu", benEmail);

  // The app bar: the menu control and the workspace as its mark and name
  // (the home mark and "Personal" for the account's own), nothing more on
  // the Events list; the account is in the drawer. No bar at the foot:
  // the page's only navigation is the sidebar's, folded into the drawer.
  const bar = page.locator(".phone-bar");
  await expect(bar).toBeVisible();
  await expect(menuControl(page)).toBeVisible();
  await expect(workspaceControl(page)).toContainText("Personal");
  await expect(
    workspaceControl(page).locator(".workspace-mark-home"),
  ).toHaveCount(1);
  await expect(bar.getByRole("button")).toHaveCount(2);
  await expect(bar.getByRole("link")).toHaveCount(0);
  await expect(bar.locator(".profile-mark")).toHaveCount(0);
  await expect(page.getByRole("navigation")).toHaveCount(0);
  await expect(page.locator("aside.sidebar")).toHaveCount(0);
  // New event is the add button at the foot, the header's own gone.
  const newEvent = page.getByRole("button", { name: "New event", exact: true });
  await expect(newEvent).toHaveCount(1);
  await expect(
    page.locator(".add-seal").getByRole("button", { name: "New event" }),
  ).toBeInViewport();
  await expectHorizontalReflow(page);
  await page.screenshot({ path: testInfo.outputPath("app-bar.png") });

  // The menu opens the sidebar as a drawer: the brand, Search, and the
  // collections with the open page current, and at its foot the account
  // block as the rail's reads (the initials, the name, and the space).
  // Escape closes it and hands focus back to the menu control.
  await menuControl(page).click();
  await expect(drawer(page)).toBeVisible();
  await expect(
    drawer(page).getByRole("link", { name: "LivTales" }),
  ).toBeVisible();
  const navigation = await workspaceNavigation(page);
  await expect(
    navigation.getByRole("button", { name: "Search and commands" }),
  ).toBeVisible();
  const collections = navigation.getByRole("list", { name: "Collections" });
  await expect(collections.getByRole("link")).toHaveText([
    "Events",
    "Tasks",
    "People",
  ]);
  await expect(
    collections.getByRole("link", { name: "Events", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(drawer(page)).toBeInViewport();
  const block = drawer(page).locator(".sidebar-footer .account-trigger");
  await expect(block).toHaveAccessibleName("Ben Wu Personal");
  await expect(block.locator(".profile-mark")).toHaveText("BW");
  expect(await bottom(drawer(page))).toBeGreaterThan((await bottom(block)) - 1);
  expect((await bottom(drawer(page))) - (await bottom(block))).toBeLessThan(24);
  await page.screenshot({ path: testInfo.outputPath("drawer.png") });
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await expect(menuControl(page)).toBeFocused();

  // A collection chosen from the drawer opens its page and closes the
  // drawer behind it.
  await menuControl(page).click();
  await collections.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks$/u);
  await expect(drawer(page)).toBeHidden();
  await expect(
    page.getByRole("heading", { level: 1, name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".add-seal").getByRole("button", { name: "New task" }),
  ).toBeInViewport();

  // A finger held on a collection enters customization in place: the
  // heading reads "Collections - Done", the rows gain their grips and
  // eyes, and a tap on a row stays put. Done leaves it, the drawer open.
  await menuControl(page).click();
  const people = collections.getByRole("link", { name: "People", exact: true });
  await longPress(people);
  const done = drawer(page).getByRole("button", { name: "Done", exact: true });
  await expect(done).toBeVisible();
  await expect(page.locator(".rail-heading")).toContainText("Collections");
  await expect(
    page.getByRole("button", { name: "Move People", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Hide People", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("drawer-customize.png") });
  await people.click();
  await expect(page).toHaveURL(/\/tasks$/u);
  await expect(drawer(page)).toBeVisible();
  await done.click();
  await expect(done).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Move /u })).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();

  // Search from the drawer closes it and opens the palette over the page;
  // closing the palette returns focus to the menu control.
  await navigation.getByRole("button", { name: "Search and commands" }).click();
  await expect(drawer(page)).toBeHidden();
  await expect(searchPalette(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(searchPalette(page)).toHaveCount(0);
  await expect(menuControl(page)).toBeFocused();

  // The space control opens the switcher as a sheet within the viewport:
  // the account's own first and current, then Ana's by her name and Ben's
  // role, with Manage space beside the search field. Choosing hers switches; the control reads her name
  // with her initials as its mark, and her event is on the list.
  await workspaceControl(page).click();
  const switcher = workspaceSwitcher(page);
  await expect(switcher).toBeVisible();
  await expect(switcher).toBeInViewport();
  await expect(workspaceEntry(page, "Personal")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(workspaceEntry(page, "Ana Souza")).toContainText("Viewer");
  await expect(
    switcher.getByRole("menuitem", { name: "Manage space", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath("workspace-sheet.png") });
  await workspaceEntry(page, "Ana Souza").click();
  await expect(switcher).toHaveCount(0);
  await expect(page).toHaveURL(/\/events$/u);
  await expect(workspaceControl(page)).toContainText("Ana Souza");
  await expect(workspaceControl(page).locator(".workspace-mark")).toHaveText(
    "AS",
  );
  await expect(page.getByRole("link", { name: /Ana's plan/ })).toBeVisible();
  // A Viewer of her space adds nothing there: no add button, and no New
  // event in the header either.
  await expect(page.locator(".add-seal")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New event", exact: true }),
  ).toHaveCount(0);
  // Cmd/Ctrl+Shift+K opens the sheet from the page and closes it again.
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await expect(switcher).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+K");
  await expect(switcher).toHaveCount(0);
  await workspaceControl(page).click();
  await workspaceEntry(page, "Personal").click();
  await expect(workspaceControl(page)).toContainText("Personal");

  // The account block at the drawer's foot opens the account sheet over
  // the drawer: the account's name and email, Friends, Settings, Sign out,
  // then More's entries under them; no shortcuts entry, as a phone has no
  // keyboard to list them for. Escape leads back to the drawer. Customize
  // sidebar leaves the drawer open, customizing; Theme opens its own
  // sheet, and Escape from it lands back on the block.
  await menuControl(page).click();
  await block.click();
  const account = page.getByRole("menu", { name: "Account", exact: true });
  await expect(account).toBeVisible();
  await expect(account).toBeInViewport();
  await expect(drawer(page)).toBeVisible();
  await expect(page.locator(".sheet-identity")).toContainText("Ben Wu");
  await expect(page.locator(".sheet-identity")).toContainText(benEmail);
  // Safari on an iPhone offers Install app (the home-screen steps) too.
  const ios = await page.evaluate(() =>
    /iPhone|iPad|iPod/.test(navigator.userAgent),
  );
  await expect(account.getByRole("menuitem")).toHaveText([
    /^Friends/,
    "Settings",
    "Sign out",
    "Trash",
    "Theme",
    "Customize sidebar",
    ...(ios ? ["Install app"] : []),
    "Help",
  ]);
  await expect(
    account.getByRole("menuitem", { name: /^Friends/ }),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("account-sheet.png") });
  await page.keyboard.press("Escape");
  await expect(account).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
  await block.click();
  await account
    .getByRole("menuitem", { name: "Customize sidebar", exact: true })
    .click();
  await expect(account).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
  await expect(done).toBeVisible();
  await done.click();
  await block.click();
  await account.getByRole("menuitem", { name: "Theme", exact: true }).click();
  const theme = page.getByRole("dialog", { name: "Theme", exact: true });
  await expect(theme).toBeVisible();
  await expect(theme).toBeInViewport();
  // The sheet holds the palette and add button tiles; a shape's styles
  // close alone, leaving the sheet open.
  await expect(
    theme.getByRole("group", { name: "Palette", exact: true }),
  ).toBeVisible();
  const shapes = theme.getByRole("group", { name: "Button", exact: true });
  await expect(shapes.getByRole("radio")).toHaveCount(4);
  await shapes.getByRole("button", { name: "Square styles" }).click();
  const squareStyles = page.getByRole("dialog", { name: "Square" });
  await expect(squareStyles).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(squareStyles).toHaveCount(0);
  await expect(theme).toBeVisible();
  await expect(
    shapes.getByRole("button", { name: "Square styles" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(theme).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
  await expect(accountBlock(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();

  // The event page: the bar names its place, the space then "/ Events",
  // and the head starts with the title, its actions beside it, with no
  // row above; a share reads as a tag beside the date ("Shared by Chen
  // Li", the role) in place of the line.
  await page.getByRole("link", { name: /Kyoto in November/ }).click();
  const title = page.getByRole("heading", {
    level: 1,
    name: "Kyoto in November",
  });
  await expect(title).toBeVisible();
  await expect(bar).toContainText(/Personal\s*\/\s*Events$/u);
  const back = bar.getByRole("link", { name: "All events", exact: true });
  await expect(back).toHaveAttribute("href", "/events");
  await expect(
    page.getByRole("navigation", { name: "Breadcrumb" }),
  ).toHaveCount(0);
  const actions = page.locator(".event-hero .event-actions");
  expect(
    Math.abs((await boxOf(title)).y - (await boxOf(actions)).y),
  ).toBeLessThan(8);
  const tag = page.locator(".event-access-tag");
  await expect(tag).toBeVisible();
  await expect(tag).toContainText("Shared by Chen Li");
  await expect(tag).toContainText("Viewer");
  // A viewer of the event has nothing to add to it.
  await expect(page.locator(".add-seal")).toHaveCount(0);
  await expect(page.locator(".event-hero .access-line")).toBeHidden();
  await expect(page.locator(".mobile-view-select")).toHaveCount(0);
  await expectHorizontalReflow(page);
  await page.screenshot({ path: testInfo.outputPath("event-head.png") });

  // At the narrowest width the bar keeps the menu, the space, and the way
  // back in view, and Events returns to the list.
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(menuControl(page)).toBeInViewport();
  await expect(workspaceControl(page)).toBeInViewport();
  await expect(back).toBeInViewport();
  await expectHorizontalReflow(page);
  await back.click();
  await expect(page).toHaveURL(/\/events$/u);
  await expect(bar.getByRole("link")).toHaveCount(0);

  // Sign out from the account sheet.
  await menuControl(page).click();
  await block.click();
  await account
    .getByRole("menuitem", { name: "Sign out", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sign-in/u);
  expect(errors).toEqual([]);
});

test("names the place in the phone's bar and opens the account from the drawer's foot, by keyboard too @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.endsWith("mobile"),
    "The app bar is the phone's; a wider viewport keeps the rail.",
  );
  const email = `place-${randomUUID()}@example.test`;
  const planner = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email, displayName: "Mei Chen" },
    })
  ).json();
  const plan = await (
    await request.post("/api/events", {
      headers: { authorization: `Bearer ${planner.accessToken}` },
      data: { displayName: "Autumn gathering" },
    })
  ).json();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, "Mei Chen", email);

  // On the Events list the bar holds the menu and the space alone.
  const bar = page.locator(".phone-bar");
  await expect(workspaceControl(page)).toHaveAccessibleName("Space: Personal");
  await expect(bar.getByRole("link")).toHaveCount(0);

  // On the event the space goes on to "/ Events", and Events leads back.
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/events/${plan.id}(?:\\?.*)?$`, "u"),
  );
  await expect(
    page.getByRole("heading", { level: 1, name: "Autumn gathering" }),
  ).toBeVisible();
  await expect(bar).toContainText(/Personal\s*\/\s*Events$/u);
  await page.screenshot({ path: testInfo.outputPath("event-bar.png") });
  await bar.getByRole("link", { name: "All events", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await expect(
    page.getByRole("heading", { level: 1, name: "Events", exact: true }),
  ).toBeVisible();

  // From the keyboard: the menu control opens the drawer, the account
  // block at its foot opens the account sheet on Friends, and Escape leads
  // back one step at a time, to the block and then to the menu control.
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await expect(bar).toContainText(/Personal\s*\/\s*Events$/u);
  await focusAccountBlock(page);
  await expect(accountBlock(page)).toBeFocused();
  await expect(accountBlock(page)).toHaveAccessibleName("Mei Chen Personal");
  await page.keyboard.press("Enter");
  const account = page.getByRole("menu", { name: "Account", exact: true });
  await expect(
    account.getByRole("menuitem", { name: /^Friends/ }),
  ).toBeFocused();
  await expect(accountBlock(page)).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({
    path: testInfo.outputPath("account-over-drawer.png"),
  });
  await page.keyboard.press("Escape");
  await expect(account).toHaveCount(0);
  await expect(accountBlock(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(drawer(page)).toBeHidden();
  await expect(menuControl(page)).toBeFocused();

  // Settings from the sheet closes the sheet and the drawer behind it;
  // closing Settings returns to the event, on the menu control.
  const eventUrl = page.url();
  await focusAccountBlock(page);
  await page.keyboard.press("Enter");
  await account
    .getByRole("menuitem", { name: "Settings", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Settings", exact: true });
  await expect(settings).toBeVisible();
  await expect(drawer(page)).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
  await expect(page).toHaveURL(eventUrl);
  await expect(accountReturn(page)).toBeFocused();
  expect(errors).toEqual([]);
});
