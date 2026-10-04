import type { EventComponentView, EventPage } from "@livtales/schemas";

/** Move an existing item before an anchor, or to the end when the anchor is null. */
function reorder<T extends { id: string }>(
  items: T[],
  id: string,
  beforeId: string | null,
): T[] {
  const item = items.find((candidate) => candidate.id === id);
  if (!item || id === beforeId) return items;
  if (beforeId !== null && !items.some((item) => item.id === beforeId))
    return items;
  const remaining = items.filter((candidate) => candidate.id !== id);
  const index =
    beforeId === null
      ? remaining.length
      : remaining.findIndex((candidate) => candidate.id === beforeId);
  remaining.splice(index, 0, item);
  return remaining.every((item, index) => item === items[index])
    ? items
    : remaining;
}

/**
 * The event's pages in an account's order, each page as it is; a page the
 * order does not name follows in the event's order.
 */
export function pagesInOrder(
  pages: readonly EventPage[],
  order: readonly string[] | undefined,
): readonly EventPage[] {
  if (order === undefined) return pages;
  const ordered = order.flatMap((id) => {
    const page = pages.find((candidate) => candidate.id === id);
    return page === undefined ? [] : [page];
  });
  return [...ordered, ...pages.filter((page) => !order.includes(page.id))];
}

/** Layout moves preserve component identities and never touch canonical records. */
export function moveEventComponent(
  pages: EventPage[],
  componentId: string,
  targetPageId: string,
  beforeId: string | null,
): EventPage[] {
  const source = pages.find((page) =>
    page.components.some((component) => component.id === componentId),
  );
  const target = pages.find((page) => page.id === targetPageId);
  const component = source?.components.find((item) => item.id === componentId);
  if (!source || !target || !component) return pages;
  if (source === target) {
    const components = reorder(source.components, componentId, beforeId);
    return components === source.components
      ? pages
      : pages.map((page) => (page === source ? { ...page, components } : page));
  }
  if (target.components.length >= 20) return pages;
  const index =
    beforeId === null
      ? target.components.length
      : target.components.findIndex((item) => item.id === beforeId);
  if (index < 0) return pages;
  return pages.map((page) => {
    if (page === source)
      return {
        ...page,
        components: page.components.filter((item) => item !== component),
      };
    if (page === target)
      return {
        ...page,
        components: [
          ...page.components.slice(0, index),
          component,
          ...page.components.slice(index),
        ],
      };
    return page;
  });
}

/** The pages without one page; the same pages when it is not among them. */
export function removeEventPage(
  pages: EventPage[],
  pageId: string,
): EventPage[] {
  return pages.some((page) => page.id === pageId)
    ? pages.filter((page) => page.id !== pageId)
    : pages;
}

/** The pages without one component; the same pages when no page holds it. */
export function removeEventComponent(
  pages: EventPage[],
  componentId: string,
): EventPage[] {
  const holder = pages.find((page) =>
    page.components.some((component) => component.id === componentId),
  );
  if (holder === undefined) return pages;
  return pages.map((page) =>
    page === holder
      ? {
          ...page,
          components: page.components.filter(
            (component) => component.id !== componentId,
          ),
        }
      : page,
  );
}

/** Records the view of one component; the pages are returned unchanged when it already shows it. */
export function setEventComponentView(
  pages: EventPage[],
  componentId: string,
  view: EventComponentView,
): EventPage[] {
  const page = pages.find((page) =>
    page.components.some((component) => component.id === componentId),
  );
  const component = page?.components.find((item) => item.id === componentId);
  if (!page || !component || component.view === view) return pages;
  // A retired kind becomes the kind it renders as once its view is chosen.
  const kind = component.kind;
  return pages.map((item) =>
    item === page
      ? {
          ...item,
          components: item.components.map((entry) =>
            entry === component ? { ...entry, kind, view } : entry,
          ),
        }
      : item,
  );
}
