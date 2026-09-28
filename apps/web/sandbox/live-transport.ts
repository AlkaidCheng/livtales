import type { LiveTransport } from "../lib/live/live-transport";

/** The design sandbox has no API to follow, so its pages change only by its own edits. */
export function openLiveTransport(): LiveTransport {
  return { setPages() {}, setActive() {}, close() {} };
}
