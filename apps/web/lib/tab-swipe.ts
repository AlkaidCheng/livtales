/**
 * A sideways swipe between tabs, as rules apart from the page: where a
 * swipe may start, when a press becomes one, how far the content follows,
 * and which tab a release lands on.
 */

/** Pixels at either side of the screen where a swipe never starts: they belong to Back and the drawer. */
export const swipeEdgePx = 20;
/** Pixels a press travels before it is taken as a swipe or a scroll. */
export const swipeLockPx = 10;
/** Pixels a release must have travelled sideways to change the tab. */
export const swipeCommitPx = 50;
/** How long a press may rest before moving: longer, and it is a long press. */
export const swipeHoldMs = 350;
/** How long the content takes to slide to the neighbour or spring back. */
export const swipeSettleMs = 260;
/** The slide's easing: quick to leave, gentle to settle. */
export const swipeEasing = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** How far past the first or last tab the content may give, as a share of its width. */
const rubberLimit = 0.2;
/** How much the content gives per pixel of drag as the pull starts past the end. */
const rubberSlope = 0.35;

/** Whether the tab has a neighbour on either side. */
export interface SwipeNeighbours {
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

/**
 * Whether a press at `x` lands in the band at either side of the visible
 * area that the system's Back gesture and the drawer keep; `left` and
 * `width` are the visible area's, in the same coordinates as `x`.
 */
export function inSwipeEdge(x: number, left: number, width: number): boolean {
  return x - left < swipeEdgePx || left + width - x < swipeEdgePx;
}

/**
 * The axis a press takes once it has travelled the lock distance: across
 * when it moves more across than down (within 45 degrees of level), down
 * otherwise. Null while it is still inside the lock distance.
 */
export function swipeAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.hypot(dx, dy) < swipeLockPx) return null;
  return Math.abs(dx) > Math.abs(dy) ? "x" : "y";
}

/**
 * Where the content sits for a drag of `dx` on content `width` wide: with
 * the finger toward a neighbour, and past the first or last tab a little,
 * giving less the further it is pulled and never more than a fifth of the
 * width.
 */
export function swipeOffset(
  dx: number,
  neighbours: SwipeNeighbours,
  width: number,
): number {
  const beyond =
    (dx > 0 && !neighbours.hasPrevious) || (dx < 0 && !neighbours.hasNext);
  if (!beyond) return dx;
  const limit = Math.max(width, 1) * rubberLimit;
  const pulled = Math.abs(dx) * rubberSlope;
  return Math.sign(dx) * limit * (1 - limit / (limit + pulled));
}

/**
 * The tab a release at `dx` moves to: 1 for the next (a swipe left), -1
 * for the previous (a swipe right), 0 to spring back when the swipe fell
 * short or there is no tab on that side.
 */
export function swipeStep(dx: number, neighbours: SwipeNeighbours): -1 | 0 | 1 {
  if (dx <= -swipeCommitPx && neighbours.hasNext) return 1;
  if (dx >= swipeCommitPx && neighbours.hasPrevious) return -1;
  return 0;
}

/** Controls a drag works inside: it moves a caret, a selection, or a value. */
const fieldSelector = [
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"])',
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
].join(", ");

/** What is open over the page: a dialog, a sheet, a menu, or a list of choices. */
const overlaySelector =
  'dialog[open], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * Whether a press on `target` belongs to something inside `surface` rather
 * than to a swipe: a field; an element that turns its own content with a
 * swipe (marked `data-own-swipe`); a grip or handle that refuses the
 * browser's touch gestures; or content that scrolls sideways itself, such
 * as a wide grid or table.
 */
export function swipeBelongsElsewhere(
  target: Element,
  surface: Element,
): boolean {
  const view = surface.ownerDocument.defaultView;
  for (
    let element: Element | null = target;
    element !== null && element !== surface;
    element = element.parentElement
  ) {
    if (
      element.matches(fieldSelector) ||
      element.hasAttribute("data-own-swipe")
    )
      return true;
    const style = view?.getComputedStyle(element);
    if (style === undefined) continue;
    if (style.getPropertyValue("touch-action") === "none") return true;
    if (
      (style.overflowX === "auto" || style.overflowX === "scroll") &&
      element.scrollWidth > element.clientWidth + 1
    )
      return true;
  }
  return false;
}

/** Whether motion is reduced, by the system or by the app's Motion setting. */
export function motionReduced(): boolean {
  return (
    document.documentElement.dataset.motion === "reduced" ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  );
}

/**
 * Whether the page is busy with something a swipe must not disturb: an
 * open dialog, sheet, or menu; selected text; a field being typed in; or a
 * row being dragged.
 */
export function swipeRefused(document: Document): boolean {
  const selection = document.getSelection();
  if (selection !== null && !selection.isCollapsed) return true;
  if (document.activeElement?.matches(fieldSelector)) return true;
  if (document.body.classList.contains("is-dragging-row")) return true;
  return Array.from(document.querySelectorAll(overlaySelector)).some(
    (overlay) => overlay.getClientRects().length > 0,
  );
}
