import { expect, type Locator, type Page } from "@playwright/test";

// The chip and its menu by their place in the strip, whatever the language.
const foldChip = (page: Page) =>
  page.locator("[data-strip-chip] .event-strip-more").getByRole("button");

/** Picks a tab folded away at the strip's end from the chip that lists them. */
async function pickFoldedTab(page: Page, name: string): Promise<boolean> {
  const chip = foldChip(page);
  if (!(await chip.isVisible())) return false;
  await chip.click();
  const menu = page.locator("[data-strip-chip]").getByRole("menu");
  await expect(menu).toBeVisible();
  const item = menu.getByRole("menuitem", { name, exact: true });
  if (await item.isVisible()) {
    await item.click();
    return true;
  }
  await page.keyboard.press("Escape");
  return false;
}

// The strip's controls and the gallery by their place, whatever the
// language: the plus after the views, the plus among the pages, and the
// gallery's cards and footer.
const addViewButton = (page: Page) =>
  page.locator(".event-strip-end .event-strip-plus");
const addPageButton = (page: Page) =>
  page.locator(".event-strip-pages .event-strip-plus");
const galleryDialog = (page: Page) => page.locator("dialog.gallery-dialog");

/**
 * Puts a view back on the strip: from the gallery, or, for a view the event
 * always has but keeps hidden (Sharing, Removed links), from Manage tabs,
 * which this path reaches by its English names.
 */
async function putOnStrip(page: Page, name: string): Promise<void> {
  await addViewButton(page).click();
  const gallery = galleryDialog(page);
  await expect(gallery).toBeVisible();
  const card = gallery
    .locator(".gallery-card")
    .filter({ has: page.locator("strong").getByText(name, { exact: true }) });
  const off =
    (await card.count()) > 0 &&
    (await card.getAttribute("aria-pressed")) === "false";
  if (off) {
    await card.click();
    await expect(card).toHaveAttribute("aria-pressed", "true");
  }
  await gallery.locator(".event-create-footer > .button").last().click();
  await expect(gallery).toHaveCount(0);
  if (off) return;
  await page
    .locator(".event-hero")
    .getByRole("button", { name: /^Actions for / })
    .click();
  await page
    .getByRole("menuitem", { name: "Manage tabs", exact: true })
    .click();
  const manage = page.getByRole("dialog", { name: "Manage tabs" });
  await manage
    .getByRole("button", { name: `Show ${name}`, exact: true })
    .click();
  await manage.getByRole("button", { name: "Done", exact: true }).click();
  await expect(manage).toHaveCount(0);
}

/**
 * Opens one of the event's views: through its tab when the strip shows it,
 * else from the chip that lists the tabs folded away when the width runs
 * out, else by putting it on the strip first, since a new event's strip
 * starts with the Overview and Tasks alone.
 */
export async function openEventView(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  await expect
    .poll(
      async () =>
        (await tab.isVisible()) ||
        (await foldChip(page).isVisible()) ||
        (await addViewButton(page).isVisible()),
    )
    .toBe(true);
  if (!(await tab.isVisible()) && !(await pickFoldedTab(page, name)))
    await putOnStrip(page, name);
  await openTab(page, tab, name);
  // The chosen view's tab is current, and a current tab never folds.
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/**
 * Opens the Add a page dialog: from the strip's page plus once the event
 * has a page, else from the gallery's New page, where an event's first page
 * starts.
 */
export async function openAddPage(page: Page): Promise<void> {
  await expect
    .poll(
      async () =>
        (await addPageButton(page).isVisible()) ||
        (await addViewButton(page).isVisible()),
    )
    .toBe(true);
  if (await addPageButton(page).isVisible()) await addPageButton(page).click();
  else {
    await addViewButton(page).click();
    await galleryDialog(page).locator(".gallery-new-page").click();
  }
  await expect(page.locator("dialog.event-create-dialog")).toBeVisible();
}

/** Opens one of the event's pages: through its tab, else from the fold chip. */
export async function openEventPage(page: Page, name: string): Promise<void> {
  const tab = page
    .getByRole("navigation", { name: "Pages", exact: true })
    .getByRole("button", { name, exact: true });
  await openTab(page, tab, name);
  await expect(tab).toHaveAttribute("aria-current", "page");
}

/**
 * Presses a tab where the strip shows it, else picks it from the fold
 * chip. The strip folds again as a view's controls arrive at its end, so
 * a tab seen a moment ago may have folded away: then it tries again.
 */
async function openTab(page: Page, tab: Locator, name: string) {
  await expect(async () => {
    if (await tab.isVisible()) await tab.click({ timeout: 2_000 });
    else if (!(await pickFoldedTab(page, name)))
      throw new Error(`${name} is neither on the strip nor folded`);
  }).toPass();
}
