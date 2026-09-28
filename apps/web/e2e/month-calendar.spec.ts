import { randomUUID } from "node:crypto";
import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";
import { chooseLayout } from "./helpers/component-views";
import { openEventView } from "./helpers/event-view";
import { today } from "./helpers/today";

/** The size of an entry's mark, its `::before`, in CSS pixels. */
async function markSize(entry: Locator) {
  return entry.evaluate((element) => {
    const mark = getComputedStyle(element, "::before");
    return {
      width: Number.parseFloat(mark.width),
      height: Number.parseFloat(mark.height),
    };
  });
}

test("draws a day's entries with a thin line, and on a phone gives the calendar the screen and each name two lines", async ({
  page,
  request,
}, testInfo) => {
  const phone = testInfo.project.name.endsWith("mobile");
  const email = `month-${randomUUID()}@example.test`;
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Planner" },
  });
  expect(signedIn.status()).toBe(200);
  const headers = {
    authorization: `Bearer ${(await signedIn.json()).accessToken}`,
  };
  const created = await request.post("/api/events", {
    headers,
    data: { displayName: "Wedding countdown" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  for (const displayName of ["买喜糖和伴手礼", "Tea ceremony"]) {
    const added = await request.post(`/api/events/${event.id}/resources`, {
      headers,
      data: {
        commandId: randomUUID(),
        resource: {
          objectType: "event",
          displayName,
          startsOn: today(),
          endsOn: today(),
        },
      },
    });
    expect(added.status()).toBe(201);
  }
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Planner");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/);
  await page.goto(`/events/${event.id}`);
  await openEventView(page, "Calendar");
  const panel = page.locator(".planning-panel").first();
  const addRow = panel.getByRole("button", {
    name: "Add schedule item",
    exact: true,
  });
  // The list ends with its add row on every screen.
  await expect(addRow).toBeVisible();
  await chooseLayout(panel, "Calendar");
  await page.keyboard.press("Escape");

  // Each entry is marked by a 2px line in place of a dot.
  const grid = panel.locator(".month-grid");
  const day = grid.locator(".month-day.is-today");
  const sweets = day.locator("article").filter({ hasText: "买喜糖和" });
  await expect(sweets).toBeVisible();
  const mark = await markSize(sweets);
  expect(mark.width).toBe(2);
  expect(mark.height).toBeGreaterThanOrEqual(14);
  await page.screenshot({ path: testInfo.outputPath("month.png") });
  if (!phone) {
    // A wide screen keeps its add row, as it has no add button.
    await expect(addRow).toBeVisible();
    return;
  }

  // A phone: the grid spans the screen, the add button adds instead of a
  // row under the grid, and a long name wraps to a second line, cut there,
  // with no row menu beside it.
  const viewport = page.viewportSize();
  const box = await grid.boundingBox();
  expect(viewport).not.toBeNull();
  expect(box).not.toBeNull();
  if (viewport === null || box === null) return;
  expect(Math.round(box.x)).toBe(0);
  expect(Math.round(box.width)).toBe(viewport.width);
  await expect(addRow).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add to Wedding countdown", exact: true }),
  ).toBeVisible();
  const name = sweets.locator("h3");
  const lines = await name.evaluate((element) =>
    Math.round(
      element.getBoundingClientRect().height /
        Number.parseFloat(getComputedStyle(element).lineHeight),
    ),
  );
  expect(lines).toBe(2);
  // The line runs the name's full height.
  const nameHeight = await name.evaluate(
    (element) => element.getBoundingClientRect().height,
  );
  expect((await markSize(sweets)).height).toBeGreaterThanOrEqual(
    Math.floor(nameHeight),
  );
  await expect(sweets.locator(".row-more")).toBeHidden();

  // By week and Board leave adding to the add button too; List keeps its row.
  for (const layout of ["By week", "Board"]) {
    await chooseLayout(panel, layout);
    await page.keyboard.press("Escape");
    await expect(panel.getByText("Tea ceremony").first()).toBeVisible();
    await expect(addRow).toHaveCount(0);
  }
  await chooseLayout(panel, "List");
  await page.keyboard.press("Escape");
  await expect(addRow).toBeVisible();
});
