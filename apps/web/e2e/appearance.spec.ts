import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { exerciseAppearance } from "./helpers/appearance";
import { exerciseThemePanel } from "./helpers/display-settings";
import { openThemePanel } from "./helpers/quiet-chrome";

/** The footer's theme chip, which names the current choice ("Theme: Dark"). */
const themeChip = (page: Page) =>
  page.getByRole("button", { name: /^Theme:/u });

/** Opens the footer's theme menu and picks a choice by its label. */
const chooseTheme = async (page: Page, choice: string) => {
  await themeChip(page).click();
  await page.getByRole("menuitemradio", { name: choice, exact: true }).click();
};

const signIn = async (page: Page, name: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(`${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

test("customizes palettes, density, and motion independently @webkit-desktop @webkit-mobile", async ({
  page,
}, testInfo) => {
  await signIn(page, "Appearance planner");
  await exerciseThemePanel(page, testInfo);
});

test("preserves an underlying form and applies another tab's palette and density @webkit-desktop @webkit-mobile", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in/development");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Name", { exact: true }).fill("Retained sign-in draft");
  const other = await context.newPage();
  await signIn(other, "Appearance planner");
  const panel = await openThemePanel(other);
  await panel.getByRole("radio", { name: /^Compact/ }).check();
  await panel.getByRole("radio", { name: /Modern Neutral/ }).check();
  await expect(page.locator("html")).toHaveAttribute("data-palette", "neutral");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Retained sign-in draft",
  );
  const canvas = await page
    .locator("html")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await expect(
    page.locator('meta[name="theme-color"][media="all"]'),
  ).toHaveAttribute("content", canvas);
  await other.close();
});

test("chooses the palette and the add button's seal from Appearance's tiles, kept across a reload @webkit-mobile", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await signIn(page, "Seal planner");
  const phone = testInfo.project.name.endsWith("mobile");
  const html = page.locator("html");
  const openAppearance = async () => {
    await page.goto("/events?settings=appearance");
    return page.getByRole("dialog", { name: "Settings" });
  };
  let settings = await openAppearance();
  const palette = settings.getByRole("group", { name: "Palette", exact: true });
  const seal = settings.getByRole("group", { name: "Button", exact: true });

  // The palettes are miniatures of the app, each in its own palette.
  await expect(palette.getByRole("radio")).toHaveCount(3);
  await expect(
    palette.getByRole("radio", { name: "Ink & Paper", exact: true }),
  ).toBeChecked();
  const grounds = await palette
    .locator(".palette-miniature")
    .evaluateAll((miniatures) =>
      miniatures.map((element) => getComputedStyle(element).backgroundColor),
    );
  expect(new Set(grounds).size).toBe(3);
  await palette.getByRole("radio", { name: "Celadon", exact: true }).check();
  await expect(html).toHaveAttribute("data-palette", "celadon");

  // The shapes: Circle, Round until another is chosen; a shape's styles
  // open from its tile's corner, and the choice closes the pop-up.
  await expect(
    seal.getByRole("radio", { name: "Circle, Round", exact: true }),
  ).toBeChecked();
  await seal.getByRole("radio", { name: "Diamond, Rounded" }).check();
  await expect(html).toHaveAttribute("data-seal", "diamond");
  await seal.getByRole("button", { name: "Heart styles", exact: true }).click();
  const styles = page.getByRole("dialog", { name: "Heart", exact: true });
  await expect(
    styles.getByRole("button", { name: "Plump", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: testInfo.outputPath("heart-styles.png") });
  await styles.getByRole("button", { name: "Geometric", exact: true }).click();
  await expect(styles).toHaveCount(0);
  await expect(settings).toBeVisible();
  await expect(
    seal.getByRole("button", { name: "Heart styles", exact: true }),
  ).toBeFocused();
  await expect(
    seal.getByRole("radio", { name: "Heart, Geometric", exact: true }),
  ).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath("appearance.png") });

  // A reload keeps both, and the shape keeps its style while another is
  // chosen and back.
  await page.reload();
  settings = page.getByRole("dialog", { name: "Settings" });
  await expect(html).toHaveAttribute("data-palette", "celadon");
  await expect(html).toHaveAttribute("data-seal", "heart");
  await expect(html).toHaveAttribute("data-seal-heart", "geometric");
  await expect(
    seal.getByRole("radio", { name: "Heart, Geometric", exact: true }),
  ).toBeChecked();
  await seal.getByRole("radio", { name: "Square, Soft", exact: true }).check();
  await seal.getByRole("radio", { name: "Heart, Geometric" }).check();
  await expect(html).toHaveAttribute("data-seal-heart", "geometric");

  // On a phone the add button wears the choice in the palette's accent.
  if (phone) {
    await settings
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    const button = page.locator(".add-seal");
    await expect(button).toHaveAttribute("data-seal", "heart-geometric");
    const top = await button
      .locator("stop")
      .first()
      .evaluate((stop) => getComputedStyle(stop).stopColor);
    expect(top).toBe("rgb(63, 130, 114)");
    await page.screenshot({ path: testInfo.outputPath("seal.png") });
  }
});

for (const appearance of ["light", "dark"] as const) {
  test(`keeps the Event journey readable in ${appearance} appearance @webkit-desktop @webkit-mobile`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({
      colorScheme: appearance,
      reducedMotion: "reduce",
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await page.goto("/sign-in/development");
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute(
      "content",
      "light dark",
    );
    await expect(
      page.getByRole("button", { name: "Continue", exact: true }),
    ).toBeEnabled();
    const canvas = await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).backgroundColor);
    await expect(
      page.locator('meta[name="theme-color"][media="all"]'),
    ).toHaveAttribute("content", canvas);
    await page.getByLabel("Name", { exact: true }).fill("Event planner");
    await page
      .getByLabel("Email")
      .fill(`appearance-${randomUUID()}@example.test`);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await exerciseAppearance(page, testInfo, appearance);
    expect(errors).toEqual([]);
  });
}

test("applies a saved appearance before application JavaScript loads @webkit-desktop @webkit-mobile", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("chronelle.appearance", "dark");
    localStorage.setItem("chronelle.palette", "celadon");
    localStorage.setItem("chronelle.density", "compact");
    localStorage.setItem("chronelle.motion", "reduced");
  });
  await page.route(/\/_next\/static\/.*\.js(?:\?|$)/, (route) => route.abort());
  await page.goto("/sign-in/development");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  // The footer's theme menu is in the server markup, before any script.
  await expect(themeChip(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-palette", "celadon");
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});

test("synchronizes the theme menu across tabs @webkit-desktop @webkit-mobile", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in/development");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  const other = await context.newPage();
  await other.goto("/sign-in/development");
  await expect(
    other.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await chooseTheme(page, "Light");
  await expect(themeChip(other)).toHaveText("Theme: Light");
  await chooseTheme(page, "Dark");
  await expect(other.locator("html")).toHaveCSS("color-scheme", "dark");
  await chooseTheme(other, "System");
  await expect(themeChip(page)).toHaveText("Theme: System");
  await other.close();
});

test("falls back from invalid storage and allows a page-only override when writes fail @webkit-desktop @webkit-mobile", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.addInitScript(() => {
    localStorage.setItem("chronelle.appearance", "unsupported");
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "chronelle.appearance") throw new Error("Storage blocked");
      setItem.call(this, key, value);
    };
  });
  await page.goto("/sign-in/development");
  await expect(
    page.getByRole("button", { name: "Continue", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
  await chooseTheme(page, "Dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveCSS("color-scheme", "light");
});
