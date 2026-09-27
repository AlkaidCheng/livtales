import { expect, type Locator, type Page } from "@playwright/test";

/** The strip's end, where a tab's controls or its options button sit. */
const stripEnd = (page: Page) => page.locator(".event-strip-options");

/** The options button a phone shows at the strip's end. */
const optionsButton = (scope: Page | Locator) =>
  scope.getByRole("button", { name: / options$/ });

/** The options pop-up the button opens. */
const optionsPopup = (page: Page) =>
  page.getByRole("dialog", { name: / options$/ });

/**
 * Sets what a task list shows (Open, All, or Finished): from its Filter
 * word on a wide screen or inside a page, or from the tab's options on a
 * phone. `scope` narrows the search to one component on a page.
 */
export async function showTasks(
  page: Page,
  show: "Open" | "All" | "Finished",
  scope: Page | Locator = page,
): Promise<void> {
  const filter = scope.getByRole("button", { name: /^Filter/ }).first();
  const options = optionsButton(scope);
  await expect(filter.or(options).first()).toBeVisible();
  if (await filter.isVisible()) {
    await filter.click();
    const panel = page.getByRole("dialog", { name: "Filter", exact: true });
    await panel.getByRole("radio", { name: show, exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    return;
  }
  await options.click();
  const popup = optionsPopup(page);
  await popup.getByRole("radio", { name: show, exact: true }).click();
  await popup.getByRole("button", { name: "Done", exact: true }).click();
  await expect(popup).toHaveCount(0);
}

/** The chip under the strip saying a tab's list shows its finished tasks too. */
export function showingFinished(page: Page): Locator {
  return page.getByRole("button", {
    name: "Showing finished, remove",
    exact: true,
  });
}

/**
 * Presses one of the tab's actions (Share, Copy day): its word at the
 * strip's end on a wide screen, or its row in the options on a phone.
 * Returns the control focus comes back to.
 */
export async function pressViewAction(
  page: Page,
  name: string,
): Promise<Locator> {
  const word = stripEnd(page).getByRole("button", { name, exact: true });
  const options = optionsButton(stripEnd(page));
  await expect(word.or(options).first()).toBeVisible();
  if (await word.isVisible()) {
    await word.click();
    return word;
  }
  await options.click();
  await optionsPopup(page).getByRole("button", { name, exact: true }).click();
  return options;
}

/**
 * Chooses in one of the tab's menus (Sort): its word's menu on a wide
 * screen, or its row's list in the options on a phone.
 */
export async function chooseViewOption(
  page: Page,
  control: string,
  choice: string,
): Promise<void> {
  const word = stripEnd(page).getByRole("button", {
    name: new RegExp(`^${control}(: |$)`, "u"),
  });
  const options = optionsButton(stripEnd(page));
  await expect(word.or(options).first()).toBeVisible();
  if (await word.isVisible()) {
    await word.click();
    await page
      .getByRole("menuitemradio", { name: choice, exact: true })
      .click();
    return;
  }
  await options.click();
  const popup = optionsPopup(page);
  await popup
    .getByRole("button", { name: new RegExp(`^${control}`, "u") })
    .click();
  await popup.getByRole("option", { name: choice, exact: true }).click();
  await popup.getByRole("button", { name: "Done", exact: true }).click();
  await expect(popup).toHaveCount(0);
}
