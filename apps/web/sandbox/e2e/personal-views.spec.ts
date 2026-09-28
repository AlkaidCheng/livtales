import { expect, type Page, test } from "@playwright/test";
import { openAddPage } from "../../e2e/helpers/event-view";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

async function addPage(page: Page, name: string) {
  await openAddPage(page);
  const dialog = page.getByRole("dialog", { name: "Add a page" });
  await dialog.getByLabel("Page name").fill(name);
  await dialog.getByRole("button", { name: "Add page", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

const stripPages = (page: Page) =>
  page.getByRole("navigation", { name: "Pages", exact: true });
const pageOrder = (page: Page) =>
  page.locator(".event-strip-pages [data-page-id]");

test("keeps a viewer's page order and layouts for them, and returns to where the event was left", async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await addPage(page, "Plan");
  await page
    .getByRole("button", { name: "Add component", exact: true })
    .click();
  const picker = page.getByRole("dialog", { name: "Add a component" });
  await picker.getByRole("button", { name: "Add Tasks", exact: true }).click();
  await expect(picker).toHaveCount(0);
  await addPage(page, "Day");

  // A viewer orders the pages for themselves in Manage tabs.
  await page.getByLabel("Preview role").selectOption("viewer");
  await page
    .getByRole("button", { name: "Actions for Autumn gathering" })
    .click();
  await page.getByRole("menuitem", { name: "Manage tabs" }).click();
  const manage = page.getByRole("dialog", { name: "Manage tabs" });
  await manage.getByRole("button", { name: "Move Day" }).focus();
  await page.keyboard.press("ArrowUp");
  await manage.getByRole("button", { name: "Done" }).click();
  await expect(pageOrder(page)).toHaveText(["Day", "Plan"]);

  // …and lays a page component out for themselves.
  await stripPages(page)
    .getByRole("button", { name: "Plan", exact: true })
    .click();
  await page.getByRole("button", { name: "Layout: List" }).click();
  await page.getByRole("menuitemradio", { name: "By day" }).click();
  await expect(
    page.getByRole("button", { name: "Layout: By day" }),
  ).toBeVisible();

  // Leaving the event keeps the place; opening it again returns there.
  await page.getByRole("link", { name: "All events" }).click();
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  await expect(
    stripPages(page).getByRole("button", { name: "Plan", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("button", { name: "Layout: By day" }),
  ).toBeVisible();
  await expect(pageOrder(page)).toHaveText(["Day", "Plan"]);
});
