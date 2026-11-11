import { PAL } from '../../../shared/src/palette.ts';

export type Ctx = CanvasRenderingContext2D;

/** Fill a w x h block of pixels. Every sprite in the game is built from calls to one of these. */
export type Painter = (color: string, x: number, y: number, w?: number, h?: number) => void;

/** An image plus the point inside it that sits on the "ground" position it is drawn at. */
export interface Sprite {
  img: HTMLCanvasElement;
  ax: number;
  ay: number;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctxOf(c: HTMLCanvasElement): Ctx {
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

export function painter(ctx: Ctx, ox = 0, oy = 0): Painter {
  return (color, x, y, w = 1, h = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, oy + y, w, h);
  };
}

/** Give a sprite a 1px dark outline by inking every empty pixel that touches a filled one. */
export function outline(canvas: HTMLCanvasElement, color: string = PAL.ink): void {
  const ctx = ctxOf(canvas);
  const { width: w, height: h } = canvas;
  const src = ctx.getImageData(0, 0, w, h).data;
  const filled = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 0;
  ctx.fillStyle = color;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) ctx.fillRect(x, y, 1, 1);
    }
  }
}

/**
 * Build a sprite by painting into a padded canvas, then outlining it.
 * `paint` uses coordinates where (0, 0) is `pad` pixels in from the top-left.
 */
export function sprite(w: number, h: number, ax: number, ay: number, paint: (r: Painter) => void, opts: { outline?: boolean; pad?: number } = {}): Sprite {
  const pad = opts.pad ?? 1;
  const c = makeCanvas(w + pad * 2, h + pad * 2);
  paint(painter(ctxOf(c), pad, pad));
  if (opts.outline !== false) outline(c);
  return { img: c, ax: ax + pad, ay: ay + pad };
}

/** Build a sprite from rows of characters; `colors` maps each character to a colour, '.' is empty. */
export function gridSprite(rows: string[], colors: Record<string, string>, ax: number, ay: number, withOutline = true): Sprite {
  return sprite(
    rows[0].length,
    rows.length,
    ax,
    ay,
    (r) => {
      rows.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          const c = colors[row[x]];
          if (c) r(c, x, y);
        }
      });
    },
    { outline: withOutline },
  );
}

export function drawSprite(ctx: Ctx, s: Sprite, x: number, y: number): void {
  ctx.drawImage(s.img, Math.round(x - s.ax), Math.round(y - s.ay));
}

/** Small deterministic hash, so "random" details (books, table clutter) are the same for everyone. */
export function hash(x: number, y: number, seed = 0): number {
  let n = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  n = (n ^ (n >>> 13)) * 1274126177;
  return (n ^ (n >>> 16)) >>> 0;
}

export function toDataUrl(c: HTMLCanvasElement): string {
  return c.toDataURL('image/png');
}
