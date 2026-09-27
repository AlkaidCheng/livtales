/** The widths at which a picker's panel opens as a sheet from the bottom. */
export const sheetQuery = "(max-width: 560px)";

/**
 * Shows a picker's panel modally over whatever holds its button (a dialog
 * included) and places it: next to the button on a wide screen, below it
 * when the panel fits there and else on the roomier side, lined up with
 * the button's `align` edge and keeping to it as the panel's content
 * shrinks. The panel is as wide as the button and at least `minWidth`, or,
 * with `fitContent`, as wide as its content when that is wider. On a
 * narrow screen the stylesheet makes it a sheet instead.
 */
export function openPickerPanel(
  panel: HTMLDialogElement,
  button: HTMLElement,
  options: {
    readonly align: "start" | "end";
    readonly minWidth: number;
    readonly maxHeight: number;
    readonly fitContent?: boolean;
  },
): void {
  if (!panel.open) panel.showModal?.();
  const place = panel.style;
  for (const property of [
    "left",
    "top",
    "bottom",
    "width",
    "min-width",
    "max-width",
    "max-height",
  ])
    place.removeProperty(property);
  const sheet =
    typeof window.matchMedia === "function" &&
    window.matchMedia(sheetQuery).matches;
  if (sheet) return;
  const rect = button.getBoundingClientRect();
  const room = window.innerWidth - 24;
  let width = Math.min(Math.max(rect.width, options.minWidth), room);
  if (options.fitContent === true) {
    place.minWidth = `${width}px`;
    place.maxWidth = `${room}px`;
    place.width = "max-content";
    width = panel.getBoundingClientRect().width || width;
  }
  const below = window.innerHeight - rect.bottom - 18;
  const above = rect.top - 18;
  const downward = below >= 320 || below >= above;
  const left = options.align === "end" ? rect.right - width : rect.left;
  place.left = `${Math.max(12, Math.min(left, window.innerWidth - width - 12))}px`;
  if (options.fitContent !== true) place.width = `${width}px`;
  place.maxHeight = `${Math.min(options.maxHeight, downward ? below : above)}px`;
  if (downward) place.top = `${rect.bottom + 6}px`;
  else place.bottom = `${window.innerHeight - rect.top + 6}px`;
}

/**
 * Scrolls a list, and only the list, so the row shows: into the middle
 * when `center`, else by the least distance, keeping clear of `top`
 * pixels at the list's top (a label that sticks there).
 */
export function revealRow(
  list: HTMLElement | null,
  row: Element | null,
  { center = false, top = 0 }: { center?: boolean; top?: number } = {},
): void {
  if (list === null || !(row instanceof HTMLElement)) return;
  const start = row.offsetTop;
  const end = start + row.offsetHeight;
  if (center)
    list.scrollTop = start - (list.clientHeight - row.offsetHeight) / 2;
  else if (start - top < list.scrollTop) list.scrollTop = start - top;
  else if (end > list.scrollTop + list.clientHeight)
    list.scrollTop = end - list.clientHeight;
}
