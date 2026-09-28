import { randomUUID } from "node:crypto";
import type { Browser } from "@playwright/test";
import { type APIRequestContext, expect, type Page, test } from "./fixtures";
import { openEventView } from "./helpers/event-view";
import { showTasks } from "./helpers/view-options";

/** Signs an account in on a fresh browser of its own. */
async function signedIn(browser: Browser, name: string, email: string) {
  // A context of the test's browser takes the project's device and base URL.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  return { context, page };
}

const pageOrder = (page: Page) =>
  page.locator(".event-strip-pages [data-page-id]");

async function movePageUp(page: Page, eventName: string, pageName: string) {
  await page
    .getByRole("button", { name: `Actions for ${eventName}`, exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Manage tabs", exact: true })
    .click();
  const manage = page.getByRole("dialog", { name: "Manage tabs" });
  await manage
    .getByRole("button", { name: `Move ${pageName}`, exact: true })
    .focus();
  await page.keyboard.press("ArrowUp");
  await manage.getByRole("button", { name: "Done", exact: true }).click();
  await expect(manage).toHaveCount(0);
}

async function yours(
  request: APIRequestContext,
  headers: Record<string, string>,
  eventId: string,
) {
  const response = await request.get(
    `/api/events/${eventId}/layout?include=yours`,
    { headers },
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    readonly pages: readonly { readonly id: string }[];
    readonly yours: {
      readonly place: unknown;
      readonly pages: readonly string[];
      readonly choices: Record<string, unknown>;
    };
  };
}

test("keeps each account's own page order and tab choices, and opens a new browser where the account left the event", async ({
  browser,
  request,
}) => {
  const anaEmail = `ana-${randomUUID()}@example.test`;
  const benEmail = `ben-${randomUUID()}@example.test`;
  const token = async (email: string, displayName: string) => {
    const session = await (
      await request.post("/api/auth/development/sign-in", {
        data: { email, displayName },
      })
    ).json();
    return { authorization: `Bearer ${session.accessToken}` };
  };
  const ana = await token(anaEmail, "Ana");
  const ben = await token(benEmail, "Ben");
  const created = await request.post("/api/events", {
    headers: ana,
    data: { displayName: "Lantern walk", timezone: "UTC" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  const plan = randomUUID();
  const budget = randomUUID();
  const layout = await request.patch(`/api/events/${event.id}/layout`, {
    headers: ana,
    data: {
      expectedVersion: 0,
      pages: [
        {
          id: plan,
          name: "Plan",
          components: [{ id: randomUUID(), kind: "todos" }],
        },
        { id: budget, name: "Budget", components: [] },
      ],
    },
  });
  expect(layout.status()).toBe(200);
  for (const resource of [
    { objectType: "task", displayName: "Book the hall" },
    {
      objectType: "task",
      displayName: "Print the lanterns",
      status: "done",
      completedAt: "2030-10-30T09:00:00.000Z",
    },
  ]) {
    const response = await request.post(`/api/events/${event.id}/resources`, {
      headers: ana,
      data: { commandId: randomUUID(), resource },
    });
    expect(response.status()).toBe(201);
  }
  const shared = await request.post("/api/shares", {
    headers: ana,
    data: { resourceId: event.id, principalEmail: benEmail, role: "viewer" },
  });
  expect(shared.status()).toBe(201);

  // Ana, an editor, shows the finished tasks on the Tasks tab, puts Budget
  // first, and stays on the Budget page.
  const first = await signedIn(browser, "Ana", anaEmail);
  await first.page.goto(`/events/${event.id}?view=todos`);
  await openEventView(first.page, "Tasks");
  await showTasks(first.page, "All");
  await expect(
    first.page.getByRole("button", { name: "Showing finished, remove" }),
  ).toBeVisible();
  await movePageUp(first.page, "Lantern walk", "Budget");
  await expect(pageOrder(first.page)).toHaveText(["Budget", "Plan"]);
  await first.page
    .locator(`.event-strip-pages [data-page-id="${budget}"]`)
    .click();
  await expect
    .poll(async () => (await yours(request, ana, event.id)).yours.place)
    .toEqual({ page: budget });
  const anaView = await yours(request, ana, event.id);
  expect(anaView.yours.choices).toEqual({ todos: { show: "all" } });
  // An editor's page order is the event's too.
  expect(anaView.pages.map((page) => page.id)).toEqual([budget, plan]);
  await first.context.close();

  // Ben, a viewer, starts from the event's order and his own choices, and
  // orders the pages for himself.
  const second = await signedIn(browser, "Ben", benEmail);
  await second.page.goto(`/events/${event.id}`);
  await expect(second.page).toHaveURL(/\?view=overview$/u);
  await expect(pageOrder(second.page)).toHaveText(["Budget", "Plan"]);
  await openEventView(second.page, "Tasks");
  await expect(
    second.page.getByRole("button", { name: "Showing finished, remove" }),
  ).toHaveCount(0);
  await movePageUp(second.page, "Lantern walk", "Plan");
  await expect(pageOrder(second.page)).toHaveText(["Plan", "Budget"]);
  await expect
    .poll(async () => (await yours(request, ben, event.id)).yours.pages)
    .toEqual([plan, budget]);
  expect(
    (await yours(request, ana, event.id)).pages.map((page) => page.id),
  ).toEqual([budget, plan]);
  await second.context.close();

  // A new browser of Ana's opens the event where that account left it, in
  // its order and with its choices.
  const third = await signedIn(browser, "Ana", anaEmail);
  await third.page.goto(`/events/${event.id}`);
  await expect(third.page).toHaveURL(new RegExp(`\\?page=${budget}$`, "u"));
  await expect(pageOrder(third.page)).toHaveText(["Budget", "Plan"]);
  await openEventView(third.page, "Tasks");
  await expect(
    third.page.getByRole("button", { name: "Showing finished, remove" }),
  ).toBeVisible();
  await third.context.close();
});
