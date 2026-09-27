// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TimeZonePicker } from "../components/time-zone-picker";

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

/** The picker under its label, keeping each choice as a field would. */
function Field({
  initial = null,
  onChange = () => {},
}: {
  readonly initial?: string | null;
  readonly onChange?: (zone: string | null) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <label htmlFor="zone">Time zone</label>
      <TimeZonePicker
        hourCycle="h23"
        id="zone"
        onChange={(zone) => {
          setValue(zone);
          onChange(zone);
        }}
        value={value}
      />
    </>
  );
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("combobox", { name: "Time zone" }));
  return screen.getByRole("dialog", { name: "Time zone" });
};

describe("TimeZonePicker", () => {
  it("names the chosen zone with its offset, and opens on it", async () => {
    const user = userEvent.setup();
    render(<Field initial="Europe/Paris" />);
    const button = screen.getByRole("combobox", { name: "Time zone" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveTextContent(/^ParisUTC\+0[12]:00$/);
    const picker = await open(user);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const search = within(picker).getByRole("combobox", {
      name: "Search time zones",
    });
    expect(search).toHaveFocus();
    const paris = within(picker).getByRole("option", { name: /^Paris/ });
    expect(paris).toHaveAttribute("aria-selected", "true");
    expect(paris).toHaveClass("is-chosen");
    expect(search).toHaveAttribute("aria-activedescendant", paris.id);
    expect(paris).toHaveTextContent(/France · Central European Time/);
  });

  it("marks a zone chosen under its other name on the one row that lists it", async () => {
    const user = userEvent.setup();
    const listed = Intl.supportedValuesOf("timeZone");
    const stored = listed.includes("Asia/Calcutta")
      ? "Asia/Kolkata"
      : "Asia/Calcutta";
    render(<Field initial={stored} />);
    expect(
      screen.getByRole("combobox", { name: "Time zone" }),
    ).toHaveTextContent(/^KolkataUTC\+05:30$/);
    const picker = await open(user);
    const rows = within(picker).getAllByRole("option", { name: /^Kolkata/ });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveClass("is-chosen");
  });

  it("lists the device's zone first, then every zone by region", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const picker = await open(user);
    const groups = within(picker).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("aria-label"))).toEqual(
      expect.arrayContaining(["Suggested", "Americas", "Asia", "Europe"]),
    );
    expect(groups[0]).toHaveAccessibleName("Suggested");
    const [device] = within(groups[0] as HTMLElement).getAllByRole("option");
    expect(device).toHaveTextContent(/^Device time zone/);
    expect(device).toHaveAttribute("aria-selected", "true");
  });

  it("moves through the matches with the arrow keys and chooses with Enter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    const picker = await open(user);
    await user.keyboard("+9");
    const options = within(picker).getAllByRole("option");
    expect(options.length).toBeGreaterThan(3);
    for (const option of options) expect(option).toHaveTextContent("UTC+09:00");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(/^\d+ time zones$/)).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    await user.keyboard("{Enter}");
    expect(onChange).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0]?.[0]).toBe(
      options[1]?.id.replace(/^.*-option-/, ""),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveFocus();
  });

  it("says when nothing matches, and closes on Escape without a choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const outer = vi.fn();
    render(
      // biome-ignore lint/a11y/noStaticElementInteractions: a listener standing in for a dialog that holds the field
      <div onKeyDown={outer}>
        <Field onChange={onChange} />
      </div>,
    );
    const picker = await open(user);
    await user.keyboard("zzqx");
    expect(within(picker).queryAllByRole("option")).toEqual([]);
    expect(picker).toHaveTextContent(
      "No time zone matches “zzqx”. Try a city, a country, or an offset such as +8.",
    );
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(outer.mock.calls.map(([event]) => event.key)).not.toContain(
      "Escape",
    );
    expect(screen.getByRole("combobox", { name: "Time zone" })).toHaveFocus();
  });

  it("leaves Enter to a composition in progress", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Field onChange={onChange} />);
    const picker = await open(user);
    const search = within(picker).getByRole("combobox", {
      name: "Search time zones",
    });
    fireEvent.change(search, { target: { value: "东京" } });
    fireEvent.keyDown(search, { key: "Enter", isComposing: true });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("Asia/Tokyo");
  });

  it("closes on a click outside the list", async () => {
    const user = userEvent.setup();
    render(<Field />);
    const picker = await open(user);
    await user.click(picker);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
