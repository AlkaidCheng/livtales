// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { fitMenu } from "../lib/menu-placement";

const anchor = (top: number, height = 36) =>
  ({ top, bottom: top + height }) as DOMRect;

const viewportHeight = (height: number) =>
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: height,
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fitMenu", () => {
  it("opens below when the list fits under the control", () => {
    viewportHeight(720);
    expect(fitMenu(anchor(100), 300, 4)).toEqual({
      side: "below",
      maxHeight: null,
    });
  });

  it("opens above when the list only fits over the control", () => {
    viewportHeight(720);
    expect(fitMenu(anchor(500), 300, 4)).toEqual({
      side: "above",
      maxHeight: null,
    });
  });

  it("caps the list to the roomier side when it fits neither", () => {
    viewportHeight(720);
    // Below: 720 - 8 - 340 - 4 = 368; above: 300 - 4 - 8 = 288.
    expect(fitMenu(anchor(300, 40), 400, 4)).toEqual({
      side: "below",
      maxHeight: 368,
    });
    // Below: 720 - 8 - 540 - 4 = 168; above: 500 - 4 - 8 = 488.
    expect(fitMenu(anchor(500, 40), 600, 4)).toEqual({
      side: "above",
      maxHeight: 488,
    });
  });

  it("keeps clear of the rail on a phone", () => {
    viewportHeight(851);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    // Below: 851 - 96 - 536 - 4 = 215, short of 300; above: 500 - 12 - 52 = 436.
    expect(fitMenu(anchor(500), 300, 4)).toEqual({
      side: "above",
      maxHeight: null,
    });
  });

  it("keeps clear of the app bar on a phone when the list opens above", () => {
    viewportHeight(851);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({ matches: true })),
    );
    // Below: 851 - 96 - 336 - 4 = 415; above: 300 - 4 - 8 - 52 = 236, so a
    // list of 500 opens below, capped to its room there.
    expect(fitMenu(anchor(300), 500, 4)).toEqual({
      side: "below",
      maxHeight: 415,
    });
    // Above: 600 - 4 - 8 - 52 = 536, so a list of 540, which would fit
    // there without the bar, opens above capped to the room under it.
    expect(fitMenu(anchor(600), 540, 4)).toEqual({
      side: "above",
      maxHeight: 536,
    });
  });
});
