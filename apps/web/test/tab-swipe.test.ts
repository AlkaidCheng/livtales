// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  inSwipeEdge,
  motionReduced,
  swipeAxis,
  swipeBelongsElsewhere,
  swipeCommitPx,
  swipeEdgePx,
  swipeLockPx,
  swipeOffset,
  swipeRefused,
  swipeStep,
} from "../lib/tab-swipe";

const both = { hasPrevious: true, hasNext: true };
const first = { hasPrevious: false, hasNext: true };
const last = { hasPrevious: true, hasNext: false };
const alone = { hasPrevious: false, hasNext: false };

afterEach(() => {
  document.body.innerHTML = "";
  document.body.className = "";
  delete document.documentElement.dataset.motion;
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("where a swipe may start", () => {
  it("keeps the bands at both sides of the visible area for the system", () => {
    expect(inSwipeEdge(0, 0, 390)).toBe(true);
    expect(inSwipeEdge(swipeEdgePx - 1, 0, 390)).toBe(true);
    expect(inSwipeEdge(swipeEdgePx, 0, 390)).toBe(false);
    expect(inSwipeEdge(195, 0, 390)).toBe(false);
    expect(inSwipeEdge(390 - swipeEdgePx, 0, 390)).toBe(false);
    expect(inSwipeEdge(390 - swipeEdgePx + 1, 0, 390)).toBe(true);
  });

  it("measures the bands from a visible area scrolled sideways by a pinch", () => {
    expect(inSwipeEdge(105, 100, 200)).toBe(true);
    expect(inSwipeEdge(150, 100, 200)).toBe(false);
    expect(inSwipeEdge(295, 100, 200)).toBe(true);
  });
});

describe("the axis a press takes", () => {
  it("waits for the lock distance before deciding", () => {
    expect(swipeAxis(0, 0)).toBeNull();
    expect(swipeAxis(swipeLockPx - 1, 0)).toBeNull();
    expect(swipeAxis(6, 6)).toBeNull();
    expect(swipeAxis(swipeLockPx, 0)).toBe("x");
    expect(swipeAxis(-swipeLockPx, 0)).toBe("x");
  });

  it("goes across within 45 degrees of level and down otherwise", () => {
    expect(swipeAxis(12, 8)).toBe("x");
    expect(swipeAxis(-12, -11)).toBe("x");
    expect(swipeAxis(10, 10)).toBe("y");
    expect(swipeAxis(4, -12)).toBe("y");
    expect(swipeAxis(0, 30)).toBe("y");
  });
});

describe("where the content sits during a drag", () => {
  it("follows the finger toward a neighbour", () => {
    expect(swipeOffset(-80, both, 390)).toBe(-80);
    expect(swipeOffset(80, both, 390)).toBe(80);
    expect(swipeOffset(-80, first, 390)).toBe(-80);
    expect(swipeOffset(80, last, 390)).toBe(80);
  });

  it("gives a little past the first or last tab, less the further it is pulled", () => {
    let before = 0;
    for (const dx of [20, 60, 120, 240, 600, 2000]) {
      const offset = swipeOffset(dx, first, 390);
      expect(offset).toBeGreaterThan(before);
      expect(offset).toBeLessThan(dx);
      expect(offset).toBeLessThan(390 * 0.2);
      expect(swipeOffset(-dx, last, 390)).toBeCloseTo(-offset, 6);
      before = offset;
    }
  });

  it("gives on both sides for a lone tab", () => {
    expect(swipeOffset(100, alone, 390)).toBeGreaterThan(0);
    expect(swipeOffset(100, alone, 390)).toBeLessThan(100);
    expect(swipeOffset(-100, alone, 390)).toBeLessThan(0);
    expect(swipeOffset(-100, alone, 390)).toBeGreaterThan(-100);
  });
});

describe("the tab a release lands on", () => {
  it("moves one tab once the swipe passes the commit distance", () => {
    expect(swipeStep(-swipeCommitPx, both)).toBe(1);
    expect(swipeStep(-200, both)).toBe(1);
    expect(swipeStep(swipeCommitPx, both)).toBe(-1);
    expect(swipeStep(200, both)).toBe(-1);
  });

  it("springs back short of the commit distance", () => {
    expect(swipeStep(-(swipeCommitPx - 1), both)).toBe(0);
    expect(swipeStep(swipeCommitPx - 1, both)).toBe(0);
    expect(swipeStep(0, both)).toBe(0);
  });

  it("springs back past the first and the last tab", () => {
    expect(swipeStep(200, first)).toBe(0);
    expect(swipeStep(-200, first)).toBe(1);
    expect(swipeStep(-200, last)).toBe(0);
    expect(swipeStep(200, last)).toBe(-1);
    expect(swipeStep(200, alone)).toBe(0);
    expect(swipeStep(-200, alone)).toBe(0);
  });
});

/** Gives an element a scroll width wider than its box. */
function widen(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, "scrollWidth", { value: scrollWidth });
  Object.defineProperty(element, "clientWidth", { value: clientWidth });
}

describe("presses that belong to something else", () => {
  function mount(inner: string) {
    document.body.innerHTML = `<div id="surface">${inner}</div>`;
    const surface = document.getElementById("surface");
    if (surface === null) throw new Error("No surface.");
    return surface;
  }
  const target = (id: string) => {
    const element = document.getElementById(id);
    if (element === null) throw new Error(`No #${id}.`);
    return element;
  };

  it("lets a press on plain content swipe", () => {
    const surface = mount(
      '<section><p id="row">Confirm the venue <button id="more">More</button></p></section>',
    );
    expect(swipeBelongsElsewhere(target("row"), surface)).toBe(false);
    expect(swipeBelongsElsewhere(target("more"), surface)).toBe(false);
  });

  it("leaves fields to their caret and value", () => {
    const surface = mount(
      '<label><input id="text"><input id="done" type="checkbox"><input id="range" type="range"><textarea id="note"></textarea><select id="pick"></select><div id="rich" contenteditable="true"><b id="bold">b</b></div></label>',
    );
    for (const id of ["text", "range", "note", "pick", "rich", "bold"])
      expect(swipeBelongsElsewhere(target(id), surface)).toBe(true);
    expect(swipeBelongsElsewhere(target("done"), surface)).toBe(false);
  });

  it("leaves an element that turns its own content with a swipe", () => {
    const surface = mount(
      '<div data-own-swipe><article><p id="day">Day one</p></article></div>',
    );
    expect(swipeBelongsElsewhere(target("day"), surface)).toBe(true);
  });

  it("leaves grips and handles that refuse the browser's touch gestures", () => {
    const surface = mount(
      '<p id="row"><span id="grip"><svg id="mark"></svg></span></p>',
    );
    // jsdom drops `touch-action`, so the grip's computed style says it.
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
      const style = computed(element);
      if (element.id !== "grip") return style;
      return Object.assign(Object.create(style), {
        getPropertyValue: (name: string) =>
          name === "touch-action" ? "none" : style.getPropertyValue(name),
      });
    });
    expect(swipeBelongsElsewhere(target("grip"), surface)).toBe(true);
    expect(swipeBelongsElsewhere(target("mark"), surface)).toBe(true);
    expect(swipeBelongsElsewhere(target("row"), surface)).toBe(false);
  });

  it("leaves content that scrolls sideways, and only while it has room to", () => {
    const surface = mount(
      '<div id="week" style="overflow-x: auto"><ol><li id="day">Mon</li></ol></div><div id="list" style="overflow-x: auto"><p id="task">Task</p></div><p id="title" style="overflow: hidden">A long title</p>',
    );
    widen(target("week"), 1260, 360);
    widen(target("list"), 360, 360);
    widen(target("title"), 900, 360);
    expect(swipeBelongsElsewhere(target("day"), surface)).toBe(true);
    expect(swipeBelongsElsewhere(target("task"), surface)).toBe(false);
    expect(swipeBelongsElsewhere(target("title"), surface)).toBe(false);
  });

  it("looks no further than the surface", () => {
    document.body.innerHTML =
      '<div id="outer" style="overflow-x: auto"><div id="surface"><p id="row">Row</p></div></div>';
    widen(target("outer"), 2000, 400);
    expect(swipeBelongsElsewhere(target("row"), target("surface"))).toBe(false);
  });
});

describe("a page busy with something else", () => {
  const shown = () =>
    vi
      .spyOn(Element.prototype, "getClientRects")
      .mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);

  it("swipes when nothing else is going on", () => {
    document.body.innerHTML = '<main><p id="row">Row</p></main>';
    expect(swipeRefused(document)).toBe(false);
  });

  it("refuses while a dialog, sheet, or menu is open", () => {
    for (const overlay of [
      "<dialog open>Edit</dialog>",
      '<div role="dialog">Chip</div>',
      '<div role="alertdialog">Sure?</div>',
      '<div role="menu"><button role="menuitem">Edit</button></div>',
      '<ul role="listbox"><li role="option">Chen</li></ul>',
    ]) {
      document.body.innerHTML = `<main>${overlay}</main>`;
      const rects = shown();
      expect(swipeRefused(document)).toBe(true);
      rects.mockRestore();
    }
  });

  it("swipes past a closed dialog and a menu that is not shown", () => {
    document.body.innerHTML =
      '<dialog>Edit</dialog><div role="menu" hidden></div>';
    expect(swipeRefused(document)).toBe(false);
  });

  it("refuses while text is selected", () => {
    document.body.innerHTML = '<p id="text">Pick these words</p>';
    const text = document.getElementById("text")?.firstChild;
    if (!text) throw new Error("No text.");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 4);
    window.getSelection()?.addRange(range);
    expect(swipeRefused(document)).toBe(true);
  });

  it("refuses while a field has focus, not a checkbox or button", () => {
    document.body.innerHTML =
      '<input id="name"><input id="done" type="checkbox"><button id="save">Save</button>';
    document.getElementById("name")?.focus();
    expect(swipeRefused(document)).toBe(true);
    document.getElementById("done")?.focus();
    expect(swipeRefused(document)).toBe(false);
    document.getElementById("save")?.focus();
    expect(swipeRefused(document)).toBe(false);
  });

  it("refuses while a row is being dragged", () => {
    document.body.classList.add("is-dragging-row");
    expect(swipeRefused(document)).toBe(true);
  });
});

describe("reduced motion", () => {
  const media = (reduce: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: reduce && query === "(prefers-reduced-motion: reduce)",
      })),
    );

  it("follows the system's preference", () => {
    media(false);
    expect(motionReduced()).toBe(false);
    media(true);
    expect(motionReduced()).toBe(true);
  });

  it("follows the app's Motion setting", () => {
    media(false);
    document.documentElement.dataset.motion = "reduced";
    expect(motionReduced()).toBe(true);
  });
});
