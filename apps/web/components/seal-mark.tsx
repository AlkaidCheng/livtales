"use client";

import { type ReactNode, useId } from "react";

import type { Seal } from "../lib/display-preferences";

/** The paint an outline is drawn with. */
interface Paint {
  readonly className?: string;
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  readonly filter?: string;
}

type Outline = (paint: Paint) => ReactNode;

const path =
  (d: string): Outline =>
  (paint) => <path d={d} {...paint} />;

/**
 * Each seal's outline on a 64-unit square, and for the round and square
 * shapes the line just inside it. A seal without its own line gets an even
 * inset line instead: a wide light stroke, then a narrower stroke in the
 * fill, both clipped to the outline.
 */
const seals: Record<
  Seal,
  { readonly outline: Outline; readonly ring?: ReactNode }
> = {
  "circle-round": {
    outline: (paint) => <circle cx="32" cy="32" r="30" {...paint} />,
    ring: <circle cx="32" cy="32" r="26.6" />,
  },
  "circle-scalloped": {
    outline: path(
      "M32 4.5A9.18 9.18 0 0 1 43.93 7.22A9.18 9.18 0 0 1 53.5 14.85A9.18 9.18 0 0 1 58.81 25.88A9.18 9.18 0 0 1 58.81 38.12A9.18 9.18 0 0 1 53.5 49.15A9.18 9.18 0 0 1 43.93 56.78A9.18 9.18 0 0 1 32 59.5A9.18 9.18 0 0 1 20.07 56.78A9.18 9.18 0 0 1 10.5 49.15A9.18 9.18 0 0 1 5.19 38.12A9.18 9.18 0 0 1 5.19 25.88A9.18 9.18 0 0 1 10.5 14.85A9.18 9.18 0 0 1 20.07 7.22A9.18 9.18 0 0 1 32 4.5Z",
    ),
    ring: <circle cx="32" cy="32" r="22.5" />,
  },
  "square-soft": {
    outline: (paint) => (
      <rect x="3" y="3" width="58" height="58" rx="17" {...paint} />
    ),
    ring: <rect x="6.4" y="6.4" width="51.2" height="51.2" rx="13.6" />,
  },
  "square-ticket": {
    outline: path(
      "M11.5 3L52.5 3A8.5 8.5 0 0 0 61 11.5L61 52.5A8.5 8.5 0 0 0 52.5 61L11.5 61A8.5 8.5 0 0 0 3 52.5L3 11.5A8.5 8.5 0 0 0 11.5 3Z",
    ),
  },
  "diamond-rounded": {
    outline: (paint) => (
      <rect
        x="9"
        y="9"
        width="46"
        height="46"
        rx="9"
        transform="rotate(45 32 32)"
        {...paint}
      />
    ),
    ring: (
      <rect
        x="12.4"
        y="12.4"
        width="39.2"
        height="39.2"
        rx="6"
        transform="rotate(45 32 32)"
      />
    ),
  },
  "diamond-gem": {
    outline: path(
      "M16.27 11.92Q19 9 23 9L41 9Q45 9 47.73 11.92L56.27 21.08Q59 24 56.51 27.13L35.73 53.3Q32 58 28.27 53.3L7.49 27.13Q5 24 7.73 21.08Z",
    ),
  },
  "heart-plump": {
    outline: path(
      "M32 52.5C27 50.5 5 39 5 22C5 12 12 5.5 20.5 5.5C25.8 5.5 29.8 8.5 32 12.5C34.2 8.5 38.2 5.5 43.5 5.5C52 5.5 59 12 59 22C59 39 37 50.5 32 52.5Z",
    ),
  },
  "heart-geometric": {
    outline: path(
      "M36.95 53.00L55.33 34.62A16.50 16.50 0 0 0 55.33 11.28A16.50 16.50 0 0 0 32.00 11.28A16.50 16.50 0 0 0 8.67 11.28A16.50 16.50 0 0 0 8.67 34.62L27.05 53.00A7 7 0 0 0 36.95 53.00Z",
    ),
  },
};

/**
 * The add button's seal, drawn at the size its container gives it: the
 * accent's gradient from `--seal-top` to `--seal-bottom` on a faint paper
 * grain, a light line just inside the edge, and the plus in `--seal-ink`,
 * upright and placed where the shape's weight is. It is decoration; the
 * control that holds it carries the name.
 */
export function SealMark({ seal }: { readonly seal: Seal }) {
  const id = `seal${useId().replace(/[^\w-]/gu, "")}`;
  const { outline, ring } = seals[seal];
  const fill = `url(#${id}-fill)`;
  return (
    <span className="seal-mark" data-seal={seal}>
      <svg aria-hidden="true" className="seal-shape" viewBox="0 0 64 64">
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--seal-top)" }} />
            <stop offset="1" style={{ stopColor: "var(--seal-bottom)" }} />
          </linearGradient>
          <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={2}
              seed={4}
            />
            <feColorMatrix values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.22 0" />
            <feComposite in2="SourceGraphic" operator="in" />
          </filter>
          {ring === undefined ? (
            <clipPath id={`${id}-clip`}>{outline({})}</clipPath>
          ) : null}
        </defs>
        {outline({ fill })}
        {ring === undefined ? (
          <g clipPath={`url(#${id}-clip)`} fill="none">
            {outline({ className: "seal-line", strokeWidth: 8.3 })}
            {outline({ stroke: fill, strokeWidth: 5.3 })}
          </g>
        ) : null}
        {outline({ fill: "#000", filter: `url(#${id}-grain)` })}
        {ring === undefined ? null : (
          <g className="seal-line" fill="none" strokeWidth={1.5}>
            {ring}
          </g>
        )}
      </svg>
      <svg aria-hidden="true" className="seal-glyph" viewBox="0 0 24 24">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </span>
  );
}
