// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventStrip } from "../features/events/event-strip";
import { longPressDelayMs } from "../lib/use-long-press";
import { withIntl } from "./intl";

const wrapper = withIntl();

// jsdom has no PointerEvent; the strip reads pointerType, isPrimary, and
// pointerId.
class PointerEventPolyfill extends MouseEvent {
  readonly pointerType: string;
  readonly isPrimary: boolean;
  readonly pointerId: number;
  constructor(
    type: string,
    init: MouseEventInit & {
      pointerType?: string;
      isPrimary?: boolean;
      pointerId?: number;
    } = {},
  ) {
    super(type, init);
    this.pointerType = init.pointerType ?? "mouse";
    this.isPrimary = init.isPrimary ?? true;
    this.pointerId = init.pointerId ?? 1;
  }
}

function renderStrip() {
  const onSelectView = vi.fn();
  const onSelectPage = vi.fn();
  const onManageTabs = vi.fn();
  render(
    <EventStrip
      pages={[{ id: "page-1", name: "Plan", components: [] }]}
      selectedPageId="page-1"
      showingPages={false}
      onSelectPage={onSelectPage}
      canAddPage={false}
      onAddPage={() => undefined}
      views={[
        { id: "overview", label: "Overview" },
        { id: "todos", label: "To-dos" },
      ]}
      activeView="overview"
      onSelectView={onSelectView}
      onManageTabs={onManageTabs}
    />,
    { wrapper },
  );
  return { onSelectView, onSelectPage, onManageTabs };
}

const touch = (x = 40, y = 20) => ({
  button: 0,
  clientX: x,
  clientY: y,
  isPrimary: true,
  pointerId: 1,
  pointerType: "touch",
});

beforeEach(() => {
  vi.stubGlobal("PointerEvent", PointerEventPolyfill);
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the strip's long press", () => {
  it("opens Manage tabs from a touch held on a tab and swallows the click that follows", () => {
    const { onSelectView, onManageTabs } = renderStrip();
    const tab = screen.getByRole("tab", { name: "To-dos" });
    fireEvent.pointerDown(tab, touch());
    act(() => {
      vi.advanceTimersByTime(longPressDelayMs - 1);
    });
    expect(onManageTabs).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onManageTabs).toHaveBeenCalledOnce();
    expect(tab).toHaveFocus();
    fireEvent.pointerUp(tab, touch());
    fireEvent.click(tab);
    expect(onSelectView).not.toHaveBeenCalled();
    // The next tap is a tap again.
    fireEvent.pointerDown(tab, touch());
    fireEvent.pointerUp(tab, touch());
    fireEvent.click(tab);
    expect(onSelectView).toHaveBeenCalledWith("todos");
    expect(onManageTabs).toHaveBeenCalledOnce();
  });

  it("treats a lift before the delay as a tap and a move as a scroll", () => {
    const { onSelectView, onSelectPage, onManageTabs } = renderStrip();
    const tab = screen.getByRole("tab", { name: "To-dos" });
    fireEvent.pointerDown(tab, touch());
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.pointerUp(tab, touch());
    fireEvent.click(tab);
    expect(onSelectView).toHaveBeenCalledWith("todos");
    act(() => {
      vi.advanceTimersByTime(longPressDelayMs);
    });
    expect(onManageTabs).not.toHaveBeenCalled();

    const page = screen.getByRole("button", { name: "Plan" });
    fireEvent.pointerDown(page, touch(40, 20));
    fireEvent.pointerMove(page, touch(40, 60));
    act(() => {
      vi.advanceTimersByTime(longPressDelayMs);
    });
    expect(onManageTabs).not.toHaveBeenCalled();
    expect(onSelectPage).not.toHaveBeenCalled();
  });

  it("keeps holding when another pointer leaves the strip", () => {
    const { onManageTabs } = renderStrip();
    const tab = screen.getByRole("tab", { name: "To-dos" });
    fireEvent.pointerDown(tab, touch());
    // The mouse pointer, reported at its last position, leaves the strip
    // while the finger holds: only the finger's own events count.
    fireEvent.pointerLeave(tab, {
      ...touch(),
      pointerId: 7,
      pointerType: "mouse",
    });
    fireEvent.pointerUp(tab, {
      ...touch(),
      pointerId: 7,
      pointerType: "mouse",
    });
    act(() => {
      vi.advanceTimersByTime(longPressDelayMs);
    });
    expect(onManageTabs).toHaveBeenCalledTimes(1);
  });

  it("leaves a mouse press alone", () => {
    const { onManageTabs } = renderStrip();
    const tab = screen.getByRole("tab", { name: "To-dos" });
    fireEvent.pointerDown(tab, { ...touch(), pointerType: "mouse" });
    act(() => {
      vi.advanceTimersByTime(longPressDelayMs);
    });
    expect(onManageTabs).not.toHaveBeenCalled();
    fireEvent.contextMenu(tab);
  });
});

describe("the strip's fold", () => {
  // jsdom lays nothing out: a tab is 60px wide unless hidden, the chip is
  // as wide as its count reads in a proportional face ("+11" narrower than
  // "+10"), and a part of the strip is as wide as what it holds.
  function widthOf(element: Element): number {
    if (element instanceof HTMLElement && element.hidden) return 0;
    if (element.hasAttribute("data-tab-key")) return 60;
    if (element.hasAttribute("data-strip-chip")) {
      const count = Number(/\+(\d+)/.exec(element.textContent ?? "")?.[1]);
      return count === 10 ? 70 : count === 11 ? 50 : 60;
    }
    if (element.classList.contains("event-strip-bar")) return 1;
    return Array.from(element.children).reduce(
      (total, child) => total + widthOf(child),
      0,
    );
  }

  beforeEach(() => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        return { width: widthOf(this) } as DOMRect;
      },
    );
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(
      function (this: HTMLElement) {
        return this.classList.contains("event-strip") ? 240 : 0;
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("settles where one more fold narrows the chip enough to unfold it again", () => {
    const views = [
      "overview",
      "todos",
      "calendar",
      "timeline",
      "itinerary",
      "expenses",
      "reminders",
      "files",
      "people",
      "notes",
      "sharing",
      "removed-links",
    ] as const;
    render(
      <EventStrip
        pages={[{ id: "page-1", name: "Plan", components: [] }]}
        selectedPageId="page-1"
        showingPages={false}
        onSelectPage={() => undefined}
        canAddPage={false}
        onAddPage={() => undefined}
        views={views.map((id) => ({ id, label: id }))}
        activeView="calendar"
        onSelectView={() => undefined}
      />,
      { wrapper },
    );
    // Ten folded leave no room with the wider "+10" chip, and eleven leave
    // room with the narrower "+11": the strip keeps eleven rather than
    // folding and unfolding the eleventh without end.
    expect(
      screen.getByRole("button", { name: "11 more tabs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "calendar" })).toBeVisible();
  });
});
