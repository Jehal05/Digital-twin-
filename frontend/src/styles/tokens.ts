/**
 * Design tokens, mirrored in src/styles/index.css (the test in src/test/tokens.test.ts fails if they drift apart
 * or if a text/background pair drops below WCAG AA contrast).
 */
export const color = {
  ink: "#10203f",          // primary text
  inkMuted: "#44536f",     // secondary text
  surface: "#f3f6fc",      // effective colour of a glass card
  surfaceDim: "#e1e9f7",   // effective colour of nested panels
  brand: "#2a58c8",        // buttons, links (white text on top)
  brandSoft: "#dbe6fb",
  low: "#0f7a4f", lowBg: "#d9f3e6",
  moderate: "#8a5a00", moderateBg: "#fbefcb",
  high: "#b3322f", highBg: "#fadcda",
  barLow: "#22b573", barMid: "#f2c230", barHigh: "#e5534b",
  white: "#ffffff",
} as const;

export const radius = { card: "24px", inner: "16px", pill: "999px" } as const;

/** Pairs that must stay readable. [foreground, background, minimum contrast ratio] */
export const contrastPairs: ReadonlyArray<readonly [keyof typeof color, keyof typeof color, number]> = [
  ["ink", "surface", 7], ["ink", "surfaceDim", 7], ["inkMuted", "surface", 4.5], ["inkMuted", "surfaceDim", 4.5],
  ["white", "brand", 4.5], ["brand", "surface", 4.5], ["ink", "brandSoft", 7],
  ["low", "lowBg", 4.5], ["moderate", "moderateBg", 4.5], ["high", "highBg", 4.5],
];
