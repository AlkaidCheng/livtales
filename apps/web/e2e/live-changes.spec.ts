import { randomUUID } from "node:crypto";
import type { Browser, Request } from "@playwright/test";
import { type APIRequestContext, expect, test } from "./fixtures";

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
  const ana = await bearer(request, `ana-${randomUUID()}@example.test`, "Ana");
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
  return { ana, event, addTask };
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
  await expect(second.getByText("Order lanterns")).toBeVisible();
  await expect(ben.page.getByText("Order lanterns")).toBeVisible();
  expect(streams).toHaveLength(1);

  await ben.page.close();
  await expect.poll(() => streams.length).toBe(2);
  await addTask("Collect candles");
  await expect(second.getByText("Collect candles")).toBeVisible();
  await ben.context.close();
});
