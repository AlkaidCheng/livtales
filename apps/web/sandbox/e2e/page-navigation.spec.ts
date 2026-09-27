import { expect, test } from "@playwright/test";
import {
  exercisePageNavigation,
  navigationPageNames,
} from "../../e2e/helpers/page-navigation";
import { openAddPage } from "../../e2e/helpers/event-view";

const sandboxUrl = new URL(
  "../../../../.livtales/sandbox/livtales.html",
  import.meta.url,
).href;

test("preserves named page locations offline", async ({
  page,
  context,
}, testInfo) => {
  await context.setOffline(true);
  await page.goto(sandboxUrl);
  await page.getByRole("link", { name: /Autumn gathering/ }).click();
  for (const name of navigationPageNames) {
    await openAddPage(page);
    const dialog = page.getByRole("dialog", { name: "Add a page" });
    await dialog.getByLabel("Page name").fill(name);
    await dialog.getByRole("button", { name: "Add page", exact: true }).click();
    await expect(dialog).toHaveCount(0);
  }
  await exercisePageNavigation(page, testInfo);
});
