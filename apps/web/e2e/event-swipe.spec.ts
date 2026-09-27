import { randomUUID } from "node:crypto";
import type { APIRequestContext, Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseLayout } from "./helpers/component-views";
import { openEventView } from "./helpers/event-view";

/**
 * An event with two pages and three views on the strip, in that order:
 * Plan, Budget | Overview, Tasks, Calendar. The account's tab
 * arrangement takes every other view off the strip, and the event holds
 * enough tasks for its Tasks list to scroll the page.
 */
async function arrangedEvent(request: APIRequestContext, email: string) {
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Swiper" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: {
      displayName: "Autumn gathering",
      timezone: "UTC",
      startsOn: "2031-10-10",
      endsOn: "2031-10-14",
    },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const pages = { plan: randomUUID(), budget: randomUUID() };
  const layout = await request.patch(`/api/events/${event.id}/layout`, {
    headers,
    data: {
      expectedVersion: 0,
      pages: [
        { id: pages.plan, name: "Plan", components: [] },
        { id: pages.budget, name: "Budget", components: [] },
      ],
    },
  });
  expect(layout.status()).toBe(200);
  const tabs = await request.patch("/api/auth/me", {
    headers,
    data: {
      eventTabs: {
        [event.id]: {
          order: ["overview", "todos", "calendar"],
          hidden: ["sharing", "removed-links"],
          removed: [
            "timeline",
            "itinerary",
            "expenses",
            "reminders",
            "files",
            "people",
            "notes",
          ],
        },
      },
    },
  });
  expect(tabs.status()).toBe(200);
  for (let index = 1; index <= 24; index++) {
    const task = await request.post(`/api/events/${event.id}/resources`, {
      headers,
      data: {
        commandId: randomUUID(),
        resource: { objectType: "task", displayName: `Errand ${index}` },
      },
    });
    expect(task.status()).toBe(201);
  }
  const item = await request.post(`/api/events/${event.id}/resources`, {
    headers,
    data: {
      commandId: randomUUID(),
      resource: {
        objectType: "event",
        displayName: "Garden lunch",
        startsOn: "2031-10-11",
        endsOn: "2031-10-11",
      },
    },
  });
  expect(item.status()).toBe(201);
  return { id: event.id as string, pages };
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Swiper");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
}

/**
 * A finger drawn from one point to another through Chromium's touch
 * input, so the browser's own scrolling and `touch-action` apply as they
 * do on a phone; `held` runs before the finger lifts.
 */
async function touchDrag(
  page: Page,
  from: { readonly x: number; readonly y: number },
  to: { readonly x: number; readonly y: number },
  held?: () => Promise<void>,
) {
  const cdp = await page.context().newCDPSession(page);
  const steps = 12;
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  });
  for (let step = 1; step <= steps; step++)
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * step) / steps,
          y: from.y + ((to.y - from.y) * step) / steps,
        },
      ],
    });
  await held?.();
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

/** How far the content sits from its place, from its inline transform. */
function contentOffset(page: Page) {
  return page.evaluate(() => {
    const transform =
      document.querySelector<HTMLElement>(".event-swipe > .event-swipe-track")
        ?.style.transform ?? "";
    return Number.parseFloat(transform.replace("translateX(", "")) || 0;
  });
}

/**
 * A sideways swipe of `dx` pixels centred on `target`, at `y` when given
 * and otherwise a little into it; `held` runs before the finger lifts.
 */
async function swipeAcross(
  page: Page,
  target: Locator,
  dx: number,
  { y, held }: { y?: number; held?: () => Promise<void> } = {},
) {
  const box = await target.boundingBox();
  if (box === null) throw new Error("The swipe target has no box.");
  const x = box.x + box.width / 2 - dx / 2;
  const at = y ?? box.y + Math.min(box.height / 2, 120);
  await touchDrag(page, { x, y: at }, { x: x + dx, y: at + 6 }, held);
}

/** The vertical middle of an element, in viewport pixels. */
async function middle(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("The element has no box.");
  return box.y + box.height / 2;
}

/** The content comes to rest: no copy sliding out, nothing moved. */
async function expectSettled(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const content = document.querySelector<HTMLElement>(
          ".event-swipe > .event-swipe-track",
        );
        return {
          leaving: document.querySelector(".event-swipe-leaving")
            ?.childElementCount,
          swiping: document
            .querySelector(".event-swipe")
            ?.hasAttribute("data-swiping"),
          moving: content?.getAnimations().length,
          transform: content?.style.transform,
        };
      }),
    )
    .toEqual({ leaving: 0, swiping: false, moving: 0, transform: "" });
}

test("moves between an event's pages and views with a sideways swipe on a touch screen", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-mobile",
    "The journey draws touches through Chromium's touch input on a phone.",
  );
  const email = `swipe-${randomUUID()}@example.test`;
  const event = await arrangedEvent(request, email);
  await signIn(page, email);
  await page.goto(`/events/${event.id}?view=todos`);
  const todos = page.getByRole("tab", { name: "Tasks", exact: true });
  const calendar = page.getByRole("tab", { name: "Calendar", exact: true });
  const overview = page.getByRole("tab", { name: "Overview", exact: true });
  const pages = page.getByRole("navigation", { name: "Pages", exact: true });
  const content = page.locator(".event-swipe");
  await expect(todos).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Errand 1", { exact: true })).toBeVisible();

  // The content follows the finger; let go, a swipe left opens the next
  // tab as a tap would: the address names it, the strip marks it (unfolded
  // if it had folded away), and Back returns.
  await swipeAcross(page, content, -200, {
    held: async () => expect(await contentOffset(page)).toBeCloseTo(-200, 0),
  });
  await expect(page).toHaveURL(/\?view=calendar$/u);
  await expect(calendar).toBeVisible();
  await expect(calendar).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Garden lunch").first()).toBeVisible();
  await expectSettled(page);
  await page.screenshot({ path: testInfo.outputPath("swiped-left.png") });
  await page.goBack();
  await expect(todos).toHaveAttribute("aria-selected", "true");

  // Calendar is the last tab: the content gives a little and springs back.
  await openEventView(page, "Calendar");
  await swipeAcross(page, content, -220, {
    held: async () => {
      const given = await contentOffset(page);
      expect(given).toBeLessThan(0);
      expect(given).toBeGreaterThan(-80);
    },
  });
  await expectSettled(page);
  await expect(page).toHaveURL(/\?view=calendar$/u);
  await expect(calendar).toHaveAttribute("aria-selected", "true");

  // A swipe right walks back along the strip: the views, then the pages.
  await swipeAcross(page, content, 200);
  await expect(page).toHaveURL(/\?view=todos$/u);
  await swipeAcross(page, content, 200);
  await expect(page).toHaveURL(/\?view=overview$/u);
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await swipeAcross(page, content, 200);
  await expect(page).toHaveURL(new RegExp(`\\?page=${event.pages.budget}$`));
  await expect(
    pages.getByRole("button", { name: "Budget", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await swipeAcross(page, content, 200);
  await expect(page).toHaveURL(new RegExp(`\\?page=${event.pages.plan}$`));
  await expect(
    pages.getByRole("button", { name: "Plan", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // Plan is the first tab: a swipe right gives a little and springs back.
  await swipeAcross(page, content, 220, {
    held: async () => {
      const given = await contentOffset(page);
      expect(given).toBeGreaterThan(0);
      expect(given).toBeLessThan(80);
    },
  });
  await expectSettled(page);
  await expect(page).toHaveURL(new RegExp(`\\?page=${event.pages.plan}$`));

  // The screen's edges belong to Back and the drawer.
  await swipeAcross(page, content, -200);
  await expect(page).toHaveURL(new RegExp(`\\?page=${event.pages.budget}$`));
  const width = page.viewportSize()?.width ?? 390;
  const box = await content.boundingBox();
  const y = (box?.y ?? 400) + 60;
  await touchDrag(page, { x: 6, y }, { x: 230, y: y + 4 });
  await touchDrag(page, { x: width - 6, y }, { x: width - 230, y: y + 4 });
  await expectSettled(page);
  await expect(page).toHaveURL(new RegExp(`\\?page=${event.pages.budget}$`));

  // The place a swipe reached is the one the event reopens at.
  await page.goto(`/events/${event.id}`);
  await expect(page).toHaveURL(new RegExp(`\\?page=${event.pages.budget}$`));
  await expect(
    pages.getByRole("button", { name: "Budget", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // A drag that goes mostly down scrolls the page and stays on the tab.
  await page.goto(`/events/${event.id}?view=todos`);
  await expect(page.getByText("Errand 1", { exact: true })).toBeVisible();
  await touchDrag(page, { x: 200, y: 620 }, { x: 170, y: 220 });
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(100);
  await expectSettled(page);
  await expect(page).toHaveURL(/\?view=todos$/u);

  // No swipe while a menu is open; the touch only closes it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page
    .getByRole("button", { name: "Actions for Autumn gathering", exact: true })
    .click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  const below = await menu.boundingBox();
  if (below === null) throw new Error("The menu has no box.");
  await swipeAcross(page, content, -200, {
    y: below.y + below.height + 60,
  });
  await expect(menu).toHaveCount(0);
  await expectSettled(page);
  await expect(page).toHaveURL(/\?view=todos$/u);

  // The Calendar's week scrolls sideways under the finger instead.
  await openEventView(page, "Calendar");
  const panel = page.locator(".planning-panel").filter({
    has: page.getByRole("heading", { name: "Calendar", exact: true }),
  });
  await chooseLayout(panel, "By week");
  const week = panel.locator(".week-scroll");
  await expect(week).toBeVisible();
  expect(
    await week.evaluate((element) => element.scrollWidth > element.clientWidth),
  ).toBe(true);
  await swipeAcross(page, week, -200);
  await expect
    .poll(() => week.evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(50);
  await expectSettled(page);
  await expect(calendar).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("week-scrolled.png") });

  // With reduced motion the tab changes without the slide: no copy of the
  // leaving tab is made.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    const layer = document.querySelector(".event-swipe-leaving");
    const counts = { copies: 0 };
    Object.assign(window, { swipeCopies: counts });
    if (layer)
      new MutationObserver((records) => {
        for (const record of records) counts.copies += record.addedNodes.length;
      }).observe(layer, { childList: true });
  });
  await swipeAcross(page, content, 200, {
    y: await middle(panel.getByRole("heading", { name: "Calendar" })),
  });
  await expect(todos).toHaveAttribute("aria-selected", "true");
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { swipeCopies: { copies: number } }).swipeCopies
          .copies,
    ),
  ).toBe(0);
  await expectSettled(page);
});

test("never swipes between tabs with a mouse", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium-desktop",
    "A mouse is the desktop's pointer.",
  );
  const email = `swipe-mouse-${randomUUID()}@example.test`;
  const event = await arrangedEvent(request, email);
  await signIn(page, email);
  await page.goto(`/events/${event.id}?view=todos`);
  await expect(
    page.getByRole("tab", { name: "Tasks", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  const box = await page.locator(".event-swipe").boundingBox();
  if (box === null) throw new Error("The event has no content.");
  const y = box.y + 40;
  await page.mouse.move(box.x + box.width * 0.7, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, y + 4, { steps: 12 });
  await page.mouse.up();
  await expectSettled(page);
  await expect(page).toHaveURL(/\?view=todos$/u);
});
