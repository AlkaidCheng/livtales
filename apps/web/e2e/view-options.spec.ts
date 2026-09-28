import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { showTasks } from "./helpers/view-options";

// The calendar file writes timed items in UTC; a fixed zone keeps the
// journey's dates the same wherever it runs.
test.use({ timezoneId: "Asia/Tokyo" });

/** An account with an event of nine open and three finished tasks, people, labels, and a schedule. */
async function seedEvent(request: APIRequestContext) {
  const email = `options-${randomUUID()}@example.test`;
  const identity = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName: "Mei Lin" },
  });
  expect(identity.status()).toBe(200);
  const session = await identity.json();
  const headers = { authorization: `Bearer ${session.accessToken}` };
  const post = async (path: string, data: unknown) => {
    const response = await request.post(path, { headers, data });
    expect(response.status(), path).toBe(201);
    return response.json();
  };
  const people = new Map<string, string>();
  for (const name of ["Leo Park", "Ana Lima", "Sam Reyes", "Priya Nair"])
    people.set(name, (await post("/api/persons", { displayName: name })).id);
  const food = await post("/api/labels", { name: "Food" });
  const decor = await post("/api/labels", { name: "Decor" });
  const event = await post("/api/events", {
    displayName: "Autumn gathering",
    timezone: "Asia/Tokyo",
    startsOn: "2030-10-10",
    endsOn: "2030-10-11",
  });
  const tasks: [string, Record<string, unknown>][] = [
    ["Confirm the garden venue", { dueOn: "2030-09-25" }],
    [
      "Plan the menu",
      { assigneeId: people.get("Leo Park"), labelIds: [food.id] },
    ],
    ["Order the cake", { dueOn: "2030-10-08", labelIds: [food.id] }],
    ["Borrow folding chairs", { dueOn: "2030-10-09" }],
    [
      "Buy lanterns",
      { assigneeId: people.get("Ana Lima"), labelIds: [decor.id] },
    ],
    ["Check the weather", { dueOn: "2030-10-09" }],
    ["Print name cards", { labelIds: [decor.id] }],
    ["Arrange rides", { assigneeId: people.get("Leo Park") }],
    ["Thank-you notes", { dueOn: "2030-10-12" }],
    [
      "Send invitations",
      { status: "done", completedAt: "2030-09-01T09:00:00.000Z" },
    ],
    [
      "Book a photographer",
      { status: "done", completedAt: "2030-09-02T09:00:00.000Z" },
    ],
    [
      "Make a playlist",
      { status: "done", completedAt: "2030-09-03T09:00:00.000Z" },
    ],
  ];
  for (const [displayName, fields] of tasks)
    await post(`/api/events/${event.id}/resources`, {
      commandId: randomUUID(),
      resource: { objectType: "task", displayName, ...fields },
    });
  for (const resource of [
    {
      displayName: "Guests arrive",
      startsAt: "2030-10-10T01:00:00.000Z",
      endsAt: "2030-10-10T02:00:00.000Z",
      location: "Garden; north gate",
    },
    { displayName: "Clean up, return chairs", startsOn: "2030-10-11" },
  ])
    await post(`/api/events/${event.id}/resources`, {
      commandId: randomUUID(),
      resource: { objectType: "event", ...resource },
    });
  return { email, event };
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Mei Lin");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
}

/** The names of the task rows shown, in order. */
async function taskNames(page: Page): Promise<string[]> {
  return page
    .locator("#event-panel-todos [id^='task-'] .resource-copy strong")
    .allTextContents();
}

test("puts a tab's controls on the strip, shows its count, and keeps its choices across a reload", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name.endsWith("mobile"),
    "A phone reaches the same choices through the options button.",
  );
  const { email, event } = await seedEvent(request);
  await signIn(page, email);
  await page.goto(`/events/${event.id}?view=todos`);
  const tasksTab = page.getByRole("tab", { name: "Tasks", exact: true });
  await expect(tasksTab).toHaveAttribute("aria-selected", "true");
  // The tab carries the open count; no second line repeats its name.
  await expect(tasksTab).toContainText("9");
  await expect(tasksTab).toHaveAccessibleDescription("9 open");
  await expect(
    page.locator("header.panel-heading", {
      has: page.getByRole("heading", { name: "Tasks" }),
    }),
  ).toHaveClass(/off-screen/);
  const strip = page.locator(".event-strip");
  for (const name of ["Sort", "Filter", "Layout: List", "Export", "Share"])
    await expect(strip.getByRole("button", { name })).toBeVisible();
  expect(await taskNames(page)).toHaveLength(9);
  await page.screenshot({
    path: testInfo.outputPath("tab-options-desktop.png"),
  });

  // Filter opens its rows; Assigned to is a list found by typing a name.
  await strip.getByRole("button", { name: "Filter" }).click();
  const filter = page.getByRole("dialog", { name: "Filter" });
  await filter.getByRole("button", { name: /Assigned to/ }).click();
  const search = filter.getByRole("searchbox", { name: "Find a person" });
  await expect(search).toBeFocused();
  await search.fill("le");
  await expect(filter.getByRole("option")).toHaveText(["LPLeo Park"]);
  await page.screenshot({
    path: testInfo.outputPath("filter-assignee-desktop.png"),
  });
  await filter.getByRole("option", { name: /Leo Park/ }).click();
  await filter.getByRole("switch", { name: "Overdue only" }).click();
  await expect(
    filter.getByRole("switch", { name: "Overdue only" }),
  ).toBeChecked();
  await filter.getByRole("switch", { name: "Overdue only" }).click();
  await page.keyboard.press("Escape");
  await expect(filter).toBeHidden();
  expect(await taskNames(page)).toEqual(["Plan the menu", "Arrange rides"]);

  // The sort names itself on its own control and adds no chip.
  await strip.getByRole("button", { name: "Sort" }).click();
  await page.getByRole("menuitemradio", { name: "By name" }).click();
  await expect(strip.getByRole("button", { name: "Sort" })).toContainText(
    "By name",
  );
  const chips = page.getByRole("list", { name: "Choices on this view" });
  await expect(chips.getByRole("button")).toHaveText(["Assigned to Leo Park×"]);
  expect(await taskNames(page)).toEqual(["Arrange rides", "Plan the menu"]);
  // A second filter adds its chip, and Clear all appears beside them.
  await showTasks(page, "All");
  await expect(chips.getByRole("button")).toHaveText([
    "Showing finished×",
    "Assigned to Leo Park×",
    "Clear all",
  ]);
  await page.screenshot({ path: testInfo.outputPath("chips-desktop.png") });

  // The choices are kept for this view: a reload opens it as it was left.
  await page.reload();
  await expect(chips.getByRole("button")).toHaveText([
    "Showing finished×",
    "Assigned to Leo Park×",
    "Clear all",
  ]);
  await expect(strip.getByRole("button", { name: "Sort" })).toContainText(
    "By name",
  );
  // One chip clears its own choice; Clear all clears the rest.
  await chips.getByRole("button", { name: "Showing finished, remove" }).click();
  await expect(chips.getByRole("button")).toHaveText(["Assigned to Leo Park×"]);
  expect(await taskNames(page)).toEqual(["Arrange rides", "Plan the menu"]);
  await showTasks(page, "All");
  await chips.getByRole("button", { name: "Clear all" }).click();
  await expect(chips).toBeHidden();
  expect(await taskNames(page)).toHaveLength(9);

  // Another tab keeps its own choices and has its own controls.
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(strip.getByRole("button", { name: "Filter" })).toBeHidden();
});

test("lists the finished tasks after the open ones when Show asks for them, and hides them again", async ({
  page,
  request,
}, testInfo) => {
  const { email, event } = await seedEvent(request);
  await signIn(page, email);
  await page.goto(`/events/${event.id}?view=todos`);
  await expect(page.getByText("Plan the menu", { exact: true })).toBeVisible();
  expect(await taskNames(page)).not.toContain("Send invitations");
  // No foot counts the hidden ones; Show in Filter lists them.
  await expect(page.getByRole("button", { name: /\d+ finished/ })).toHaveCount(
    0,
  );
  await showTasks(page, "All");
  const heading = page.getByRole("heading", { name: "Finished · 3" });
  await expect(heading).toBeVisible();
  const names = await taskNames(page);
  expect(names.slice(-3).sort()).toEqual([
    "Book a photographer",
    "Make a playlist",
    "Send invitations",
  ]);
  expect(names.slice(0, 9)).not.toContain("Send invitations");
  const chip = page.getByRole("button", { name: "Showing finished, remove" });
  await expect(chip).toBeVisible();
  // The heading carries no Hide; the chip sets Show back.
  await expect(
    page.getByRole("button", { name: "Hide", exact: true }),
  ).toHaveCount(0);
  await heading.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`finished-${testInfo.project.name}.png`),
  });
  await chip.click();
  await expect(heading).toBeHidden();
  await expect(chip).toBeHidden();
});

test("gathers a tab's options in one pop-up on a phone, with a dot while any is on", async ({
  page,
  request,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.endsWith("mobile"),
    "The options button is the phone's; a wide screen shows the words.",
  );
  const { email, event } = await seedEvent(request);
  await signIn(page, email);
  await page.goto(`/events/${event.id}?view=todos`);
  const strip = page.locator(".event-strip");
  const options = strip.getByRole("button", { name: "Tasks options" });
  await expect(options).toBeVisible();
  await expect(strip.getByRole("button", { name: "Filter" })).toBeHidden();
  await expect(options.locator(".view-options-dot")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("strip-phone.png") });

  await options.click();
  const popup = page.getByRole("dialog", { name: "Tasks options" });
  await expect(popup.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await expect(
    popup.getByRole("radiogroup", { name: "Show" }).getByRole("radio"),
  ).toHaveText(["Open", "All", "Finished"]);
  await expect(
    popup.getByRole("group", { name: "Export" }).getByRole("button"),
  ).toHaveText(["PDF", "CSV"]);
  await page.screenshot({ path: testInfo.outputPath("options-phone.png") });

  // Assigned to opens its list in the pop-up; typing finds the person.
  await popup.getByRole("button", { name: /Assigned to/ }).click();
  await expect(
    popup.getByRole("heading", { name: "Assigned to" }),
  ).toBeVisible();
  await popup.getByRole("searchbox", { name: "Find a person" }).fill("le");
  await expect(popup.getByRole("option")).toHaveText(["LPLeo Park"]);
  await page.screenshot({ path: testInfo.outputPath("assignee-phone.png") });
  await popup.getByRole("option", { name: /Leo Park/ }).click();
  await expect(
    popup.getByRole("button", { name: /Assigned to/ }),
  ).toContainText("Leo Park");
  await popup
    .getByRole("radiogroup", { name: "Show" })
    .getByRole("radio", { name: "All" })
    .click();
  await popup.getByRole("button", { name: "Done" }).click();
  await expect(popup).toBeHidden();
  await expect(options).toBeFocused();
  // The chips and the dot say what is on.
  await expect(options.locator(".view-options-dot")).toHaveCount(1);
  await expect(
    page
      .getByRole("list", { name: "Choices on this view" })
      .getByRole("button"),
  ).toHaveText(["Showing finished×", "Assigned to Leo Park×", "Clear all"]);
  await page.screenshot({ path: testInfo.outputPath("chips-phone.png") });
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(options.locator(".view-options-dot")).toHaveCount(0);

  // The strip stays under the app bar as the list scrolls.
  await page.mouse.wheel(0, 900);
  await expect
    .poll(async () => (await strip.boundingBox())?.y ?? -1)
    .toBeGreaterThanOrEqual(50);
  await expect(options).toBeInViewport();

  // The Overview has no options.
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(strip.getByRole("button", { name: /options$/ })).toHaveCount(0);
});

test("exports the Calendar tab's schedule as a calendar file", async ({
  page,
  request,
}, testInfo) => {
  const { email, event } = await seedEvent(request);
  await signIn(page, email);
  await page.goto(`/events/${event.id}?view=calendar`);
  await expect(page.getByText("Guests arrive")).toBeVisible();
  const download = page.waitForEvent("download");
  if (testInfo.project.name.endsWith("mobile")) {
    await page.getByRole("button", { name: "Calendar options" }).click();
    const popup = page.getByRole("dialog", { name: "Calendar options" });
    await expect(
      popup.getByRole("group", { name: "Export" }).getByRole("button"),
    ).toHaveText(["PDF", "CSV", "Calendar"]);
    await popup.getByRole("button", { name: /calendar \(\.ics\)/ }).click();
  } else {
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "Export to a calendar (.ics)" })
      .click();
  }
  const file = await download;
  expect(file.suggestedFilename()).toBe("Autumn gathering.ics");
  const path = await file.path();
  const text = await readFile(path as string, "utf8");
  expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
  expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
  expect(text).toContain("SUMMARY:Guests arrive\r\n");
  expect(text).toContain("DTSTART:20301010T010000Z\r\n");
  expect(text).toContain("DTEND:20301010T020000Z\r\n");
  expect(text).toContain("LOCATION:Garden\\; north gate\r\n");
  expect(text).toContain("SUMMARY:Clean up\\, return chairs\r\n");
  expect(text).toContain("DTSTART;VALUE=DATE:20301011\r\n");
  expect(text).toContain("DTEND;VALUE=DATE:20301012\r\n");
  expect(text.match(/BEGIN:VEVENT/gu)).toHaveLength(2);
});
