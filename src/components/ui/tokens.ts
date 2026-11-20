/**
 * The same design tokens as tokens.css, for places where CSS variables are not available:
 * HTML strings (bot widgets, reports, letters), canvas, charts.
 * tests/ui-tokens.test.ts keeps the two files identical.
 * Name rule: tokens.<group>.<camelCase> is --ui-<group>-<kebab-case> in CSS.
 */
export const tokens = {
  color: {
    paper: "#f6f2ec",
    ink: "#35272c",
    inkSoft: "#76666d",
    accent: "#742b45",
    accentPressed: "#61223a",
    accentRing: "#5b2439",
    accentTint: "#742b4512",
    accentBorder: "#742b4530",
    onAccent: "#fffaf9",
    danger: "#a3261f",
    dangerBorder: "#a3261f55",
    dangerTint: "#a3261f12",
    success: "#3d6b4f",
    divider: "rgba(96, 45, 62, 0.16)",
    fieldFill: "#ffffff60",
    fieldBorder: "#a5899538",
    controlBorder: "#a58995",
    secondaryFill: "#ffffff70",
  },
  radius: {
    field: "14px",
    button: "16px",
    checkbox: "7px",
    panel: "22px",
    surface: "28px",
    pill: "999px",
  },
  size: {
    touch: "44px",
    buttonSm: "44px",
    buttonMd: "48px",
    buttonLg: "52px",
    field: "52px",
    textarea: "112px",
    check: "22px",
  },
  space: {
    "1": "4px",
    "2": "8px",
    "3": "12px",
    "4": "16px",
    "5": "20px",
    "6": "24px",
    "8": "32px",
  },
  font: {
    family: '"Medeo Sans", sans-serif',
    mono: '"Medeo Mono", monospace',
    sizeCaption: "13px",
    sizeBody: "16px",
    weightRegular: "400",
    weightMedium: "550",
    weightStrong: "600",
  },
  focus: {
    color: "#5b2439",
    width: "3px",
    offset: "3px",
    halo: "0 0 0 6px #fff",
  },
  shadow: {
    button: "0 2px 6px rgba(53, 39, 44, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.12)",
    sheet: "0 -10px 60px #742b4520",
    toast: "0 10px 28px rgba(53, 39, 44, 0.28)",
  },
  glass: {
    alpha: "0.085",
    blur: "blur(9px) saturate(1.3)",
    rim: "rgba(255, 255, 255, 0.68)",
    rimTop: "rgba(255, 255, 255, 0.9)",
  },
} as const;

export type Tokens = typeof tokens;

const kebab = (name: string) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

/** Every token as `--ui-<group>-<name>` → value; the same names as in tokens.css. */
export function tokenVariables(): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [group, values] of Object.entries(tokens)) {
    for (const [name, value] of Object.entries(values)) variables[`--ui-${group}-${kebab(name)}`] = value;
  }
  return variables;
}

/** A `:root { ... }` block for HTML documents that do not load tokens.css (reports, letters). */
export function tokensToCss(selector = ":root"): string {
  const lines = Object.entries(tokenVariables()).map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join("\n")}\n}`;
}
