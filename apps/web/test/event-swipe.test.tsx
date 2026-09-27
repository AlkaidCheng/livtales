// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EventSwipe } from "../features/events/event-swipe";

// jsdom has no PointerEvent; the swipe reads pointerType, isPrimary, and
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

function renderSwipe({
  current = "todos",
  disabled = false,
}: { readonly current?: string; readonly disabled?: boolean } = {}) {
  const opened: string[] = [];
  const clicked = vi.fn();
  render(
    <EventSwipe
      current={current}
      disabled={disabled}
      tabs={["plan", "overview", "todos", "calendar"].map((key) => ({
        key,
        open: () => opened.push(key),
      }))}
    >
      <button onClick={clicked} type="button">
        Confirm the venue
      </button>
      <input aria-label="Title" />
    </EventSwipe>,
  );
  const row = screen.getByRole("button", { name: "Confirm the venue" });
  const track = row.parentElement;
  if (track === null) throw new Error("The content has no track.");
  return { opened, clicked, row, track };
}

const pointer = (
  x: number,
  y: number,
  pointerType = "touch",
  pointerId = 7,
) => ({
  bubbles: true,
  button: 0,
  clientX: x,
  clientY: y,
  isPrimary: pointerId === 7,
  pointerId,
  pointerType,
});

/** Presses at `from`, moves to `to` in four steps, and lets go there. */
function drag(
  target: Element,
  from: readonly [number, number],
  to: readonly [number, number],
  pointerType = "touch",
) {
  fireEvent.pointerDown(target, pointer(...from, pointerType));
  for (const step of [1, 2, 3, 4]) {
    const x = from[0] + ((to[0] - from[0]) * step) / 4;
    const y = from[1] + ((to[1] - from[1]) * step) / 4;
    fireEvent.pointerMove(target, pointer(x, y, pointerType));
  }
  fireEvent.pointerUp(target, pointer(...to, pointerType));
}

beforeEach(() => {
  vi.stubGlobal("PointerEvent", PointerEventPolyfill);
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 390,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("swiping between an event's tabs", () => {
  it("opens the next tab on a swipe left and the previous on a swipe right", () => {
    const { opened, row } = renderSwipe();
    drag(row, [300, 200], [160, 210]);
    drag(row, [100, 200], [240, 190]);
    expect(opened).toEqual(["calendar", "overview"]);
  });

  it("moves the content with the finger and lets it go on release", () => {
    const { row, track } = renderSwipe();
    const surface = track.parentElement;
    fireEvent.pointerDown(row, pointer(300, 200));
    fireEvent.pointerMove(row, pointer(290, 200));
    fireEvent.pointerMove(row, pointer(220, 204));
    expect(track.style.transform).toBe("translateX(-80px)");
    expect(surface).toHaveAttribute("data-swiping");
    fireEvent.pointerUp(row, pointer(220, 204));
    expect(track.style.transform).toBe("");
    expect(surface).not.toHaveAttribute("data-swiping");
  });

  it("springs back from a swipe short of the commit distance", () => {
    const { opened, row, track } = renderSwipe();
    drag(row, [200, 200], [160, 200]);
    expect(opened).toEqual([]);
    expect(track.style.transform).toBe("");
  });

  it("gives only a little past the last tab and springs back", () => {
    const { opened, row, track } = renderSwipe({ current: "calendar" });
    fireEvent.pointerDown(row, pointer(300, 200));
    fireEvent.pointerMove(row, pointer(290, 200));
    fireEvent.pointerMove(row, pointer(100, 200));
    const given = Number.parseFloat(
      track.style.transform.replace("translateX(", ""),
    );
    expect(given).toBeLessThan(0);
    expect(given).toBeGreaterThan(-200);
    fireEvent.pointerUp(row, pointer(100, 200));
    expect(opened).toEqual([]);
    expect(track.style.transform).toBe("");
  });

  it("springs back past the first tab", () => {
    const { opened, row } = renderSwipe({ current: "plan" });
    drag(row, [100, 200], [300, 200]);
    expect(opened).toEqual([]);
  });

  it("leaves a drag that goes down to the page's scroll", () => {
    const { opened, row, track } = renderSwipe();
    drag(row, [200, 400], [150, 150]);
    expect(opened).toEqual([]);
    expect(track.style.transform).toBe("");
  });

  it("never swipes for a mouse", () => {
    const { opened, row } = renderSwipe();
    drag(row, [300, 200], [100, 200], "mouse");
    expect(opened).toEqual([]);
  });

  it("swipes for a pen", () => {
    const { opened, row } = renderSwipe();
    drag(row, [300, 200], [100, 200], "pen");
    expect(opened).toEqual(["calendar"]);
  });

  it("never starts at the screen's edges", () => {
    const { opened, row } = renderSwipe();
    drag(row, [10, 200], [250, 200]);
    drag(row, [385, 200], [150, 200]);
    expect(opened).toEqual([]);
  });

  it("never starts on a field", () => {
    const { opened } = renderSwipe();
    drag(screen.getByLabelText("Title"), [300, 200], [100, 200]);
    expect(opened).toEqual([]);
  });

  it("holds off while disabled or away from the tabs", () => {
    const disabled = renderSwipe({ disabled: true });
    drag(disabled.row, [300, 200], [100, 200]);
    expect(disabled.opened).toEqual([]);
    cleanup();
    const elsewhere = renderSwipe({ current: "sharing" });
    drag(elsewhere.row, [300, 200], [100, 200]);
    expect(elsewhere.opened).toEqual([]);
  });

  it("ends when a second finger lands, as a pinch", () => {
    const { opened, row } = renderSwipe();
    fireEvent.pointerDown(row, pointer(300, 200));
    fireEvent.pointerMove(row, pointer(200, 200));
    fireEvent.pointerDown(row, pointer(250, 300, "touch", 8));
    fireEvent.pointerUp(row, pointer(100, 200));
    expect(opened).toEqual([]);
  });

  it("ends a press held still before it moves", () => {
    const { opened, row } = renderSwipe();
    fireEvent.pointerDown(row, pointer(300, 200));
    fireEvent.pointerMove(row, pointer(298, 200));
    // The next move comes long after the press.
    const now = vi.spyOn(Event.prototype, "timeStamp", "get");
    now.mockReturnValue(Number.MAX_SAFE_INTEGER);
    fireEvent.pointerMove(row, pointer(100, 200));
    now.mockRestore();
    fireEvent.pointerUp(row, pointer(100, 200));
    expect(opened).toEqual([]);
  });

  it("swallows the click a swipe leaves behind, not a tap's", () => {
    const { clicked, row } = renderSwipe();
    drag(row, [300, 200], [100, 200]);
    fireEvent.click(row);
    expect(clicked).not.toHaveBeenCalled();
    fireEvent.pointerDown(row, pointer(200, 200));
    fireEvent.pointerUp(row, pointer(200, 200));
    fireEvent.click(row);
    expect(clicked).toHaveBeenCalledTimes(1);
  });
});
