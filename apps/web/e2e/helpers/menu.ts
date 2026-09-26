import type { Locator, Page } from "@playwright/test";

/** Opens a menu and chooses the option of that name. */
export async function chooseFromMenu(
  page: Page,
  menu: Locator,
  option: string | RegExp,
): Promise<void> {
  await menu.click();
  await page
    .getByRole("option", {
      name: option,
      ...(typeof option === "string" ? { exact: true } : {}),
    })
    .click();
}
