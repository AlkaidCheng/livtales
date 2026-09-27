"use client";

import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import {
  inSwipeEdge,
  motionReduced,
  type SwipeNeighbours,
  swipeAxis,
  swipeBelongsElsewhere,
  swipeEasing,
  swipeHoldMs,
  swipeOffset,
  swipeRefused,
  swipeSettleMs,
  swipeStep,
} from "../../lib/tab-swipe";

/** A tab a swipe can reach: its key, and what a tap on it does. */
export interface SwipeTab {
  readonly key: string;
  readonly open: () => void;
}

/** A finger or pen on the content, from its press until it lets go. */
interface Press {
  readonly pointerId: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  /** Set once the press is a swipe; a press that goes down is dropped. */
  axis: "x" | null;
  dx: number;
  dy: number;
  /** Where the content sits, with the rubber band past the ends. */
  offset: number;
}

/** A click this long after a swipe is the swipe's own and never reaches the content. */
const swipeClickMs = 500;

/**
 * The event's content under its strip, which a sideways swipe on a touch
 * screen moves to the neighbouring tab: left for the next, right for the
 * previous, in the order of `tabs`, the strip's own. A finger or pen
 * swipes; a mouse never does. The content follows the finger; let go past
 * the commit distance, it slides out while the neighbour, opened as a tap
 * on its tab would open it, slides in. Short of that, or past the first or
 * last tab, where it gives only a little, it springs back; with reduced
 * motion the tab changes without the slide. A press that moves mostly
 * down stays the page's scroll, and `lib/tab-swipe.ts` holds where a swipe
 * never starts. `disabled` holds swipes off altogether.
 */
export function EventSwipe({
  tabs,
  current,
  disabled = false,
  children,
}: {
  readonly tabs: readonly SwipeTab[];
  /** The key of the tab shown; null when it is not among `tabs`. */
  readonly current: string | null;
  readonly disabled?: boolean;
  readonly children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const leavingLayer = useRef<HTMLDivElement>(null);
  const latest = useRef({ tabs, current, disabled });
  latest.current = { tabs, current, disabled };
  const press = useRef<Press | null>(null);
  const stopListening = useRef<(() => void) | null>(null);
  const settling = useRef<readonly Animation[]>([]);
  const clicksHeldUntil = useRef(0);

  function place(): SwipeNeighbours & { readonly index: number } {
    const { tabs, current } = latest.current;
    const index =
      current === null ? -1 : tabs.findIndex((tab) => tab.key === current);
    return {
      index,
      hasPrevious: index > 0,
      hasNext: index >= 0 && index < tabs.length - 1,
    };
  }

  function settled() {
    settling.current = [];
    leavingLayer.current?.replaceChildren();
    surface.current?.removeAttribute("data-swiping");
  }

  /** Ends a slide still running, so the next press starts from rest. */
  function settleNow() {
    const running = settling.current;
    if (running.length === 0) return;
    for (const animation of running) animation.cancel();
    settled();
  }

  function run(animations: readonly Animation[]) {
    settling.current = animations;
    let left = animations.length;
    const onEnd = () => {
      left -= 1;
      if (left === 0 && settling.current === animations) settled();
    };
    for (const animation of animations) {
      animation.onfinish = onEnd;
      animation.oncancel = onEnd;
    }
  }

  /**
   * Lets the content go from `from`: to the neighbour `step` names, or back
   * in place for 0. The leaving content is a still copy of the tab that
   * was shown, so the neighbour renders only once it is opened.
   */
  function release(from: number, step: -1 | 0 | 1) {
    const content = track.current;
    const layer = leavingLayer.current;
    if (content === null || layer === null) return;
    content.style.transform = "";
    const target =
      step === 0 ? undefined : latest.current.tabs[place().index + step];
    const animate = !motionReduced() && typeof content.animate === "function";
    const timing = { duration: swipeSettleMs, easing: swipeEasing };
    if (target === undefined) {
      if (animate && from !== 0)
        run([
          content.animate(
            [{ transform: `translateX(${from}px)` }, { transform: "none" }],
            timing,
          ),
        ]);
      else settled();
      return;
    }
    if (!animate) {
      target.open();
      settled();
      return;
    }
    const width = document.documentElement.clientWidth;
    const leaving = content.cloneNode(true) as HTMLElement;
    for (const node of leaving.querySelectorAll("[id], [name]")) {
      node.removeAttribute("id");
      node.removeAttribute("name");
    }
    layer.replaceChildren(leaving);
    flushSync(target.open);
    run([
      leaving.animate(
        [
          { transform: `translateX(${from}px)` },
          { transform: `translateX(${-step * width}px)` },
        ],
        { ...timing, fill: "forwards" },
      ),
      content.animate(
        [
          { transform: `translateX(${from + step * width}px)` },
          { transform: "none" },
        ],
        timing,
      ),
    ]);
  }

  function end(commit: boolean) {
    const ended = press.current;
    press.current = null;
    stopListening.current?.();
    stopListening.current = null;
    if (ended === null || ended.axis === null) return;
    clicksHeldUntil.current = performance.now() + swipeClickMs;
    release(ended.offset, commit ? swipeStep(ended.dx, place()) : 0);
  }

  function listen(pointerId: number) {
    const move = (event: PointerEvent) => {
      const current = press.current;
      if (current === null || event.pointerId !== pointerId) return;
      current.dx = event.clientX - current.x;
      current.dy = event.clientY - current.y;
      if (current.axis === null) {
        const held = event.timeStamp - current.time > swipeHoldMs;
        const axis = swipeAxis(current.dx, current.dy);
        if (held || axis === "y" || (axis === "x" && swipeRefused(document)))
          end(false);
        if (axis !== "x" || press.current === null) return;
        current.axis = "x";
        clicksHeldUntil.current = Number.POSITIVE_INFINITY;
        surface.current?.setAttribute("data-swiping", "");
      }
      const content = track.current;
      if (content === null) return;
      current.offset = swipeOffset(current.dx, place(), content.clientWidth);
      content.style.transform = `translateX(${current.offset}px)`;
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === pointerId) end(true);
    };
    const cancel = (event: PointerEvent) => {
      if (event.pointerId === pointerId) end(false);
    };
    // A second finger is a pinch, not a swipe.
    const down = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) end(false);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("pointerdown", down);
    stopListening.current = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("pointerdown", down);
    };
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    clicksHeldUntil.current = 0;
    settleNow();
    const element = surface.current;
    if (
      element === null ||
      press.current !== null ||
      latest.current.disabled ||
      (event.pointerType !== "touch" && event.pointerType !== "pen") ||
      !event.isPrimary ||
      event.button !== 0 ||
      event.defaultPrevented ||
      !(event.target instanceof Element) ||
      place().index < 0
    )
      return;
    const visible = window.visualViewport;
    if (
      inSwipeEdge(
        event.clientX,
        visible?.offsetLeft ?? 0,
        visible?.width ?? document.documentElement.clientWidth,
      ) ||
      swipeRefused(document) ||
      swipeBelongsElsewhere(event.target, element)
    )
      return;
    press.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      time: event.timeStamp,
      axis: null,
      dx: 0,
      dy: 0,
      offset: 0,
    };
    listen(event.pointerId);
  }

  function onClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (performance.now() > clicksHeldUntil.current) return;
    clicksHeldUntil.current = 0;
    event.preventDefault();
    event.stopPropagation();
  }

  // Inside content that scrolls (a list in its own scroller that has no
  // room to move sideways), the browser would take a sideways drag for
  // itself and end the press; holding the touch moves that lean across
  // keeps them the swipe's. A move that leans down is left to scroll, and
  // two fingers to pinch. React listens to touch moves passively, so the
  // listener is the element's own. Unmounting ends a press or a slide.
  useEffect(() => {
    const element = surface.current;
    if (element === null) return;
    const hold = (event: TouchEvent) => {
      const current = press.current;
      if (current === null || !event.cancelable || event.touches.length > 1)
        return;
      if (current.axis === "x" || Math.abs(current.dx) > Math.abs(current.dy))
        event.preventDefault();
    };
    element.addEventListener("touchmove", hold, { passive: false });
    return () => {
      element.removeEventListener("touchmove", hold);
      stopListening.current?.();
      for (const animation of settling.current) animation.cancel();
    };
  }, []);

  return (
    <div
      className="event-swipe"
      onClickCapture={onClickCapture}
      onPointerDown={onPointerDown}
      ref={surface}
    >
      <div
        aria-hidden="true"
        className="event-swipe-leaving"
        inert
        ref={leavingLayer}
      />
      <div className="event-swipe-track" ref={track}>
        {children}
      </div>
    </div>
  );
}
