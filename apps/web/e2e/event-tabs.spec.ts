import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { openAddPage, openEventView } from "./helpers/event-view";

/** The tabs on the strip, pages and views, as they read left to right. */
async function stripTabs(page: Page): Promise<string[]> {
  return page
    .locator(".event-strip [data-tab-key]:not([hidden])")
    .evaluateAll((tabs) =>
      tabs.map((tab) => tab.firstChild?.textContent ?? ""),
    );
}

/** Every view tab in order, folded ones included. */
async function viewTabs(page: Page): Promise<string[]> {
  // A tab's name is its first text; the current one's count follows it.
  return page
    .getByRole("tab", { includeHidden: true })
    .evaluateAll((tabs) =>
      tabs.map((tab) => tab.firstChild?.textContent ?? ""),
    );
}

test("starts a new event's strip minimal and keeps the account's tabs through the gallery, Manage tabs, the fold chip and a reload @webkit-desktop @webkit-mobile", async ({
  page,
  request,
}, testInfo) => {
  const phone = testInfo.project.name.endsWith("-mobile");
  const email = `tabs-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Tab keeper" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Harvest supper", timezone: "UTC" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Tab keeper");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);

  // Opened for the first time, the event lands on its Overview, and the
  // address names it. The strip holds the Overview and Tasks alone:
  // Sharing and Removed links start hidden, and an event without pages
  // shows no page controls.
  await page.goto(`/events/${event.id}`);
  await expect(page).toHaveURL(
    new RegExp(`/events/${event.id}\\?view=overview$`, "u"),
  );
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await viewTabs(page)).toEqual(["Overview", "Tasks"]);
  await expect(
    page.getByRole("button", { name: "Add page", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Pages", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("minimal-strip.png") });

  // The gallery: a card is a switch that puts a view at the strip's end
  // and takes it off again; the dialog stays open throughout, and its
  // footer starts a first page.
  await page.getByRole("button", { name: "Add a view", exact: true }).click();
  const gallery = page.getByRole("dialog", { name: "Add to Harvest supper" });
  await expect(gallery).toBeVisible();
  await expect(
    gallery.getByRole("button", { name: "New page", exact: true }),
  ).toBeVisible();
  const timelineCard = gallery.getByRole("button", { name: /^Timeline/ });
  await expect(timelineCard).toHaveAttribute("aria-pressed", "false");
  await timelineCard.click();
  await expect(timelineCard).toHaveAttribute("aria-pressed", "true");
  await expect(gallery).toBeVisible();
  await timelineCard.click();
  await expect(timelineCard).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("tab", { name: "Timeline", includeHidden: true }),
  ).toHaveCount(0);
  for (const name of [
    "Calendar",
    "Itinerary",
    "Expenses",
    "Reminders",
    "People",
    "Notes",
    "Timeline",
  ]) {
    const card = gallery.getByRole("button", { name: new RegExp(`^${name}`) });
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
  }
  await expect(gallery.getByRole("button", { name: /^Files/ })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(gallery.getByRole("button", { name: /^Tasks/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.screenshot({ path: testInfo.outputPath("gallery.png") });
  await gallery.getByRole("button", { name: "Done", exact: true }).click();
  await expect(gallery).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add a view", exact: true }),
  ).toBeFocused();
  expect(await viewTabs(page)).toEqual([
    "Overview",
    "Tasks",
    "Calendar",
    "Itinerary",
    "Expenses",
    "Reminders",
    "People",
    "Notes",
    "Timeline",
  ]);

  // Manage tabs from the More menu: the eye hides Expenses, the grip's
  // arrow keys move Calendar down three places (past Itinerary, the hidden
  // Expenses, and Reminders), Overview has no cross, and the hidden
  // Sharing can be shown again.
  await page
    .getByRole("button", { name: "Actions for Harvest supper", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Manage tabs", exact: true })
    .click();
  const manage = page.getByRole("dialog", { name: "Manage tabs" });
  await expect(manage).toBeVisible();
  await expect(
    manage.getByRole("button", { name: "Remove Calendar from the event" }),
  ).toBeVisible();
  await expect(
    manage.getByRole("button", { name: /^Remove Overview/ }),
  ).toHaveCount(0);
  await expect(
    manage.getByRole("button", { name: "Show Sharing", exact: true }),
  ).toBeVisible();
  await manage
    .getByRole("button", { name: "Hide Expenses", exact: true })
    .click();
  await expect(
    manage.getByRole("button", { name: "Show Expenses", exact: true }),
  ).toBeVisible();
  await manage
    .getByRole("button", { name: "Move Calendar", exact: true })
    .focus();
  // Each move lands before the next: the views' list reads Overview,
  // Tasks, the hidden Sharing and Removed links, then Calendar.
  const calendarRow = async () =>
    (
      await manage
        .locator(".manage-tabs-list")
        .last()
        .locator(".manage-tabs-name")
        .allTextContents()
    ).findIndex((name) => name.startsWith("Calendar"));
  await expect.poll(calendarRow).toBe(4);
  for (const row of [5, 6, 7]) {
    await page.keyboard.press("ArrowDown");
    await expect.poll(calendarRow).toBe(row);
  }
  await expect(
    manage.getByRole("button", { name: "Move Calendar", exact: true }),
  ).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath("manage-tabs.png") });
  await manage.getByRole("button", { name: "Done", exact: true }).click();
  await expect(manage).toHaveCount(0);
  const arranged = [
    "Overview",
    "Tasks",
    "Itinerary",
    "Reminders",
    "Calendar",
    "People",
    "Notes",
    "Timeline",
  ];
  expect(await viewTabs(page)).toEqual(arranged);

  // The arrangement is the account's: a reload shows it again, and the
  // account's view of this event keeps it.
  await page.reload();
  await expect(
    page.getByRole("tab", { name: "Overview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await viewTabs(page)).toEqual(arranged);
  const view = await request.get(
    `/api/events/${event.id}/layout?include=yours`,
    { headers },
  );
  expect((await view.json()).yours.tabs).toEqual({
    order: [
      "overview",
      "todos",
      "sharing",
      "removed-links",
      "itinerary",
      "expenses",
      "reminders",
      "calendar",
      "people",
      "notes",
      "timeline",
    ],
    hidden: ["sharing", "removed-links", "expenses"],
    removed: ["files"],
  });

  // A hidden view still opens from its address, on the strip while shown;
  // so does a removed one.
  await page.goto(`/events/${event.id}?view=expenses`);
  await expect(
    page.getByRole("tab", { name: "Expenses", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto(`/events/${event.id}?view=files`);
  await expect(
    page.getByRole("tab", { name: "Files", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  if (phone) {
    // The phone keeps the strip, folded past its width into the chip; a
    // hidden view is not on it while another is shown.
    await expect(page.locator(".mobile-view-select")).toHaveCount(0);
    await openEventView(page, "Tasks");
    await expect(
      page.getByRole("tab", { name: "Expenses", exact: true }),
    ).toHaveCount(0);
  }

  // The strip never wraps: at a narrow width the end folds into one chip
  // that lists the rest, and the current tab stays out of it.
  await page.goto(`/events/${event.id}?view=todos`);
  await page.setViewportSize({ width: 820, height: 800 });
  const chip = page.getByRole("button", { name: /more tabs?$/ });
  await expect(chip).toBeVisible();
  const shown = await stripTabs(page);
  expect(shown).toContain("Tasks");
  expect(shown.length).toBeLessThan(8);
  await chip.click();
  const folded = page.getByRole("menu", { name: /more tabs?$/ });
  await expect(folded).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("fold-chip.png") });
  await folded.getByRole("menuitem", { name: "Timeline", exact: true }).click();
  await expect(
    page.getByRole("tab", { name: "Timeline", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await stripTabs(page)).toContain("Timeline");

  // A touch held on a tab opens Manage tabs; a tap still selects. The
  // press is a touch pointer, whichever browser runs the journey, with an
  // id of its own: the browser's mouse pointer is 1, and WebKit reports it
  // leaving the strip when the synthetic touch lands elsewhere.
  const held = page.getByRole("tab", { name: "Overview", exact: true });
  const press = async (kind: "pointerdown" | "pointerup") => {
    const box = await held.boundingBox();
    if (box === null) throw new Error("The Overview tab is not on the strip.");
    await held.dispatchEvent(kind, {
      bubbles: true,
      button: 0,
      clientX: box.x + box.width / 2,
      clientY: box.y + box.height / 2,
      isPrimary: true,
      pointerId: 42,
      pointerType: "touch",
    });
  };
  await press("pointerdown");
  await page.waitForTimeout(700);
  await press("pointerup");
  await expect(manage).toBeVisible();
  await expect(held).not.toHaveAttribute("aria-selected", "true");
  await manage.getByRole("button", { name: "Done", exact: true }).click();
  await expect(manage).toHaveCount(0);
  await press("pointerdown");
  await press("pointerup");
  await held.click();
  await expect(held).toHaveAttribute("aria-selected", "true");

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(chip).toHaveCount(0);
  expect(await stripTabs(page)).toEqual(arranged);
});

test("keeps a strip arranged before the minimal defaults, and starts a view it never placed in the gallery", async ({
  page,
  request,
}) => {
  const email = `arranged-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Arranger" },
  });
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const event = await (
    await request.post("/api/events", {
      headers,
      data: { displayName: "Lantern walk", timezone: "UTC" },
    })
  ).json();
  // A strip kept whole names every view it showed; Notes is left out, as
  // a view the app gained after the strip was arranged would be.
  const kept = await request.patch(`/api/events/${event.id}/view`, {
    headers,
    data: {
      tabs: {
        order: [
          "overview",
          "todos",
          "calendar",
          "timeline",
          "itinerary",
          "expenses",
          "reminders",
          "files",
          "people",
          "sharing",
          "removed-links",
        ],
      },
    },
  });
  expect(kept.status()).toBe(200);

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Arranger");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto(`/events/${event.id}?view=todos`);
  await expect(
    page.getByRole("tab", { name: "Tasks", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(await viewTabs(page)).toEqual([
    "Overview",
    "Tasks",
    "Calendar",
    "Timeline",
    "Itinerary",
    "Expenses",
    "Reminders",
    "Files",
    "People",
    "Sharing",
    "Removed links",
  ]);
  await page.getByRole("button", { name: "Add a view", exact: true }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Add to Lantern walk" })
      .getByRole("button", { name: /^Notes/ }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("opens an event where the account left it, else on its Overview", async ({
  page,
  request,
}) => {
  const email = `place-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Returner" },
  });
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const create = async (displayName: string) =>
    (
      await request.post("/api/events", {
        headers,
        data: { displayName, timezone: "UTC" },
      })
    ).json();
  const supper = await create("Harvest supper");
  const walk = await create("Lantern walk");

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Returner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);

  // A view: Tasks is where the supper was left, and a bare address
  // returns there, naming it.
  await page.goto(`/events/${supper.id}`);
  await openEventView(page, "Tasks");
  await page.goto(`/events/${walk.id}`);
  await expect(page).toHaveURL(
    new RegExp(`/events/${walk.id}\\?view=overview$`, "u"),
  );
  await page.goto(`/events/${supper.id}`);
  await expect(page).toHaveURL(
    new RegExp(`/events/${supper.id}\\?view=todos$`, "u"),
  );
  await expect(
    page.getByRole("tab", { name: "Tasks", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  // A page: the walk is left on its first page, and returns there while
  // the page exists; once it is gone the walk opens on its Overview.
  await page.goto(`/events/${walk.id}`);
  await openAddPage(page);
  const addPage = page.getByRole("dialog", { name: "Add a page" });
  await addPage.getByLabel("Page name").fill("Route");
  await addPage.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(addPage).toHaveCount(0);
  await expect(page).toHaveURL(/\?page=[0-9a-f-]+$/u);
  const pageId = new URL(page.url()).searchParams.get("page");
  await page.goto(`/events/${walk.id}`);
  await expect(page).toHaveURL(
    new RegExp(`/events/${walk.id}\\?page=${pageId}$`, "u"),
  );
  await expect(
    page.getByRole("heading", { name: "Route", exact: true }),
  ).toBeVisible();
  const layout = await (
    await request.get(`/api/events/${walk.id}/layout`, { headers })
  ).json();
  const removed = await request.patch(`/api/events/${walk.id}/layout`, {
    headers,
    data: { expectedVersion: layout.version, pages: [] },
  });
  expect(removed.status()).toBe(200);
  await page.goto(`/events/${walk.id}`);
  await expect(page).toHaveURL(
    new RegExp(`/events/${walk.id}\\?view=overview$`, "u"),
  );
});
