// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PaletteTiles, SealTiles } from "../components/appearance-tiles";
import { displayChoices, displayStorageKey } from "../lib/display-preferences";

beforeEach(() => {
  vi.stubGlobal("localStorage", window.sessionStorage);
  for (const method of ["showModal", "close"] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
  }
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.unstubAllGlobals();
  for (const key of Object.keys(displayChoices))
    delete document.documentElement.dataset[key];
});

describe("the Appearance tiles", () => {
  it("chooses a palette from its miniature", async () => {
    const user = userEvent.setup();
    render(
      <>
        <span id="palette">Palette</span>
        <PaletteTiles aria-labelledby="palette" />
      </>,
    );
    const group = screen.getByRole("group", { name: "Palette" });
    expect(
      within(group).getByRole("radio", { name: "Ink & Paper" }),
    ).toBeChecked();
    await user.click(
      within(group).getByRole("radio", { name: "Modern Neutral" }),
    );
    expect(document.documentElement).toHaveAttribute("data-palette", "neutral");
    expect(window.localStorage.getItem(displayStorageKey("palette"))).toBe(
      "neutral",
    );
  });

  it("keeps each shape's style, so a shape comes back as it was left", async () => {
    const user = userEvent.setup();
    render(
      <>
        <span id="seal">Button</span>
        <SealTiles aria-labelledby="seal" />
      </>,
    );
    const group = screen.getByRole("group", { name: "Button" });
    expect(
      within(group).getByRole("radio", { name: "Circle, Round" }),
    ).toBeChecked();

    const opener = within(group).getByRole("button", { name: "Heart styles" });
    await user.click(opener);
    const styles = screen.getByRole("dialog", { name: "Heart" });
    const plump = within(styles).getByRole("button", {
      name: "Plump",
      pressed: true,
    });
    expect(plump).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(
      within(styles).getByRole("button", { name: "Geometric", pressed: false }),
    ).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
    expect(
      within(group).getByRole("radio", { name: "Heart, Geometric" }),
    ).toBeChecked();

    await user.click(
      within(group).getByRole("radio", { name: "Circle, Round" }),
    );
    expect(document.documentElement).toHaveAttribute("data-seal", "circle");
    await user.click(
      within(group).getByRole("radio", { name: "Heart, Geometric" }),
    );
    expect(document.documentElement).toHaveAttribute("data-seal", "heart");
    expect(window.localStorage.getItem(displayStorageKey("sealHeart"))).toBe(
      "geometric",
    );

    // Escape closes the styles alone and changes nothing.
    await user.click(
      within(group).getByRole("button", { name: "Square styles" }),
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.documentElement).toHaveAttribute("data-seal", "heart");
    expect(
      window.localStorage.getItem(displayStorageKey("sealSquare")),
    ).toBeNull();
  });
});
