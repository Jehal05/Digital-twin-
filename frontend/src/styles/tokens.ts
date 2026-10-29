/**
 * Design tokens, mirrored in src/styles/index.css (src/test/tokens.test.ts fails if they drift apart or if a
 * text/background pair drops below its WCAG contrast minimum, in BOTH themes).
 */
export const color = {
  ink: "#10203f",          // primary text
  inkMuted: "#44536f",     // secondary text
  surface: "#f3f6fc",      // effective colour of a glass card
  surfaceDim: "#e1e9f7",   // effective colour of nested panels
  card: "#ffffff",         // inputs, rows and chips sitting on a card
  line: "#c9d5ee",         // decorative dividers
  field: "#6f84b2",        // borders of inputs (non-text contrast 3:1)
  focus: "#1d4ed8",
  brand: "#2a58c8",        // buttons, links
  onStrong: "#ffffff",     // text on brand / ink / high backgrounds
  brandSoft: "#dbe6fb",
  low: "#0f7a4f", lowBg: "#d9f3e6",
  moderate: "#8a5a00", moderateBg: "#fbefcb",
  high: "#b3322f", highBg: "#fadcda",
  barLow: "#22b573", barMid: "#f2c230", barHigh: "#e5534b",
  white: "#ffffff",
} as const;

export const colorDark: Record<keyof typeof color, string> = {
  ink: "#e9efff", inkMuted: "#b5c3e3", surface: "#17233f", surfaceDim: "#223458", card: "#1d2d52", line: "#34476f",
  field: "#8396c4", focus: "#9db8ff", brand: "#8fb0ff", onStrong: "#0b1530", brandSoft: "#2a4175",
  low: "#6fe3a8", lowBg: "#133d2c", moderate: "#f6c75a", moderateBg: "#40310a", high: "#ff9d97", highBg: "#4b1d1c",
  barLow: "#22b573", barMid: "#f2c230", barHigh: "#e5534b", white: "#ffffff",
};

export const radius = { card: "24px", inner: "16px", pill: "999px" } as const;

/** Pairs that must stay readable in every theme. [foreground, background, minimum contrast ratio] */
export const contrastPairs: ReadonlyArray<readonly [keyof typeof color, keyof typeof color, number]> = [
  ["ink", "surface", 7], ["ink", "surfaceDim", 7], ["inkMuted", "surface", 4.5], ["inkMuted", "surfaceDim", 4.5],
  ["onStrong", "brand", 4.5], ["brand", "surface", 4.5], ["ink", "brandSoft", 7], ["onStrong", "ink", 7], ["onStrong", "high", 4.5],
  ["low", "lowBg", 4.5], ["moderate", "moderateBg", 4.5], ["high", "highBg", 4.5],
  ["ink", "card", 7], ["inkMuted", "card", 4.5], ["field", "card", 3], ["focus", "surface", 3],
];
