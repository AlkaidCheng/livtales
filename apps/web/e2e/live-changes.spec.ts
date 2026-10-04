import { randomUUID } from "node:crypto";
import type { Browser, Request } from "@playwright/test";
import { type APIRequestContext, expect, test } from "./fixtures";
import { withoutLiveChanges } from "./helpers/live";
import { chooseRowAction } from "./helpers/row-menu";

/** Signs an account in on a fresh browser of its own. */
async function signedIn(browser: Browser, name: string, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  return { context, page };
}

async function bearer(
  request: APIRequestContext,
  email: string,
  displayName: string,
) {
  const session = await (
    await request.post("/api/auth/development/sign-in", {
      data: { email, displayName },
    })
  ).json();
  return { authorization: `Bearer ${session.accessToken}` };
}

/** An event of Ana's shared with Ben as an editor. */
async function sharedEvent(request: APIRequestContext, benEmail: string) {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const ana = await bearer(request, anaEmail, "Ana");
  // Ben's account exists before the event is shared with its email.
  await bearer(request, benEmail, "Ben");
  const created = await request.post("/api/events", {
    headers: ana,
    data: { displayName: "Lantern walk", timezone: "UTC" },
  });
  expect(created.status()).toBe(201);
  const event = (await created.json()) as { id: string };
  const shared = await request.post("/api/shares", {
    headers: ana,
    data: { resourceId: event.id, principalEmail: benEmail, role: "editor" },
  });
  expect(shared.status()).toBe(201);
  const addTask = async (displayName: string) => {
    const response = await request.post(`/api/events/${event.id}/resources`, {
      headers: ana,
      data: {
        commandId: randomUUID(),
        resource: { objectType: "task", displayName },
      },
    });
    expect(response.status()).toBe(201);
    return (await response.json()).resource as { id: string; version: number };
  };
  return { ana, anaEmail, event, addTask };
}

test("shows the tasks another person adds, renames, and trashes while the event is open @webkit-desktop", async ({
  browser,
  request,
}) => {
  const benEmail = `ben-${randomUUID()}@example.test`;
  const { ana, event, addTask } = await sharedEvent(request, benEmail);
  const ben = await signedIn(browser, "Ben", benEmail);
  const reads: string[] = [];
  ben.page.on("request", (sent: Request) => {
    if (sent.url().includes(`/api/events/${event.id}/todos`))
      reads.push(sent.url());
  });
  await ben.page.goto(`/events/${event.id}?view=todos`);
  const rows = ben.page.getByRole("main");
  await expect(rows.getByText("Lantern walk").first()).toBeVisible();

  const hall = await addTask("Book the hall");
  await expect(rows.getByText("Book the hall")).toBeVisible();

  const readsBeforeRename = reads.length;
  const renamed = await request.patch(`/api/tasks/${hall.id}`, {
    headers: ana,
    data: { expectedVersion: hall.version, displayName: "Book the town hall" },
  });
  expect(renamed.status()).toBe(200);
  await expect(rows.getByText("Book the town hall")).toBeVisible();
  // A new name is written where the list holds the task; the list is not read again.
  expect(reads).toHaveLength(readsBeforeRename);

  const version = ((await renamed.json()) as { version: number }).version;
  const trashed = await request.delete(
    `/api/objects/${hall.id}?expectedVersion=${version}`,
    { headers: ana },
  );
  expect(trashed.status()).toBe(200);
  await expect(rows.getByText("Book the town hall")).toHaveCount(0);
  await ben.context.close();
});

test("keeps an open editor on the newest version, so its save carries only its own change @webkit-desktop", async ({
  browser,
  request,
}) => {
  const benEmail = `ben-${randomUUID()}@example.test`;
  const { ana, event, addTask } = await sharedEvent(request, benEmail);
  const hall = await addTask("Book the hall");
  const ben = await signedIn(browser, "Ben", benEmail);
  const refused: string[] = [];
  ben.page.on("response", (response) => {
    if (response.status() === 409) refused.push(response.url());
  });
  await ben.page.goto(`/events/${event.id}?view=todos`);
  const row = ben.page.getByRole("row", { name: /Book the hall/ });
  await row.getByRole("button", { name: "Edit Book the hall" }).click();
  const composer = ben.page.getByRole("form", { name: "Edit Book the hall" });
  await composer
    .getByLabel("Task name", { exact: true })
    .fill("Book the town hall");

  // Ana sets the place while Ben's row is open: the row takes it, and
  // Ben's name stays as he typed it.
  const placed = await request.patch(`/api/tasks/${hall.id}`, {
    headers: ana,
    data: { expectedVersion: hall.version, location: "Riverside" },
  });
  expect(placed.status()).toBe(200);
  await expect(
    composer.getByRole("button", { name: "Location: Riverside", exact: true }),
  ).toBeVisible();
  await expect(composer.getByLabel("Task name", { exact: true })).toHaveValue(
    "Book the town hall",
  );

  await composer.getByRole("button", { name: "Save", exact: true }).click();
  await expect(composer).toHaveCount(0);
  const saved = await (
    await request.get(`/api/tasks/${hall.id}`, { headers: ana })
  ).json();
  expect(saved).toMatchObject({
    version: hall.version + 2,
    displayName: "Book the town hall",
    location: "Riverside",
  });
  // The save was made on the newest version, never refused.
  expect(refused).toEqual([]);
  await ben.context.close();
});

test("keeps an open Actions dialog on its task, and says who moved it to Trash meanwhile", async ({
  browser,
  request,
}) => {
  const benEmail = `ben-${randomUUID()}@example.test`;
  const { ana, event, addTask } = await sharedEvent(request, benEmail);
  const hall = await addTask("Book the hall");
  const ben = await signedIn(browser, "Ben", benEmail);
  await ben.page.goto(`/events/${event.id}?view=todos`);
  await chooseRowAction(
    ben.page,
    ben.page.getByRole("row", { name: /Book the hall/ }),
    "Move to Trash",
  );
  const dialog = ben.page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "Remove from this event", exact: true }),
  ).toBeVisible();

  // Ana renames the task: the dialog names it as it now is.
  const renamed = await request.patch(`/api/tasks/${hall.id}`, {
    headers: ana,
    data: { expectedVersion: hall.version, displayName: "Book the town hall" },
  });
  expect(renamed.status()).toBe(200);
  await expect(
    dialog.getByRole("heading", { name: "Book the town hall", exact: true }),
  ).toBeVisible();

  // Ana moves it to Trash: the verbs give way to why, and Close.
  const version = ((await renamed.json()) as { version: number }).version;
  const trashed = await request.delete(
    `/api/objects/${hall.id}?expectedVersion=${version}`,
    { headers: ana },
  );
  expect(trashed.status()).toBe(200);
  const reason = dialog.getByRole("status");
  await expect(reason).toContainText("Ana moved Book the town hall to Trash");
  await expect(
    dialog.getByRole("button", { name: "Remove from this event", exact: true }),
  ).toHaveCount(0);
  await reason.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    ben.page.getByRole("row", { name: /Book the town hall/ }),
  ).toHaveCount(0);
  await ben.context.close();
});

test("says why a Move to Trash was refused when the change behind it never arrived", async ({
  browser,
  request,
}) => {
  const benEmail = `ben-${randomUUID()}@example.test`;
  const { ana, anaEmail, event, addTask } = await sharedEvent(
    request,
    benEmail,
  );
  const hall = await addTask("Book the hall");
  const anaBrowser = await signedIn(browser, "Ana", anaEmail);
  const { page } = anaBrowser;
  await withoutLiveChanges(page);
  await page.goto(`/events/${event.id}?view=todos`);
  const row = page.getByRole("row", { name: /Book the hall/ });
  await chooseRowAction(page, row, "Move to Trash");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  await expect(dialog).toContainText("Move Book the hall to Trash?");

  // Ana's other session moves it to Trash first.
  const trashed = await request.delete(
    `/api/objects/${hall.id}?expectedVersion=${hall.version}`,
    { headers: ana },
  );
  expect(trashed.status()).toBe(200);
  await dialog
    .getByRole("button", { name: "Move to Trash", exact: true })
    .click();
  const reason = dialog.getByRole("status");
  await expect(reason).toContainText(
    "Book the hall changed after you opened this",
  );
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await reason.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  // The refusal had the list read again.
  await expect(row).toHaveCount(0);
  await anaBrowser.context.close();
});

test("holds one stream for all of a browser's tabs and hands it on when that tab closes", async ({
  browser,
  request,
}) => {
  const benEmail = `ben-${randomUUID()}@example.test`;
  const { event, addTask } = await sharedEvent(request, benEmail);
  const ben = await signedIn(browser, "Ben", benEmail);
  const streams: string[] = [];
  ben.context.on("request", (sent) => {
    if (new URL(sent.url()).pathname === "/api/live") streams.push(sent.url());
  });
  await ben.page.goto(`/events/${event.id}?view=todos`);
  const second = await ben.context.newPage();
  await second.goto(`/events/${event.id}?view=todos`);
  await addTask("Order lanterns");
  await expect(
    second.getByRole("row", { name: /Order lanterns/ }),
  ).toBeVisible();
  await expect(
    ben.page.getByRole("row", { name: /Order lanterns/ }),
  ).toBeVisible();
  expect(streams).toHaveLength(1);

  await ben.page.close();
  await expect.poll(() => streams.length).toBe(2);
  await addTask("Collect candles");
  await expect(
    second.getByRole("row", { name: /Collect candles/ }),
  ).toBeVisible();
  await ben.context.close();
});

test("shows who else is on the event and says what they change, until the account turns that off", async ({
  browser,
  request,
}) => {
  const benEmail = `ben-${randomUUID()}@example.test`;
  const { ana, anaEmail, event, addTask } = await sharedEvent(
    request,
    benEmail,
  );
  const hall = await addTask("Book the hall");
  const anaBrowser = await signedIn(browser, "Ana", anaEmail);
  const ben = await signedIn(browser, "Ben", benEmail);
  await anaBrowser.page.goto(`/events/${event.id}?view=todos`);
  await ben.page.goto(`/events/${event.id}?view=overview`);

  const here = (page: typeof ben.page) =>
    page.getByRole("list", { name: "People here", exact: true });
  await expect(
    here(ben.page).getByRole("listitem", { name: "Ana", exact: true }),
  ).toBeVisible();
  await expect(
    here(anaBrowser.page).getByRole("listitem", {
      name: "Ben",
      exact: true,
    }),
  ).toBeVisible();

  const renamed = await request.patch(`/api/tasks/${hall.id}`, {
    headers: ana,
    data: { expectedVersion: hall.version, displayName: "Book the town hall" },
  });
  expect(renamed.status()).toBe(200);
  const notice = ben.page
    .getByRole("status")
    .filter({ hasText: "Ana renamed Book the hall to Book the town hall" });
  await expect(notice).toBeVisible();
  // Ana's own browser learns of her change without a pop-up.
  await expect(
    anaBrowser.page.getByRole("status").filter({ hasText: "Ana renamed" }),
  ).toHaveCount(0);

  await ben.page.goto(`/events/${event.id}?view=todos&settings=notifications`);
  const toggle = ben.page.getByRole("switch", {
    name: "Show when others make changes",
  });
  await expect(toggle).toBeChecked();
  await toggle.click();
  await expect(toggle).not.toBeChecked();
  await ben.page.keyboard.press("Escape");
  const version = ((await renamed.json()) as { version: number }).version;
  await request.patch(`/api/tasks/${hall.id}`, {
    headers: ana,
    data: { expectedVersion: version, displayName: "Book the old hall" },
  });
  await expect(ben.page.getByText("Book the old hall")).toBeVisible();
  await expect(
    ben.page.getByRole("status").filter({ hasText: /^A?Ana / }),
  ).toHaveCount(0);
  await anaBrowser.context.close();
  await ben.context.close();
});

test("stacks a crowd's faces newest first and lists everyone from the count", async ({
  browser,
  request,
}, testInfo) => {
  const shownFaces = testInfo.project.name.endsWith("mobile") ? 2 : 3;
  const viewerEmail = `eve-${randomUUID()}@example.test`;
  const { ana, event } = await sharedEvent(request, viewerEmail);
  const guests = ["Ben", "Chen", "Dee", "Fay"].map((name) => ({
    name,
    email: `${name.toLowerCase()}-${randomUUID()}@example.test`,
  }));
  for (const guest of guests) {
    await bearer(request, guest.email, guest.name);
    const shared = await request.post("/api/shares", {
      headers: ana,
      data: {
        resourceId: event.id,
        principalEmail: guest.email,
        role: "viewer",
      },
    });
    expect(shared.status()).toBe(201);
  }
  const eve = await signedIn(browser, "Eve", viewerEmail);
  await eve.page.goto(`/events/${event.id}?view=overview`);
  const faces = eve.page.getByRole("list", {
    name: "People here",
    exact: true,
  });
  const opened = [];
  // One at a time, so each arrives after the one before.
  for (const [index, guest] of guests.entries()) {
    const browserOf = await signedIn(browser, guest.name, guest.email);
    await browserOf.page.goto(`/events/${event.id}?view=overview`);
    opened.push(browserOf);
    await expect(faces.first().getByRole("listitem")).toHaveCount(
      Math.min(index + 1, shownFaces),
    );
  }
  const newestFirst = ["Fay", "Dee", "Chen", "Ben"];
  const shown = faces.first().getByRole("listitem");
  for (const [index, name] of newestFirst.slice(0, shownFaces).entries())
    await expect(shown.nth(index)).toHaveAccessibleName(name);
  const count = eve.page.getByRole("button", { name: "4 people here" });
  await expect(count).toHaveText(`+${newestFirst.length - shownFaces}`);
  await count.click();
  await expect(count).toHaveAttribute("aria-expanded", "true");
  await expect(faces.last().getByRole("listitem")).toHaveText(newestFirst);
  await eve.page.keyboard.press("Escape");
  await expect(faces).toHaveCount(1);
  for (const browserOf of opened) await browserOf.context.close();
  await eve.context.close();
});
