import { ITEM_BY_ID, type Item, type Placed } from './catalog.ts';

export type Dir = 'up' | 'down' | 'left' | 'right';
export type RoomKind = 'cafe' | 'library' | 'home';

export interface Tile {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A room is drawn from rows of characters.
 * Rows 0 and 1 are the back wall:  # wall  W window  D door  B wall bookshelf  M menu board  F picture
 * Rows 2+ are floor:               . floor  T table  c chair  s sofa seat  K counter  E espresso counter
 *                                  P plant  L lamp  b bookshelf
 */
export interface RoomDef {
  kind: RoomKind;
  name: string;
  rows: string[];
  rugs: Rect[];
}

export interface Seat {
  x: number;
  y: number;
  dir: Dir;
  style: 'chair' | 'sofa';
}

export interface Grid {
  def: RoomDef;
  w: number;
  h: number;
  /** walk[y * w + x] is true for tiles an avatar can stand on. Seats are not walkable. */
  walk: boolean[];
  seats: Seat[];
  door: Tile;
  spawn: Tile;
}

export const WALL_ROWS = 2;

const STEPS: [Dir, number, number][] = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
];

export function charAt(def: RoomDef, x: number, y: number): string {
  return def.rows[y]?.[x] ?? '#';
}

export function footprint(item: Item, x: number, y: number): Rect {
  return { x, y, w: item.w ?? 1, h: item.h ?? 1 };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function buildGrid(def: RoomDef, furniture: Placed[] = []): Grid {
  const h = def.rows.length;
  const w = def.rows[0].length;
  const walk: boolean[] = new Array(w * h).fill(false);
  const tables = new Set<number>();
  const seatTiles: { x: number; y: number; style: 'chair' | 'sofa' }[] = [];
  let door: Tile = { x: Math.floor(w / 2), y: 1 };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = def.rows[y][x];
      if (y < WALL_ROWS) {
        if (ch === 'D') door = { x, y };
        continue;
      }
      if (ch === '.') walk[y * w + x] = true;
      else if (ch === 'c') seatTiles.push({ x, y, style: 'chair' });
      else if (ch === 's') seatTiles.push({ x, y, style: 'sofa' });
      else if (ch === 'T') tables.add(y * w + x);
    }
  }

  for (const f of furniture) {
    const item = ITEM_BY_ID.get(f.item);
    if (!item || item.layer !== 'object') continue;
    const r = footprint(item, f.x, f.y);
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        if (x >= 0 && y >= 0 && x < w && y < h) walk[y * w + x] = false;
      }
    }
    if (item.seat) seatTiles.push({ x: f.x, y: f.y, style: 'sofa' });
    if (item.table) tables.add(f.y * w + f.x);
  }

  const seats: Seat[] = seatTiles.map((s) => {
    let dir: Dir = 'down';
    for (const [d, dx, dy] of STEPS) {
      const nx = s.x + dx;
      const ny = s.y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && tables.has(ny * w + nx)) {
        dir = d;
        break;
      }
    }
    return { ...s, dir };
  });

  return { def, w, h, walk, seats, door, spawn: { x: door.x, y: door.y + 1 } };
}

export function inBounds(grid: Grid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.w && y < grid.h;
}

export function isWalkable(grid: Grid, x: number, y: number): boolean {
  return inBounds(grid, x, y) && grid.walk[y * grid.w + x];
}

export function seatAt(grid: Grid, x: number, y: number): Seat | undefined {
  return grid.seats.find((s) => s.x === x && s.y === y);
}

/** Whether a furniture item may be put at (x, y) given what is already placed. */
export function canPlace(def: RoomDef, furniture: Placed[], item: Item, x: number, y: number, ignoreId?: number): boolean {
  const h = def.rows.length;
  const w = def.rows[0].length;
  const layer = item.layer ?? 'object';
  const rect = footprint(item, x, y);
  const others = furniture.filter((f) => f.id !== ignoreId);

  const clash = others.some((f) => {
    const other = ITEM_BY_ID.get(f.item);
    return !!other && (other.layer ?? 'object') === layer && overlaps(rect, footprint(other, f.x, f.y));
  });
  if (clash) return false;

  if (layer === 'wall') {
    return y === 1 && x >= 0 && x < w && def.rows[1][x] === '#';
  }

  const doorX = def.rows[1].indexOf('D');
  for (let ty = rect.y; ty < rect.y + rect.h; ty++) {
    for (let tx = rect.x; tx < rect.x + rect.w; tx++) {
      if (tx < 0 || tx >= w || ty < WALL_ROWS || ty >= h) return false;
      if (def.rows[ty][tx] !== '.') return false;
      // Keep the doorway clear so nobody gets walled in.
      if (layer === 'object' && tx === doorX && ty <= WALL_ROWS + 1) return false;
    }
  }
  return true;
}
