import { THEMES } from './config.js';

const PALETTES = {
  github: {
    accent: [63, 185, 80],
    text: [230, 237, 243],
    muted: [139, 148, 158],
    link: [88, 166, 255],
    panel: [22, 27, 34],
    selected: [33, 38, 45],
    border: [48, 54, 61],
    background: [13, 17, 23],
  },
  light: {
    accent: [26, 127, 55],
    text: [31, 35, 40],
    muted: [101, 109, 118],
    link: [9, 105, 218],
    panel: [246, 248, 250],
    selected: [221, 244, 255],
    border: [208, 215, 222],
    background: [255, 255, 255],
  },
  dracula: {
    accent: [80, 250, 123],
    text: [248, 248, 242],
    muted: [189, 147, 249],
    link: [139, 233, 253],
    panel: [52, 55, 70],
    selected: [68, 71, 90],
    border: [98, 100, 130],
    background: [40, 42, 54],
  },
  transparent: {
    accent: [63, 185, 80],
    text: [230, 237, 243],
    muted: [139, 148, 158],
    link: [88, 166, 255],
    panel: null,
    selected: null,
    border: [139, 148, 158],
    background: null,
  },
};

export function getPalette(theme) {
  return PALETTES[theme] || PALETTES.github;
}

export function nextTheme(theme) {
  const index = THEMES.indexOf(theme);
  return THEMES[(index + 1 + THEMES.length) % THEMES.length];
}

export function paint(value, color, enabled = true, background = false) {
  if (!enabled || !color) return String(value);
  const channel = background ? 48 : 38;
  return `\u001b[${channel};2;${color.join(';')}m${value}\u001b[0m`;
}

export function supportsColor(options = {}) {
  return Boolean(
    !options.noColor
      && process.env.NO_COLOR === undefined
      && process.env.TERM !== 'dumb'
      && process.stdout.isTTY,
  );
}
