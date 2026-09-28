import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./fixtures";
import { pressRow } from "./helpers/record-composers";

async function account(
  request: APIRequestContext,
  email: string,
  displayName: string,
) {
  const signedIn = await request.post("/api/auth/development/sign-in", {
    data: { email, displayName },
  });
  expect(signedIn.status()).toBe(200);
  return { authorization: `Bearer ${(await signedIn.json()).accessToken}` };
}

test("names a shared event's assignees and labels for a guest who may not open the owner's people", async ({
  page,
  request,
}) => {
  const guestEmail = `guest-${randomUUID()}@example.test`;
  const jane = await account(
    request,
    `jane-${randomUUID()}@example.test`,
    "Jane",
  );
  await account(request, guestEmail, "Guest");
  const created = await request.post("/api/events", {
    headers: jane,
    data: { displayName: "Wedding countdown" },
  });
  expect(created.status()).toBe(201);
  const event = await created.json();
  // Mei is a card of Jane's space, not of the Event, so the guest may not
  // open her; the label is Jane's space's too.
  const mei = await request.post("/api/persons", {
    headers: jane,
    data: { displayName: "Mei" },
  });
  expect(mei.status()).toBe(201);
  const venue = await request.post("/api/labels", {
    headers: jane,
    data: { name: "Venue" },
  });
  expect(venue.status()).toBe(201);
  const added = await request.post(`/api/events/${event.id}/resources`, {
    headers: jane,
    data: {
      commandId: randomUUID(),
      resource: {
        objectType: "task",
        displayName: "Book the hall",
        assigneeId: (await mei.json()).id,
        labelIds: [(await venue.json()).id],
      },
    },
  });
  expect(added.status()).toBe(201);
  const shared = await request.post("/api/shares", {
    headers: jane,
    data: { resourceId: event.id, principalEmail: guestEmail, role: "editor" },
  });
  expect(shared.status()).toBe(201);

  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill("Guest");
  await page.getByLabel("Email").fill(guestEmail);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
  await page.goto(`/events/${event.id}?view=todos`);

  // The row names the assignee and the label, as it does for Jane.
  const main = page.getByRole("main");
  const row = main
    .locator("[id^='task-']")
    .filter({ hasText: "Book the hall" });
  await expect(row.locator(".task-assignee")).toHaveText(/Mei$/u);
  await expect(row).toContainText("Venue");

  // Opened in place, the chips read the same names.
  await pressRow(page, "Book the hall");
  await expect(
    main.getByRole("button", { name: "Assignee: Mei", exact: true }),
  ).toBeVisible();
  await expect(
    main.getByRole("button", { name: "Labels: Venue", exact: true }),
  ).toBeVisible();
});
