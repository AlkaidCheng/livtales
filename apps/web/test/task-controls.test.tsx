// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  activeFilterCount,
  type TaskFilterChoices,
  type TaskFilterOffer,
  TaskFilterControl,
  TaskSortControl,
  useTaskChips,
  useTaskFilterOptions,
} from "../features/tasks/task-controls";
import { ActiveChips } from "../features/events/view-options";
import {
  defaultEventTaskChoices,
  type EventTaskChoices,
} from "../lib/task-choices";

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

const offer: TaskFilterOffer = {
  people: [
    { id: "mira", name: "Mira Chen" },
    { id: "leo", name: "Leo Park" },
    { id: "ana", name: "Ana Lima" },
  ],
  labels: [{ id: "urgent", name: "Urgent" }],
  me: true,
  none: true,
};

/** The Filter over an Event's task choices, and the chips they make. */
function Filter({
  initial = defaultEventTaskChoices,
  given = offer,
  onChoices,
}: {
  readonly initial?: EventTaskChoices;
  readonly given?: TaskFilterOffer;
  readonly onChoices?: (choices: EventTaskChoices) => void;
}) {
  const [choices, setChoices] = useState(initial);
  const change = (changes: Partial<EventTaskChoices>) =>
    setChoices((current) => {
      const next = { ...current, ...changes };
      onChoices?.(next);
      return next;
    });
  const options = useTaskFilterOptions(choices, given, change);
  const chips = useTaskChips(
    choices,
    {
      person: (id) => given.people.find((person) => person.id === id)?.name,
      label: (id) => given.labels.find((label) => label.id === id)?.name,
    },
    change,
  );
  return (
    <>
      <TaskFilterControl
        filters={choices}
        onClear={() => change(defaultEventTaskChoices)}
        options={options}
      />
      <ActiveChips
        chips={chips}
        onClearAll={() => change(defaultEventTaskChoices)}
      />
    </>
  );
}

describe("task controls", () => {
  it("reads Sort until another order is chosen, then names it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <TaskSortControl onChange={onChange} sort="manual" />,
    );
    const button = screen.getByRole("button", { name: "Sort" });
    expect(button).not.toHaveClass("is-active");
    await user.click(button);
    expect(
      screen
        .getAllByRole("menuitemradio")
        .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["Manual", "true"],
      ["By due", "false"],
      ["By name", "false"],
      ["By updated", "false"],
    ]);
    await user.click(screen.getByRole("menuitemradio", { name: "By name" }));
    expect(onChange).toHaveBeenCalledWith("name");
    rerender(<TaskSortControl onChange={onChange} sort="name" />);
    expect(screen.getByRole("button", { name: "Sort: By name" })).toHaveClass(
      "is-active",
    );
  });

  it("counts what differs from its default, Show among them", () => {
    const filters: TaskFilterChoices = {
      show: "all",
      assignee: "",
      label: "urgent",
      timed: false,
      overdue: true,
    };
    expect(activeFilterCount(filters)).toBe(3);
    expect(
      activeFilterCount({ show: "open", assignee: "", label: "", from: "any" }),
    ).toBe(1);
  });

  it("chooses Show, then a person from a searchable list, and clears the filters", async () => {
    const user = userEvent.setup();
    const onChoices = vi.fn();
    render(<Filter onChoices={onChoices} />);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    const panel = screen.getByRole("dialog", { name: "Filter" });
    // Show is three choices side by side; one applies at once.
    const show = within(panel).getByRole("radiogroup", { name: "Show" });
    expect(
      within(show)
        .getAllByRole("radio")
        .map((radio) => [
          radio.textContent,
          radio.getAttribute("aria-checked"),
        ]),
    ).toEqual([
      ["Open", "true"],
      ["All", "false"],
      ["Finished", "false"],
    ]);
    await user.click(within(show).getByRole("radio", { name: "Finished" }));
    expect(onChoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ show: "done" }),
    );
    // Assigned to reads its value and opens its list in place.
    await user.click(
      within(panel).getByRole("button", { name: /Assigned to/ }),
    );
    const people = within(panel).getByRole("listbox", { name: "Assigned to" });
    expect(
      within(people)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual([
      "Anyone",
      "You",
      "Unassigned",
      "MCMira Chen",
      "LPLeo Park",
      "ALAna Lima",
    ]);
    const search = within(panel).getByRole("searchbox", {
      name: "Find a person",
    });
    expect(search).toHaveFocus();
    // Typing part of a name keeps the people who match, and nothing fixed.
    await user.type(search, "le");
    expect(
      within(people)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["LPLeo Park"]);
    await user.type(search, "x");
    expect(within(panel).getByText("No one by that name")).toBeVisible();
    await user.clear(search);
    await user.type(search, "mira");
    await user.click(within(people).getByRole("option", { name: /Mira/ }));
    // Back on the rows, Assigned to names Mira, and the chips say so.
    expect(
      within(panel).getByRole("button", { name: /Assigned to/ }),
    ).toHaveTextContent("Mira Chen");
    expect(
      screen.getByRole("button", { name: "Assigned to Mira Chen, remove" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Finished only, remove" })).toBe(
      screen.getAllByRole("button", { name: /, remove$/ })[0],
    );
    await user.click(
      within(panel).getByRole("switch", { name: "Overdue only" }),
    );
    expect(onChoices).toHaveBeenLastCalledWith(
      expect.objectContaining({ assignee: "mira", overdue: true }),
    );
    await user.click(
      within(panel).getByRole("button", { name: "Clear filters" }),
    );
    expect(onChoices).toHaveBeenLastCalledWith(defaultEventTaskChoices);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.queryByRole("list", { name: "Choices on this view" }),
    ).toBeNull();
  });

  it("goes back from a list with Escape and sets a chip's choice back alone", async () => {
    const user = userEvent.setup();
    render(
      <Filter
        initial={{
          ...defaultEventTaskChoices,
          label: "urgent",
          sort: "name",
        }}
      />,
    );
    expect(
      screen
        .getAllByRole("button", { name: /, remove$/ })
        .map((chip) => chip.textContent),
    ).toEqual(["Label: Urgent×", "Sorted by name×"]);
    await user.click(screen.getByRole("button", { name: "Filter: 1 filter" }));
    const panel = screen.getByRole("dialog", { name: "Filter" });
    await user.click(within(panel).getByRole("button", { name: /^Label/ }));
    expect(
      within(panel).getByRole("option", { name: "Urgent" }),
    ).toHaveAttribute("aria-selected", "true");
    await user.keyboard("{Escape}");
    expect(within(panel).getByRole("button", { name: /^Label/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Sorted by name, remove" }),
    );
    expect(
      screen
        .getAllByRole("button", { name: /, remove$/ })
        .map((chip) => chip.textContent),
    ).toEqual(["Label: Urgent×"]);
    // One chip has no Clear all beside it.
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it("leaves out You, Unassigned, No label, and the switches a container does not offer", async () => {
    const user = userEvent.setup();
    function Plain() {
      const [choices, setChoices] = useState<TaskFilterChoices>({
        show: "open",
        assignee: "",
        label: "",
      });
      const options = useTaskFilterOptions(
        choices,
        { people: [], labels: [], me: false, none: false },
        (changes) => setChoices((current) => ({ ...current, ...changes })),
      );
      return (
        <TaskFilterControl
          filters={choices}
          onClear={vi.fn()}
          options={options}
        />
      );
    }
    render(<Plain />);
    await user.click(screen.getByRole("button", { name: "Filter" }));
    const panel = screen.getByRole("dialog", { name: "Filter" });
    expect(within(panel).queryByRole("switch")).toBeNull();
    await user.click(
      within(panel).getByRole("button", { name: /Assigned to/ }),
    );
    expect(
      within(panel)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Anyone"]);
  });
});
