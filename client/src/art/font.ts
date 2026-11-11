import type { Ctx } from './pix.ts';

/** A 3x5 pixel font for text drawn inside the game canvas (name tags, timer bubbles). */
const GLYPHS: Record<string, string> = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '110001010100111',
  '3': '110001010001110',
  '4': '101101111001001',
  '5': '111100110001110',
  '6': '011100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001110',
  ':': '000010000010000',
  '-': '000000111000000',
  _: '000000000000111',
  '.': '000000000000010',
  '!': '010010010000010',
  '+': '000010111010000',
  '?': '110001010000010',
  "'": '010010000000000',
  '[': '110100100100110',
  ']': '011001001001011',
};

export const FONT_H = 5;

export function textWidth(text: string): number {
  return Math.max(0, text.length * 4 - 1);
}

export function drawText(ctx: Ctx, text: string, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  const s = text.toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const g = GLYPHS[s[i]];
    if (!g) continue;
    for (let p = 0; p < 15; p++) {
      if (g[p] === '1') ctx.fillRect(x + i * 4 + (p % 3), y + Math.floor(p / 3), 1, 1);
    }
  }
}

/** Text on a dark rounded plate, centred on cx. Returns the plate's top y. */
export function drawLabel(ctx: Ctx, text: string, cx: number, y: number, color: string, plate = 'rgba(43,34,51,0.72)'): void {
  const w = textWidth(text);
  const x = Math.round(cx - w / 2);
  ctx.fillStyle = plate;
  ctx.fillRect(x - 2, y - 1, w + 4, FONT_H + 2);
  ctx.fillRect(x - 1, y - 2, w + 2, FONT_H + 4);
  drawText(ctx, text, x, y, color);
}
