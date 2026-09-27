import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "./fixtures";
import { expectHorizontalReflow } from "./helpers/page-navigation";

const signIn = async (page: Page, name: string) => {
  await page.goto("/sign-in/development");
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Email").fill(`${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/events$/u);
};

/** The kinds the add menu offers, in their usual order. */
const kinds = ["Task", "Schedule item", "Expense", "Reminder", "Note"];

/** The kind each view lists, which its add menu puts nearest the button. */
const leads: Record<string, string> = {
  todos: "Task",
  calendar: "Schedule item",
  timeline: "Schedule item",
  itinerary: "Schedule item",
  expenses: "Expense",
  reminders: "Reminder",
  notes: "Note",
  overview: "Task",
};

/** Each kind's editor, as the dialog it opens is named. */
const editors: [string, string][] = [
  ["Task", "Add task"],
  ["Schedule item", "Add schedule item"],
  ["Expense", "Add expense"],
  ["Reminder", "Add reminder"],
  ["Note", "Note"],
];

test("adds to an event from the phone's add button, the view's kind nearest @webkit-mobile", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.endsWith("mobile"),
    "The add button is the phone's; a wider screen keeps the header's controls.",
  );
  await signIn(page, "Seal planner");

  // Events: the button is New event at the bottom right, clear of the
  // corner, and the header offers no other.
  const newEvent = page.getByRole("button", { name: "New event", exact: true });
  await expect(newEvent).toHaveCount(1);
  await expect(newEvent).toHaveAttribute("aria-haspopup", "dialog");
  await expect(newEvent).toBeInViewport();
  const viewport = page.viewportSize();
  const box = await newEvent.boundingBox();
  if (viewport === null || box === null) throw new Error("No layout.");
  expect(box.width).toBeGreaterThanOrEqual(56);
  expect(box.height).toBeGreaterThanOrEqual(56);
  const right = viewport.width - box.x - box.width;
  expect(right).toBeGreaterThanOrEqual(16);
  expect(right).toBeLessThanOrEqual(20);
  expect(viewport.height - box.y - box.height).toBeGreaterThanOrEqual(16);
  await page.screenshot({ path: testInfo.outputPath("events.png") });

  // It opens New event and hides while the dialog is open.
  await newEvent.click();
  const create = page.getByRole("dialog", { name: "Create an event" });
  await expect(create.getByLabel("Event name")).toBeFocused();
  await expect(newEvent).toBeHidden();
  await page.keyboard.insertText("Autumn gathering");
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Autumn gathering" }),
  ).toBeVisible();
  const eventPath = new URL(page.url()).pathname;

  // On the event it asks what to add: the current view's kind sits
  // nearest the button and takes focus, the others above it in their
  // usual order; Escape closes the menu back on the button.
  const seal = page.getByRole("button", {
    name: "Add to Autumn gathering",
    exact: true,
  });
  const menu = page.getByRole("menu", { name: "Add to Autumn gathering" });
  for (const [view, lead] of Object.entries(leads)) {
    await page.goto(`${eventPath}?view=${view}`);
    await expect(seal).toHaveAttribute("aria-expanded", "false");
    await seal.click();
    await expect(seal).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitem")).toHaveText(
      [lead, ...kinds.filter((kind) => kind !== lead)].reverse(),
    );
    await expect(
      menu.getByRole("menuitem", { name: lead, exact: true }),
    ).toBeFocused();
    if (view === "todos")
      await page.screenshot({ path: testInfo.outputPath("menu.png") });
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(seal).toBeFocused();
  }

  // The page keeps room at its foot for the button.
  const room = await page
    .locator(".event-workspace")
    .evaluate((main) =>
      Number.parseFloat(getComputedStyle(main).paddingBottom),
    );
  const sealBox = await seal.boundingBox();
  if (sealBox === null) throw new Error("The button has no box.");
  expect(room).toBeGreaterThan(viewport.height - sealBox.y);

  // Each choice opens the editor that kind uses; closing it returns focus
  // to the button, which hides while the editor is open.
  await page.goto(`${eventPath}?view=overview`);
  for (const [kind, title] of editors) {
    await seal.click();
    await menu.getByRole("menuitem", { name: kind, exact: true }).click();
    const editor = page.getByRole("dialog", { name: title, exact: true });
    await expect(editor).toBeVisible();
    await expect(menu).toHaveCount(0);
    await expect(seal).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(editor).toHaveCount(0);
    await expect(seal).toBeFocused();
  }

  // The keyboard reaches the menu too: the arrow keys walk the pills, and
  // a task added from it joins the event's To-dos.
  await page.goto(`${eventPath}?view=todos`);
  await seal.focus();
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("menuitem", { name: "Task" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(
    menu.getByRole("menuitem", { name: "Schedule item" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const task = page.getByRole("dialog", { name: "Add task", exact: true });
  await expect(task.getByLabel("Task", { exact: true })).toBeFocused();
  await page.keyboard.insertText("Order the cake");
  await task.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(task).toHaveCount(0);
  await expect(page.getByText("Order the cake", { exact: true })).toBeVisible();
  await expect(seal).toBeFocused();
  await expectHorizontalReflow(page);
});

test("adds a task and a person from the phone's add button on Tasks and People", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.endsWith("mobile"),
    "The add button is the phone's; a wider screen keeps the header's controls.",
  );
  await signIn(page, "Seal planner");
  await page.goto("/tasks");
  const newTask = page.getByRole("button", { name: "New task", exact: true });
  await expect(newTask).toHaveCount(1);
  await expect(newTask).toBeInViewport();
  await newTask.click();
  const task = page.getByRole("dialog", { name: "Add task", exact: true });
  await expect(task).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(task).toHaveCount(0);
  await expect(newTask).toBeFocused();

  await page.goto("/people");
  const newPerson = page.getByRole("button", {
    name: "New person",
    exact: true,
  });
  await expect(newPerson).toHaveCount(1);
  await newPerson.click();
  const person = page.getByRole("dialog", { name: "Add person", exact: true });
  await expect(person).toBeVisible();
  await person
    .getByRole("button", { name: "Close person editor", exact: true })
    .click();
  await expect(person).toHaveCount(0);
  await expect(newPerson).toBeFocused();
});

test("keeps the header's add controls and no add button on a wide screen", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.endsWith("mobile"),
    "A phone trades the header's controls for the add button.",
  );
  await signIn(page, "Wide planner");
  await expect(
    page.locator(".quiet-tools").getByRole("button", { name: "New event" }),
  ).toBeVisible();
  await expect(page.locator(".add-seal")).toHaveCount(0);
  await page.goto("/tasks");
  await expect(
    page.locator(".page-heading").getByRole("button", { name: "New task" }),
  ).toBeVisible();
  await expect(page.locator(".add-seal")).toHaveCount(0);
});
