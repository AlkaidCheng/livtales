import type { BrowserContext, Page } from "@playwright/test";

/**
 * Keeps live changes from a page or a browser, so a change saved elsewhere
 * is learned only when a save is refused, as while the connection is down.
 */
export async function withoutLiveChanges(
  target: Page | BrowserContext,
): Promise<void> {
  await target.route(/\/api\/live(?:[/?]|$)/u, (route) => route.abort());
}
