import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { color, contrastPairs } from "../styles/tokens";
import { contrastRatio } from "../lib/contrast";

const css = readFileSync(resolve(__dirname, "../styles/index.css"), "utf8");
const kebab = (s: string) => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

describe("design tokens", () => {
  it.each(contrastPairs)("%s on %s meets contrast %s:1", (fg, bg, min) => {
    expect(contrastRatio(color[fg], color[bg])).toBeGreaterThanOrEqual(min);
  });

  it("CSS variables match tokens.ts (no drift)", () => {
    for (const [name, hex] of Object.entries(color)) {
      if (name === "white") continue;
      const m = css.match(new RegExp(`--color-${kebab(name)}:\\s*(#[0-9a-fA-F]{6})`));
      expect(m, `missing --color-${kebab(name)} in index.css`).not.toBeNull();
      expect(m![1].toLowerCase()).toBe(hex.toLowerCase());
    }
  });
});
