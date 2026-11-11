import { ITEM_BY_ID, type Placed } from '../../../shared/src/catalog.ts';
import { TILE, VIEW_H, VIEW_W } from '../../../shared/src/constants.ts';
import { PAL, shade } from '../../../shared/src/palette.ts';
import { charAt, type Grid, type Rect, type RoomKind } from '../../../shared/src/tilemap.ts';
import { ctxOf, drawSprite, hash, makeCanvas, painter, type Ctx, type Painter } from './pix.ts';
import {
  bedSprite,
  catSprite,
  chairSprites,
  fishTankSprite,
  lampSprite,
  paintShelf,
  plantSprite,
  shelfSprite,
  sideTableSprite,
  sofaSprites,
} from './sprites.ts';

/** Something drawn in the depth-sorted pass, so avatars can walk in front of and behind it. */
export interface Drawable {
  /** Y of its "feet" in room pixels; larger draws later (in front). */
  sort: number;
  draw: (ctx: Ctx, t: number) => void;
}

export interface Baked {
  /** Floor, walls, rugs and wall decorations, drawn once. */
  base: HTMLCanvasElement;
  objects: Drawable[];
  /** Room origin inside the view, in pixels. */
  ox: number;
  oy: number;
  glows: { x: number; y: number }[];
  night: boolean;
}

interface Theme {
  wall: string;
  wallAlt: string;
  wains: string;
  rail: string;
  floor: 'wood' | 'carpet' | 'plank';
  rug: [string, string, string];
  sofa: string;
}

const THEMES: Record<RoomKind, Theme> = {
  cafe: { wall: PAL.cream, wallAlt: shade(PAL.cream, 0.93), wains: PAL.tealD, rail: PAL.teal, floor: 'wood', rug: [PAL.redD, PAL.red, PAL.yellow], sofa: PAL.red },
  library: { wall: PAL.greenD, wallAlt: shade(PAL.greenD, 1.14), wains: PAL.brownD, rail: PAL.brown, floor: 'carpet', rug: [PAL.navy, PAL.blue, PAL.cream], sofa: PAL.teal },
  home: { wall: PAL.sky, wallAlt: shade(PAL.sky, 0.93), wains: PAL.greyL, rail: PAL.white, floor: 'plank', rug: [PAL.tealD, PAL.teal, PAL.cream], sofa: PAL.teal },
};

/** Window colour for the local hour, and whether lamps should glow. */
export function skyFor(hour: number): { sky: string; night: boolean; dim: boolean } {
  if (hour >= 7 && hour < 17) return { sky: PAL.sky, night: false, dim: false };
  if (hour >= 5 && hour < 7) return { sky: '#f4c3a6', night: false, dim: true };
  if (hour >= 17 && hour < 19.5) return { sky: PAL.orange, night: false, dim: true };
  return { sky: PAL.navy, night: true, dim: true };
}

function paintFloor(r: Painter, kind: Theme['floor'], px: number, py: number, tx: number, ty: number): void {
  if (kind === 'carpet') {
    r(PAL.plum, px, py, TILE, TILE);
    for (let dy = 0; dy < TILE; dy += 4) {
      for (let dx = 0; dx < TILE; dx += 4) {
        const off = (dy / 4) % 2 ? 2 : 0;
        r(shade(PAL.plum, 0.84), px + dx + off, py + dy + 1, 1, 1);
        r(shade(PAL.plum, 1.12), px + dx + ((off + 2) % 4), py + dy + 3, 1, 1);
      }
    }
    return;
  }
  const base = kind === 'wood' ? PAL.wood : PAL.tan;
  const line = kind === 'wood' ? PAL.brown : PAL.wood;
  const hi = kind === 'wood' ? PAL.tan : PAL.cream;
  r(base, px, py, TILE, TILE);
  for (let row = 0; row < 4; row++) {
    const n = hash(tx, ty * 4 + row, 7);
    r(line, px, py + row * 4 + 3, TILE, 1);
    r(line, px + (n % 16), py + row * 4, 1, 3);
    if ((n >> 5) % 3 === 0) r(hi, px + ((n >> 8) % 12), py + row * 4 + 1, 3, 1);
  }
}

function paintWall(r: Painter, t: Theme, px: number, py: number, lower: boolean): void {
  r(t.wall, px, py, TILE, TILE);
  r(t.wallAlt, px + 3, py, 2, TILE);
  r(t.wallAlt, px + 11, py, 2, TILE);
  if (!lower) {
    r(PAL.ink, px, py, TILE, 2);
    r(shade(t.wall, 0.8), px, py + 2, TILE, 1);
    return;
  }
  r(t.rail, px, py + 7, TILE, 1);
  r(t.wains, px, py + 8, TILE, 7);
  r(shade(t.wains, 0.8), px + 7, py + 9, 1, 5);
  r(shade(t.wains, 0.8), px + 15, py + 9, 1, 5);
  r(PAL.ink, px, py + 15, TILE, 1);
}

function paintRug(r: Painter, rect: Rect, c: [string, string, string]): void {
  const x = rect.x * TILE + 1;
  const y = rect.y * TILE + 1;
  const w = rect.w * TILE - 2;
  const h = rect.h * TILE - 2;
  r(c[0], x, y, w, h);
  r(c[1], x + 2, y + 2, w - 4, h - 4);
  r(c[2], x + 3, y + 3, w - 6, 1);
  r(c[2], x + 3, y + h - 4, w - 6, 1);
  r(c[2], x + 3, y + 3, 1, h - 6);
  r(c[2], x + w - 4, y + 3, 1, h - 6);
  for (let dx = 8; dx < w - 6; dx += 8) {
    for (let dy = 8; dy < h - 6; dy += 8) r(c[2], x + dx - 1, y + dy - 1, 2, 2);
  }
  for (let fx = x + 1; fx < x + w - 1; fx += 2) {
    r(c[0], fx, y - 1, 1, 1);
    r(c[0], fx, y + h, 1, 1);
  }
}

function paintWindow(r: Painter, x: number, by: number, sky: string, night: boolean, seed: number): void {
  r(PAL.brownD, x + 1, by - 10, 14, 17);
  r(sky, x + 2, by - 9, 12, 15);
  if (night) {
    for (let i = 0; i < 4; i++) {
      const n = hash(seed, i, 3);
      r(PAL.white, x + 2 + (n % 12), by - 9 + ((n >> 4) % 14), 1, 1);
    }
    if (seed % 3 === 0) r(PAL.cream, x + 10, by - 7, 2, 2);
  } else {
    r(PAL.white, x + 3, by - 8, 1, 3);
    r(PAL.white, x + 4, by - 8, 1, 1);
    r(PAL.white, x + 10, by - 4 + (seed % 3), 3, 1);
  }
  r(PAL.brownD, x + 7, by - 9, 2, 15);
  r(PAL.brownD, x + 2, by - 2, 12, 1);
  r(PAL.tan, x, by + 6, 16, 2);
  r(PAL.brown, x, by + 8, 16, 1);
}

function paintDoor(r: Painter, x: number, by: number): void {
  r(PAL.brownD, x, by - 12, 16, 28);
  r(PAL.wood, x + 2, by - 10, 12, 26);
  r(PAL.tan, x + 2, by - 10, 12, 1);
  r(PAL.brown, x + 4, by - 8, 8, 9);
  r(PAL.sky, x + 5, by - 7, 6, 4);
  r(PAL.brown, x + 4, by + 4, 8, 9);
  r(PAL.yellow, x + 11, by + 2, 2, 2);
  // Doormat on the floor tile in front.
  r(PAL.redD, x + 1, by + 18, 14, 9);
  r(PAL.red, x + 2, by + 19, 12, 7);
  r(PAL.cream, x + 4, by + 21, 8, 1);
  r(PAL.cream, x + 4, by + 23, 8, 1);
}

function paintMenu(r: Painter, x: number, by: number): void {
  r(PAL.brownD, x + 1, by - 9, 14, 13);
  r(PAL.ink, x + 2, by - 8, 12, 11);
  r(PAL.white, x + 4, by - 6, 8, 1);
  r(PAL.yellow, x + 4, by - 4, 5, 1);
  r(PAL.pink, x + 4, by - 2, 6, 1);
  r(PAL.white, x + 4, by, 4, 1);
}

function paintPicture(r: Painter, x: number, by: number, variant: number): void {
  r(PAL.brownD, x + 2, by - 9, 12, 11);
  if (variant % 2 === 0) {
    r(PAL.sky, x + 3, by - 8, 10, 5);
    r(PAL.yellow, x + 10, by - 7, 2, 2);
    r(PAL.green, x + 3, by - 3, 10, 4);
    r(PAL.green, x + 5, by - 4, 4, 1);
    r(PAL.greenD, x + 9, by - 2, 4, 3);
  } else {
    r(PAL.cream, x + 3, by - 8, 10, 9);
    r(PAL.red, x + 4, by - 7, 4, 4);
    r(PAL.blue, x + 8, by - 4, 4, 4);
    r(PAL.yellow, x + 9, by - 7, 3, 2);
  }
}

function tableDrawable(grid: Grid, ox: number, oy: number, x: number, y: number): Drawable {
  const left = charAt(grid.def, x - 1, y) === 'T';
  const right = charAt(grid.def, x + 1, y) === 'T';
  const clutter = hash(x, y, 11) % 5;
  return {
    sort: (y + 1) * TILE,
    draw: (ctx) => {
      const r = painter(ctx, ox + x * TILE, oy + y * TILE);
      r(PAL.ink, 0, 0, 16, 1);
      r(PAL.cream, 0, 1, 16, 1);
      r(PAL.tan, 0, 2, 16, 8);
      r(PAL.wood, 0, 10, 16, 3);
      r(PAL.ink, 0, 13, 16, 1);
      if (!left) {
        r(PAL.ink, 0, 0, 1, 14);
        r(PAL.brownD, 1, 14, 2, 2);
      }
      if (!right) {
        r(PAL.ink, 15, 0, 1, 14);
        r(PAL.brownD, 13, 14, 2, 2);
      }
      if (clutter === 0) {
        r(PAL.shadow, 5, 2, 6, 4);
        r(PAL.sky, 6, 3, 4, 2);
        r(PAL.greyL, 4, 6, 8, 2);
      }
      if (clutter === 1 || clutter === 3) {
        r(PAL.white, 10, 4, 3, 3);
        r(PAL.brown, 11, 4, 1, 1);
        r(PAL.white, 13, 5, 1, 1);
      }
      if (clutter === 2 || clutter === 3) {
        r(PAL.red, 3, 5, 5, 3);
        r(PAL.white, 4, 6, 3, 1);
      }
    },
  };
}

function counterDrawable(grid: Grid, ox: number, oy: number, x: number, y: number, espresso: boolean): Drawable {
  const isCounter = (cx: number) => 'KE'.includes(charAt(grid.def, cx, y));
  const left = x > 0 && isCounter(x - 1);
  const right = x < grid.w - 1 && isCounter(x + 1);
  return {
    sort: (y + 1) * TILE,
    draw: (ctx) => {
      const r = painter(ctx, ox + x * TILE, oy + y * TILE);
      r(PAL.ink, 0, -5, 16, 1);
      r(PAL.white, 0, -4, 16, 1);
      r(PAL.cream, 0, -3, 16, 7);
      r(PAL.tealD, 0, 4, 16, 11);
      r(PAL.teal, 1, 5, 14, 1);
      r(shade(PAL.tealD, 0.8), 7, 7, 1, 7);
      r(PAL.ink, 0, 15, 16, 1);
      if (!left) r(PAL.ink, 0, -5, 1, 21);
      if (!right) r(PAL.ink, 15, -5, 1, 21);
      if (espresso) {
        r(PAL.ink, 1, -14, 14, 11);
        r(PAL.greyL, 2, -13, 12, 9);
        r(PAL.grey, 2, -13, 12, 2);
        r(PAL.ink, 4, -9, 8, 3);
        r(PAL.red, 11, -12, 1, 1);
        r(PAL.white, 6, -7, 3, 2);
      } else if (x % 4 === 0) {
        r(PAL.white, 4, -3, 8, 1);
        r(PAL.pink, 5, -7, 6, 4);
        r(PAL.cream, 5, -5, 6, 1);
        r(PAL.red, 7, -8, 2, 1);
      } else if (x % 4 === 1) {
        r(PAL.white, 6, -7, 4, 5);
        r(PAL.greyL, 6, -5, 4, 1);
        r(PAL.greyL, 6, -3, 4, 1);
      }
    },
  };
}

/** A small picture of a furniture item for the shop and the decorate bar. */
export function furnitureIcon(itemId: string): HTMLCanvasElement {
  const item = ITEM_BY_ID.get(itemId);
  const w = (item?.w ?? 1) * TILE;
  const h = (item?.h ?? 1) * TILE;
  const top = item?.layer === 'floor' ? 2 : 18;
  const canvas = makeCanvas(w + 4, h + top + 2);
  const ctx = ctxOf(canvas);
  const r = painter(ctx, 2, top);
  if (itemId === 'f_rug') paintRug(r, { x: 0, y: 0, w: 2, h: 2 }, THEMES.home.rug);
  else if (itemId === 'f_painting') paintPicture(r, 0, 10, 1);
  else if (itemId === 'f_armchair') drawSprite(ctx, sofaSprites('down', THEMES.home.sofa).base, 2, top);
  else furnitureDrawable({ id: 1, item: itemId, x: 0, y: 0 }, 2, top)?.draw(ctx, 0);
  return canvas;
}

/** A piece of placed furniture as a depth-sorted drawable. Rugs, paintings and seats are drawn elsewhere. */
export function furnitureDrawable(f: Placed, ox: number, oy: number): Drawable | null {
  const px = ox + f.x * TILE;
  const py = oy + f.y * TILE;
  const bottom = (f.y + 1) * TILE;
  switch (f.item) {
    case 'f_plant':
      return { sort: bottom, draw: (ctx) => drawSprite(ctx, plantSprite(), px, py) };
    case 'f_lamp':
      return { sort: bottom, draw: (ctx) => drawSprite(ctx, lampSprite(), px, py) };
    case 'f_bookshelf':
      return { sort: bottom, draw: (ctx) => drawSprite(ctx, shelfSprite(f.id + 40), px, py) };
    case 'f_sidetable':
      return { sort: bottom, draw: (ctx) => drawSprite(ctx, sideTableSprite(), px, py) };
    case 'f_cat':
      return { sort: bottom, draw: (ctx) => drawSprite(ctx, catSprite(), px, py) };
    case 'f_bed':
      return { sort: bottom + TILE, draw: (ctx) => drawSprite(ctx, bedSprite(), px, py) };
    case 'f_fishtank':
      return {
        sort: bottom,
        draw: (ctx, t) => {
          drawSprite(ctx, fishTankSprite(), px, py);
          const swim = Math.floor(t / 400 + f.id * 3) % 16;
          const fx = swim < 8 ? swim : 15 - swim;
          ctx.fillStyle = PAL.orange;
          ctx.fillRect(px + 3 + fx, py + 3, 2, 1);
          ctx.fillStyle = PAL.red;
          ctx.fillRect(px + 10 - fx, py + 5, 2, 1);
        },
      };
  }
  return null;
}

export function bakeRoom(grid: Grid, furniture: Placed[], hour: number): Baked {
  const { def, w, h } = grid;
  const t = THEMES[def.kind];
  const ox = Math.floor((VIEW_W - w * TILE) / 2);
  const oy = Math.floor((VIEW_H - h * TILE) / 2);
  const base = makeCanvas(VIEW_W, VIEW_H);
  const ctx = ctxOf(base);
  ctx.fillStyle = PAL.ink;
  ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  const r = painter(ctx, ox, oy);
  const { sky, night, dim } = skyFor(hour);

  r(PAL.shadow, -3, -3, w * TILE + 6, h * TILE + 6);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (y < 2) {
        paintWall(r, t, x * TILE, y * TILE, y === 1);
      } else {
        paintFloor(r, t.floor, x * TILE, y * TILE, x, y);
        if (y === 2) {
          ctx.fillStyle = 'rgba(43,34,51,0.22)';
          ctx.fillRect(ox + x * TILE, oy + y * TILE, TILE, 2);
        }
      }
    }
  }

  for (const rug of def.rugs) paintRug(r, rug, t.rug);
  for (const f of furniture) {
    const item = ITEM_BY_ID.get(f.item);
    if (item?.layer === 'floor') paintRug(r, { x: f.x, y: f.y, w: item.w ?? 1, h: item.h ?? 1 }, THEMES.home.rug);
  }

  const by = TILE;
  for (let x = 0; x < w; x++) {
    const ch = def.rows[1][x];
    if (ch === 'W') paintWindow(r, x * TILE, by, sky, night, x);
    else if (ch === 'D') paintDoor(r, x * TILE, by);
    else if (ch === 'B') paintShelf(r, x * TILE, by - 10, TILE, 26, x);
    else if (ch === 'M') paintMenu(r, x * TILE, by);
    else if (ch === 'F') paintPicture(r, x * TILE, by, x);
  }
  for (const f of furniture) {
    if (f.item === 'f_painting') paintPicture(r, f.x * TILE, by, f.id);
  }

  const objects: Drawable[] = [];
  const glows: { x: number; y: number }[] = [];
  for (let y = 2; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = def.rows[y][x];
      const px = ox + x * TILE;
      const py = oy + y * TILE;
      const bottom = (y + 1) * TILE;
      if (ch === 'T') objects.push(tableDrawable(grid, ox, oy, x, y));
      else if (ch === 'K' || ch === 'E') objects.push(counterDrawable(grid, ox, oy, x, y, ch === 'E'));
      else if (ch === 'P') objects.push({ sort: bottom, draw: (c) => drawSprite(c, plantSprite(), px, py) });
      else if (ch === 'b') objects.push({ sort: bottom, draw: (c) => drawSprite(c, shelfSprite(x * 7 + y), px, py) });
      else if (ch === 'L') {
        objects.push({ sort: bottom, draw: (c) => drawSprite(c, lampSprite(), px, py) });
        glows.push({ x: px + 8, y: py - 10 });
      }
    }
  }

  for (const s of grid.seats) {
    const px = ox + s.x * TILE;
    const py = oy + s.y * TILE;
    const bottom = (s.y + 1) * TILE;
    const art = s.style === 'sofa' ? sofaSprites(s.dir, t.sofa) : chairSprites(s.dir);
    objects.push({ sort: bottom - 0.5, draw: (c) => drawSprite(c, art.base, px, py) });
    const front = art.front;
    if (front) objects.push({ sort: bottom + 0.5, draw: (c) => drawSprite(c, front, px, py) });
  }

  for (const f of furniture) {
    const d = furnitureDrawable(f, ox, oy);
    if (d) objects.push(d);
    if (f.item === 'f_lamp') glows.push({ x: ox + f.x * TILE + 8, y: oy + f.y * TILE - 10 });
  }

  return { base, objects, ox, oy, glows: dim ? glows : [], night };
}
