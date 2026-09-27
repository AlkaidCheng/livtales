// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AddSeal } from "../components/add-seal";
import {
  displayBootstrap,
  displayChoices,
  displayStorageKey,
} from "../lib/display-preferences";

beforeEach(() => {
  vi.stubGlobal("localStorage", window.sessionStorage);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  for (const key of Object.keys(displayChoices))
    delete document.documentElement.dataset[key];
});

const kinds = ["Task", "Schedule item", "Expense", "Reminder", "Note"];

function renderMenu(onSelect = vi.fn()) {
  render(
    <AddSeal
      items={kinds.map((label) => ({
        id: label,
        label,
        icon: null,
        onSelect: () => onSelect(label),
      }))}
      label="Add to Autumn gathering"
      title="Add to this event"
    />,
  );
  return {
    button: screen.getByRole("button", { name: "Add to Autumn gathering" }),
    onSelect,
  };
}

describe("the add button", () => {
  it("adds at once when it has no menu", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<AddSeal label="New event" onAdd={onAdd} />);
    const button = screen.getByRole("button", { name: "New event" });
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    expect(button).not.toHaveAttribute("aria-expanded");
    await user.click(button);
    expect(onAdd).toHaveBeenCalledOnce();
    expect(button).toHaveFocus();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens its menu with the first kind nearest the button and focused", async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    expect(button).toHaveAttribute("aria-expanded", "false");
    await user.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "Add to Autumn gathering" });
    expect(button).toHaveAttribute("aria-controls", menu.id);
    const items = within(menu).getAllByRole("menuitem");
    // The pills rise from the button: the last in reading order sits nearest.
    expect(items.map((item) => item.textContent)).toEqual([...kinds].reverse());
    expect(items.at(-1)).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(
      within(menu).getByRole("menuitem", { name: "Schedule item" }),
    ).toHaveFocus();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(within(menu).getByRole("menuitem", { name: "Note" })).toHaveFocus();
  });

  it("closes on Escape, on the button, and on a choice, with focus back on it", async () => {
    const user = userEvent.setup();
    const { button, onSelect } = renderMenu();
    await user.click(button);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute("aria-expanded", "false");

    await user.click(button);
    await user.click(button);
    expect(screen.queryByRole("menu")).toBeNull();

    await user.click(button);
    await user.click(screen.getByRole("menuitem", { name: "Expense" }));
    expect(onSelect).toHaveBeenCalledWith("Expense");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(button).toHaveFocus();
  });

  it("draws the shape and style the browser keeps", () => {
    window.localStorage.setItem(displayStorageKey("seal"), "diamond");
    window.localStorage.setItem(displayStorageKey("sealDiamond"), "gem");
    new Function(displayBootstrap)();
    const { container } = render(<AddSeal label="New event" onAdd={vi.fn()} />);
    expect(container.querySelector(".add-seal")).toHaveAttribute(
      "data-seal",
      "diamond-gem",
    );
    expect(container.querySelector(".seal-mark")).toHaveAttribute(
      "data-seal",
      "diamond-gem",
    );
  });
});
