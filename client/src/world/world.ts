import { ITEM_BY_ID, type Outfit, type Placed } from '../../../shared/src/catalog.ts';
import { STEP_MS, TILE, type Emote } from '../../../shared/src/constants.ts';
import type { FocusState, PlayerPublic, RoomSnapshot } from '../../../shared/src/protocol.ts';
import { ROOMS } from '../../../shared/src/rooms.ts';
import { buildGrid, seatAt, type Dir, type Grid, type Tile } from '../../../shared/src/tilemap.ts';
import type { Baked } from '../art/roomArt.ts';
import { meView, people, placed, type PersonRow } from '../state.ts';

/** The client's copy of the room: avatars glide between the tiles the server reports. */

export interface Avatar {
  id: string;
  name: string;
  bot: boolean;
  outfit: Outfit;
  /** Top-left of the avatar's tile position, in room pixels. */
  px: number;
  py: number;
  waypoints: Tile[];
  dir: Dir;
  sitting: boolean;
  moving: boolean;
  focus: FocusState | null;
  breakEndsAt: number | null;
  away: boolean;
  emote: { kind: Emote; until: number } | null;
  /** Per-avatar offset so animations are not all in step. */
  phase: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

export const world = {
  grid: null as Grid | null,
  furniture: [] as Placed[],
  avatars: new Map<string, Avatar>(),
  meId: null as string | null,
  baked: null as Baked | null,
  bakedHour: -1,
  dirty: true,
  hover: null as Tile | null,
  particles: [] as Particle[],
};

const SPEED = TILE / (STEP_MS / 1000);

function toAvatar(p: PlayerPublic): Avatar {
  return {
    id: p.id,
    name: p.name,
    bot: p.bot,
    outfit: p.outfit,
    px: p.x * TILE,
    py: p.y * TILE,
    waypoints: p.path.map(([x, y]) => ({ x, y })),
    dir: 'down',
    sitting: p.sitting,
    moving: p.path.length > 0,
    focus: p.focus,
    breakEndsAt: p.breakEndsAt,
    away: p.away,
    emote: null,
    phase: Math.floor(Math.random() * 8),
  };
}

export function me(): Avatar | undefined {
  return world.meId ? world.avatars.get(world.meId) : undefined;
}

export function tileOf(a: Avatar): Tile {
  return { x: Math.round(a.px / TILE), y: Math.round(a.py / TILE) };
}

/** Where the avatar will be once it finishes walking. */
export function destination(a: Avatar): Tile {
  return a.waypoints.length ? a.waypoints[a.waypoints.length - 1] : tileOf(a);
}

export function refreshPeople(): void {
  const rows: PersonRow[] = [...world.avatars.values()].map((a) => ({
    id: a.id,
    name: a.name,
    bot: a.bot,
    me: a.id === world.meId,
    away: a.away,
    focusEndsAt: a.focus?.endsAt ?? null,
    onBreak: a.breakEndsAt !== null,
  }));
  rows.sort((a, b) => Number(b.me) - Number(a.me) || Number(a.bot) - Number(b.bot) || a.name.localeCompare(b.name));
  people.value = rows;
}

export function loadRoom(snap: RoomSnapshot): void {
  world.furniture = snap.furniture;
  placed.value = snap.furniture;
  world.grid = buildGrid(ROOMS[snap.kind], snap.furniture);
  world.avatars.clear();
  for (const p of snap.players) world.avatars.set(p.id, toAvatar(p));
  world.particles = [];
  world.hover = null;
  world.dirty = true;
  refreshPeople();
}

export function addPlayer(p: PlayerPublic): void {
  world.avatars.set(p.id, toAvatar(p));
  refreshPeople();
}

export function removePlayer(id: string): void {
  world.avatars.delete(id);
  refreshPeople();
}

export function applyMoved(id: string, path: [number, number][], sitting: boolean): void {
  const a = world.avatars.get(id);
  if (!a) return;
  a.waypoints = path.map(([x, y]) => ({ x, y }));
  a.sitting = sitting;
}

export function applyPatch(id: string, patch: Partial<PlayerPublic>): void {
  const a = world.avatars.get(id);
  if (!a) return;
  if (patch.name !== undefined) a.name = patch.name;
  if (patch.outfit !== undefined) a.outfit = patch.outfit;
  if (patch.focus !== undefined) a.focus = patch.focus;
  if (patch.breakEndsAt !== undefined) a.breakEndsAt = patch.breakEndsAt;
  if (patch.away !== undefined) a.away = patch.away;
  refreshPeople();
}

export function setFurniture(items: Placed[]): void {
  if (!world.grid) return;
  world.furniture = items;
  placed.value = items;
  world.grid = buildGrid(world.grid.def, items);
  world.dirty = true;
}

export function showEmote(id: string, kind: Emote): void {
  const a = world.avatars.get(id);
  if (a) a.emote = { kind, until: performance.now() + 2600 };
}

/** A little burst of coins and sparkles over someone who just finished a session. */
export function celebrate(id: string, colors: string[]): void {
  const a = world.avatars.get(id);
  if (!a) return;
  for (let i = 0; i < 14; i++) {
    world.particles.push({
      x: a.px + 8,
      y: a.py - 6,
      vx: (Math.random() - 0.5) * 50,
      vy: -30 - Math.random() * 45,
      life: 0.7 + Math.random() * 0.6,
      color: colors[i % colors.length],
    });
  }
}

/** Topmost piece of furniture covering a tile (objects before rugs), for decorating. */
export function furnitureAt(t: Tile): Placed | undefined {
  const hits = world.furniture.filter((f) => {
    const item = ITEM_BY_ID.get(f.item);
    if (!item) return false;
    if (item.layer === 'wall') return t.y <= 1 && t.x === f.x;
    return t.x >= f.x && t.x < f.x + (item.w ?? 1) && t.y >= f.y && t.y < f.y + (item.h ?? 1);
  });
  return hits.find((f) => ITEM_BY_ID.get(f.item)?.layer !== 'floor') ?? hits[0];
}

export function step(dt: number): void {
  const grid = world.grid;
  if (!grid) return;

  for (const a of world.avatars.values()) {
    // Catch up faster if we have fallen well behind the server's idea of where they are.
    let budget = SPEED * dt * (a.waypoints.length > 6 ? 1.7 : 1);
    while (budget > 0 && a.waypoints.length) {
      const tx = a.waypoints[0].x * TILE;
      const ty = a.waypoints[0].y * TILE;
      const dx = tx - a.px;
      const dy = ty - a.py;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.01) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      if (dist <= budget) {
        a.px = tx;
        a.py = ty;
        a.waypoints.shift();
        budget -= dist;
      } else {
        a.px += (dx / dist) * budget;
        a.py += (dy / dist) * budget;
        budget = 0;
      }
    }
    a.moving = a.waypoints.length > 0;
    if (!a.moving && a.sitting) {
      const seat = seatAt(grid, Math.round(a.px / TILE), Math.round(a.py / TILE));
      if (seat) a.dir = seat.dir;
    }
  }

  for (const p of world.particles) {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 120 * dt;
    p.life -= dt;
  }
  if (world.particles.length) world.particles = world.particles.filter((p) => p.life > 0);

  const mine = me();
  const next = {
    seated: !!mine && mine.sitting && !mine.moving,
    focus: mine?.focus ?? null,
    breakEndsAt: mine?.breakEndsAt ?? null,
  };
  const cur = meView.value;
  if (cur.seated !== next.seated || cur.focus?.endsAt !== next.focus?.endsAt || cur.breakEndsAt !== next.breakEndsAt) {
    meView.value = next;
  }
}
