import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";

const chip = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Which events" })
    .getByRole("button", { name, exact: true });

/** The list's headings in order, each as it reads with its count. */
const headings = (page: Page) => page.locator(".event-fold");

test("groups the Events list by year and month, folds each heading, and keeps the folds per list across a reload", async ({
  page,
  request,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const email = `months-${randomUUID()}@example.test`;
  const session = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email, displayName: "Mei" },
    })
  ).json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  // Upcoming events a few years ahead; past ones in the two years before
  // this one, and one an hour ago, this year and this month.
  const thisYear = new Date().getFullYear();
  const [ahead, after, before, earlier] = [
    thisYear + 4,
    thisYear + 5,
    thisYear - 1,
    thisYear - 2,
  ];
  for (const data of [
    {
      displayName: "Autumn gathering",
      startsOn: `${ahead}-10-10`,
      location: "Garden",
    },
    { displayName: "Harvest supper", startsOn: `${ahead}-10-24` },
    {
      displayName: "Kyoto in November",
      startsOn: `${ahead}-11-14`,
      endsOn: `${ahead}-11-20`,
    },
    { displayName: "Winter cabin", startsOn: `${after}-01-09` },
    { displayName: "A quiet studio weekend" },
    {
      displayName: "Earlier today",
      startsAt: new Date(Date.now() - 3.6e6).toISOString(),
    },
    { displayName: "New Year's Eve", startsOn: `${before}-12-31` },
    { displayName: "Autumn walk", startsOn: `${before}-10-19` },
    { displayName: "Graduation", startsOn: `${earlier}-06-12` },
  ]) {
    const response = await request.post("/api/events", { headers, data });
    expect(response.status()).toBe(201);
  }

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Mei");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  const thisMonth = await page.evaluate(() =>
    new Intl.DateTimeFormat("en", { month: "long" }).format(
      new Date(Date.now() - 3.6e6),
    ),
  );

  // All: forward by year and month, the undated event last.
  await expect(headings(page)).toHaveText([
    `${earlier}`,
    "June 1 event",
    `${before}`,
    "October 1 event",
    "December 1 event",
    `${thisYear}`,
    `${thisMonth} 1 event`,
    `${ahead}`,
    "October 2 events",
    "November 1 event",
    `${after}`,
    "January 1 event",
    "No date yet 1 event",
  ]);
  await expect(
    page.getByRole("heading", { level: 2, name: `${ahead}` }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 3, name: "November 1 event" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Autumn gathering/ }),
  ).toContainText(`Oct 10, ${ahead} · Garden`);

  // Upcoming: from today onward, no undated group.
  await chip(page, "Upcoming").click();
  await expect(headings(page)).toHaveText([
    `${ahead}`,
    "October 2 events",
    "November 1 event",
    `${after}`,
    "January 1 event",
  ]);
  const october = page.getByRole("button", { name: "October 2 events" });
  await october.click();
  await expect(october).toHaveAttribute("aria-expanded", "false");
  await expect(
    page.getByRole("link", { name: /Autumn gathering/ }),
  ).toHaveCount(0);
  // A folded year shows its own count; the keyboard folds as a tap does.
  await page.getByRole("button", { name: `${after}`, exact: true }).focus();
  await page.keyboard.press("Enter");
  const folded = page.getByRole("button", { name: `${after} 1 event` });
  await expect(folded).toHaveAttribute("aria-expanded", "false");
  await expect(folded).toBeFocused();
  await expect(
    page.getByRole("button", { name: "January 1 event" }),
  ).toHaveCount(0);
  await expect(headings(page)).toHaveText([
    `${ahead}`,
    "October 2 events",
    "November 1 event",
    `${after} 1 event`,
  ]);
  await page.screenshot({ path: testInfo.outputPath("upcoming-folded.png") });

  // Past: back from the most recent month; the years before this one
  // start folded.
  await chip(page, "Past").click();
  await expect(headings(page)).toHaveText([
    `${thisYear}`,
    `${thisMonth} 1 event`,
    `${before} 2 events`,
    `${earlier} 1 event`,
  ]);
  await expect(page.getByRole("link", { name: /Earlier today/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /New Year's Eve/ })).toHaveCount(
    0,
  );
  const previous = page.getByRole("button", { name: `${before} 2 events` });
  await expect(previous).toHaveAttribute("aria-expanded", "false");
  await previous.click();
  await expect(headings(page)).toHaveText([
    `${thisYear}`,
    `${thisMonth} 1 event`,
    `${before}`,
    "December 1 event",
    "October 1 event",
    `${earlier} 1 event`,
  ]);
  await page.screenshot({ path: testInfo.outputPath("past.png") });

  // A reload keeps each list's folds; the chips start over at All, whose
  // own headings stay open.
  await page.reload();
  await expect(
    page.getByRole("button", { name: "October 2 events" }),
  ).toHaveAttribute("aria-expanded", "true");
  await chip(page, "Upcoming").click();
  await expect(headings(page)).toHaveText([
    `${ahead}`,
    "October 2 events",
    "November 1 event",
    `${after} 1 event`,
  ]);
  await expect(
    page.getByRole("button", { name: "October 2 events" }),
  ).toHaveAttribute("aria-expanded", "false");
  await chip(page, "Past").click();
  await expect(headings(page)).toHaveText([
    `${thisYear}`,
    `${thisMonth} 1 event`,
    `${before}`,
    "December 1 event",
    "October 1 event",
    `${earlier} 1 event`,
  ]);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
        document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
