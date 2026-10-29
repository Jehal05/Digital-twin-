import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { color, colorDark, contrastPairs } from "../styles/tokens";
import { contrastRatio } from "../lib/contrast";

const css = readFileSync(resolve(__dirname, "../styles/index.css"), "utf8");
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
const block = (start: string) => { const i = css.indexOf(start); return css.slice(i, css.indexOf("}", i)); };
const CSS_NAME: Record<string, string> = { inkMuted: "ink-muted", onStrong: "on-strong" };
const themes = [["light", color, block(":root {")], ["dark", colorDark, block(':root[data-theme="dark"]')]] as const;

describe.each(themes)("%s theme tokens", (_n, palette, cssBlock) => {
  it.each(contrastPairs)("%s on %s meets contrast %s:1", (fg, bg, min) => {
    expect(contrastRatio(palette[fg], palette[bg])).toBeGreaterThanOrEqual(min);
  });

  it("CSS variables match tokens.ts (no drift)", () => {
    for (const [name, hex] of Object.entries(palette)) {
      if (name === "white" || name.startsWith("bar")) continue;
      const m = cssBlock.match(new RegExp(`--color-${CSS_NAME[name] ?? kebab(name)}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m, `missing --color-${CSS_NAME[name] ?? kebab(name)} in the ${_n} block`).not.toBeNull();
      expect(m![1].toLowerCase()).toBe(hex.toLowerCase());
    }
  });
});
