/**
 * The styles each shape of the phone's add button (its seal) is drawn in,
 * the first being the shape's default.
 */
export const sealStyles = {
  circle: ["round", "scalloped"],
  square: ["soft", "ticket"],
  diamond: ["rounded", "gem"],
  heart: ["plump", "geometric"],
} as const;

export const displayChoices = {
  appearance: ["system", "light", "dark"],
  palette: ["paper", "celadon", "neutral"],
  density: ["comfortable", "compact"],
  motion: ["system", "reduced"],
  /** The desktop sidebar, shown or collapsed to the content's edge. */
  sidebar: ["open", "collapsed"],
  /** The add button's shape; each shape keeps its own style below. */
  seal: ["circle", "square", "diamond", "heart"],
  sealCircle: sealStyles.circle,
  sealSquare: sealStyles.square,
  sealDiamond: sealStyles.diamond,
  sealHeart: sealStyles.heart,
} as const;

export type DisplayPreference = keyof typeof displayChoices;
export type DisplayValue<K extends DisplayPreference> =
  (typeof displayChoices)[K][number];

const displayStorageKeyPrefix = "chronelle.";

export function displayStorageKey(name: DisplayPreference) {
  return `${displayStorageKeyPrefix}${name}`;
}

export function parseDisplayPreference<K extends DisplayPreference>(
  name: K,
  value: unknown,
): DisplayValue<K> {
  const choices: readonly unknown[] = displayChoices[name];
  return choices.includes(value)
    ? (value as DisplayValue<K>)
    : displayChoices[name][0];
}

export const palettes = [
  { id: "paper" },
  { id: "celadon" },
  { id: "neutral" },
] as const satisfies readonly { id: DisplayValue<"palette"> }[];

export type SealShape = DisplayValue<"seal">;
export type SealStyle<S extends SealShape = SealShape> =
  (typeof sealStyles)[S][number];
/** A seal as drawn: its shape and that shape's style, as `heart-plump`. */
export type Seal = { [S in SealShape]: `${S}-${SealStyle<S>}` }[SealShape];

/** A shape drawn in one of its styles. */
export function sealOf<S extends SealShape>(
  shape: S,
  style: SealStyle<S>,
): Seal {
  return `${shape}-${style}` as Seal;
}

/** The preference that keeps each shape's style. */
export const sealStylePreference = {
  circle: "sealCircle",
  square: "sealSquare",
  diamond: "sealDiamond",
  heart: "sealHeart",
} as const satisfies Record<SealShape, DisplayPreference>;

export const displayBootstrap = `for(const [name,choices] of Object.entries(${JSON.stringify(displayChoices)})){try{const value=window.localStorage.getItem(${JSON.stringify(displayStorageKeyPrefix)}+name);if(choices.includes(value))document.documentElement.dataset[name]=value;}catch{}}`;
