/** The one palette every sprite, tile and UI colour is drawn from. */
export const PAL = {
  ink: '#2b2233',
  shadow: '#4a3b52',
  plum: '#6e4a6b',
  brownD: '#5c3b2e',
  brown: '#8a5a3c',
  wood: '#b9814f',
  tan: '#dcae76',
  cream: '#f3dfb5',
  white: '#fbf5e6',
  redD: '#a83a3f',
  red: '#d95a4e',
  orange: '#ee9a4a',
  yellow: '#f6cf5b',
  greenD: '#2f6b55',
  green: '#4f9d5e',
  lime: '#a3cf6a',
  tealD: '#2e6f80',
  teal: '#4fa7a8',
  sky: '#9bd6dc',
  navy: '#2f3f6e',
  blue: '#4f6fba',
  purple: '#8562b5',
  pink: '#e58aa6',
  grey: '#9a93a3',
  greyL: '#cfc8d3',
} as const;

export const SKIN = ['#f6d0a8', '#e2a878', '#b9774f', '#7d4e36'] as const;

/** Multiply a hex colour's brightness (f < 1 darkens, f > 1 lightens). */
export function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  const r = c((n >> 16) & 255);
  const g = c((n >> 8) & 255);
  const b = c(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
