// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MenuSelect } from "../components/menu-select";

beforeEach(() => {
  for (const method of ["showModal", "close"] as const) {
    Object.defineProperty(HTMLDialogElement.prototype, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.toggleAttribute("open", method === "showModal");
      },
    });
  }
});

afterEach(cleanup);

const days = [
  { value: "", label: "From language (Sunday)" },
  { value: "1", label: "Monday" },
  { value: "7", label: "Sunday" },
] as const;

function Week({ onChange = () => {} }: { onChange?: (day: string) => void }) {
  const [value, setValue] = useState<string>("");
  return (
    <>
      <label htmlFor="week">Week starts on</label>
      <MenuSelect
        id="week"
        label="Week starts on"
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        options={days}
        value={value}
      />
    </>
  );
}

describe("MenuSelect", () => {
  it("shows the choice and opens a list with it checked and active", async () => {
    const user = userEvent.setup();
    render(<Week />);
    const menu = screen.getByRole("combobox", { name: "Week starts on" });
    expect(menu).toHaveTextContent("From language (Sunday)");
    expect(menu).toHaveAttribute("aria-haspopup", "listbox");
    await user.click(menu);
    expect(menu).toHaveAttribute("aria-expanded", "true");
    const list = screen.getByRole("listbox", { name: "Week starts on" });
    expect(list).toHaveFocus();
    const first = screen.getByRole("option", {
      name: "From language (Sunday)",
    });
    expect(first).toHaveClass("is-chosen");
    expect(first).toHaveAttribute("aria-selected", "true");
    expect(list).toHaveAttribute("aria-activedescendant", first.id);
  });

  it("moves with the arrow keys and a typed letter, and chooses with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Week onChange={onChange} />);
    const menu = screen.getByRole("combobox", { name: "Week starts on" });
    menu.focus();
    await user.keyboard("{ArrowDown}");
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "Monday" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("s");
    expect(screen.getByRole("option", { name: "Sunday" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await user.keyboard("{Home}{Enter}");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(menu);
    await user.keyboard("{End}{Enter}");
    expect(onChange).toHaveBeenCalledWith("7");
    expect(menu).toHaveTextContent("Sunday");
    expect(menu).toHaveFocus();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape without a choice, keeping the key from an enclosing dialog", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const outer = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a listener standing in for a dialog that holds the menu
      <div onKeyDown={outer}>
        <Week onChange={onChange} />
      </div>,
    );
    const menu = screen.getByRole("combobox", { name: "Week starts on" });
    await user.click(menu);
    await user.keyboard("{ArrowDown}{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(outer.mock.calls.map(([event]) => event.key)).not.toContain(
      "Escape",
    );
    expect(menu).toHaveFocus();
  });

  it("chooses an option by a click", async () => {
    const user = userEvent.setup();
    render(<Week />);
    const menu = screen.getByRole("combobox", { name: "Week starts on" });
    await user.click(menu);
    await user.click(screen.getByRole("option", { name: "Monday" }));
    expect(menu).toHaveTextContent("Monday");
  });
});
