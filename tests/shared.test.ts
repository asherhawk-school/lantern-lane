import { describe, expect, it } from 'vitest';
import { DEFAULT_OUTFIT, ITEM_BY_ID, outfitValid } from '../shared/src/catalog.ts';
import { findPath } from '../shared/src/pathfinding.ts';
import { ClientMsgSchema } from '../shared/src/protocol.ts';
import { applySession, currentStreak, dayKey, prevDay, sessionCoins } from '../shared/src/rewards.ts';
import { ROOMS } from '../shared/src/rooms.ts';
import { buildGrid, canPlace, isWalkable, seatAt } from '../shared/src/tilemap.ts';

describe('rewards', () => {
  it('pays one coin per minute plus a first-of-day streak bonus capped at 7 days', () => {
    expect(sessionCoins(25, 1, true)).toEqual({ base: 25, bonus: 2, total: 27 });
    expect(sessionCoins(25, 3, false)).toEqual({ base: 25, bonus: 0, total: 25 });
    expect(sessionCoins(50, 30, true).bonus).toBe(14);
  });

  it('grows the streak on consecutive days and resets after a gap', () => {
    let s = applySession({ streak: 0, lastDay: null }, '2026-03-01');
    expect(s).toMatchObject({ streak: 1, firstOfDay: true });
    s = applySession(s, '2026-03-01');
    expect(s).toMatchObject({ streak: 1, firstOfDay: false });
    s = applySession(s, '2026-03-02');
    expect(s).toMatchObject({ streak: 2, firstOfDay: true });
    s = applySession(s, '2026-03-05');
    expect(s).toMatchObject({ streak: 1, firstOfDay: true });
  });

  it('shows a streak as lapsed once a whole day is missed', () => {
    expect(currentStreak(4, '2026-03-02', '2026-03-02')).toBe(4);
    expect(currentStreak(4, '2026-03-02', '2026-03-03')).toBe(4);
    expect(currentStreak(4, '2026-03-02', '2026-03-04')).toBe(0);
    expect(currentStreak(0, null, '2026-03-04')).toBe(0);
  });

  it('uses the player timezone for the calendar day', () => {
    const ts = Date.UTC(2026, 0, 1, 2, 0); // 02:00 UTC on 1 Jan
    expect(dayKey(ts, 0)).toBe('2026-01-01');
    expect(dayKey(ts, 300)).toBe('2025-12-31'); // UTC-5
    expect(dayKey(ts, -600)).toBe('2026-01-01'); // UTC+10
    expect(prevDay('2026-03-01')).toBe('2026-02-28');
  });
});

describe('rooms and pathfinding', () => {
  const cafe = buildGrid(ROOMS.cafe);

  it('every room has equal-length rows, a door and reachable seats', () => {
    for (const def of Object.values(ROOMS)) {
      const grid = buildGrid(def);
      expect(new Set(def.rows.map((r) => r.length)).size).toBe(1);
      expect(def.rows[1]).toContain('D');
      expect(isWalkable(grid, grid.spawn.x, grid.spawn.y)).toBe(true);
      expect(grid.seats.length).toBeGreaterThan(0);
      for (const s of grid.seats) {
        expect(findPath(grid, grid.spawn, s, true), `seat ${s.x},${s.y} in ${def.kind}`).not.toBeNull();
      }
    }
  });

  it('faces seats toward the table next to them', () => {
    expect(seatAt(cafe, 3, 5)?.dir).toBe('right');
    expect(seatAt(cafe, 5, 5)?.dir).toBe('left');
    expect(seatAt(cafe, 9, 5)?.dir).toBe('down');
    expect(seatAt(cafe, 9, 7)?.dir).toBe('up');
  });

  it('walks around furniture and never through seats or tables', () => {
    const path = findPath(cafe, { x: 4, y: 4 }, { x: 4, y: 6 })!;
    expect(path[0]).toEqual({ x: 4, y: 4 });
    expect(path.at(-1)).toEqual({ x: 4, y: 6 });
    expect(path.length).toBeGreaterThan(3); // the table at (4,5) is in the way
    for (let i = 1; i < path.length; i++) {
      const step = Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
      expect(step).toBe(1);
      expect(isWalkable(cafe, path[i].x, path[i].y)).toBe(true);
    }
  });

  it('only ends on a seat when asked to, and rejects walls and out-of-bounds', () => {
    expect(findPath(cafe, cafe.spawn, { x: 3, y: 5 })).toBeNull();
    expect(findPath(cafe, cafe.spawn, { x: 3, y: 5 }, true)?.at(-1)).toEqual({ x: 3, y: 5 });
    expect(findPath(cafe, cafe.spawn, { x: 4, y: 5 }, true)).toBeNull(); // a table
    expect(findPath(cafe, cafe.spawn, { x: 0, y: 0 })).toBeNull();
    expect(findPath(cafe, cafe.spawn, { x: 99, y: 3 })).toBeNull();
  });
});

describe('furniture placement', () => {
  const home = ROOMS.home;
  const plant = ITEM_BY_ID.get('f_plant')!;
  const rug = ITEM_BY_ID.get('f_rug')!;
  const painting = ITEM_BY_ID.get('f_painting')!;

  it('allows free floor and refuses walls, the desk, the doorway and overlaps', () => {
    expect(canPlace(home, [], plant, 2, 5)).toBe(true);
    expect(canPlace(home, [], plant, 2, 1)).toBe(false);
    expect(canPlace(home, [], plant, 10, 3)).toBe(false);
    expect(canPlace(home, [], plant, 5, 2)).toBe(false);
    expect(canPlace(home, [{ id: 1, item: 'f_plant', x: 2, y: 5 }], plant, 2, 5)).toBe(false);
    expect(canPlace(home, [{ id: 1, item: 'f_plant', x: 2, y: 5 }], plant, 2, 5, 1)).toBe(true);
  });

  it('lets rugs sit under objects, keeps big items in bounds, and hangs paintings on bare wall only', () => {
    expect(canPlace(home, [{ id: 1, item: 'f_plant', x: 2, y: 5 }], rug, 2, 5)).toBe(true);
    expect(canPlace(home, [], rug, 11, 5)).toBe(false);
    expect(canPlace(home, [], painting, 0, 1)).toBe(true);
    expect(canPlace(home, [], painting, 2, 1)).toBe(false); // a window
    expect(canPlace(home, [], painting, 0, 4)).toBe(false);
  });

  it('makes placed objects solid and placed armchairs sittable', () => {
    const grid = buildGrid(home, [
      { id: 1, item: 'f_plant', x: 2, y: 5 },
      { id: 2, item: 'f_armchair', x: 4, y: 6 },
      { id: 3, item: 'f_rug', x: 6, y: 6 },
    ]);
    expect(isWalkable(grid, 2, 5)).toBe(false);
    expect(seatAt(grid, 4, 6)).toBeDefined();
    expect(isWalkable(grid, 6, 6)).toBe(true);
  });
});

describe('catalog and protocol', () => {
  it('only accepts outfits made of owned or free pieces', () => {
    expect(outfitValid(DEFAULT_OUTFIT, {})).toBe(true);
    expect(outfitValid({ ...DEFAULT_OUTFIT, hat: 'hat_crown' }, {})).toBe(false);
    expect(outfitValid({ ...DEFAULT_OUTFIT, hat: 'hat_crown' }, { hat_crown: 1 })).toBe(true);
    expect(outfitValid({ ...DEFAULT_OUTFIT, hair: 'top_teal' }, {})).toBe(false);
    expect(outfitValid({ ...DEFAULT_OUTFIT, skin: 9 }, {})).toBe(false);
  });

  it('accepts well-formed messages', () => {
    expect(ClientMsgSchema.safeParse({ t: 'move', x: 3, y: 4 }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ t: 'focus_start', minutes: 25, label: 'essay' }).success).toBe(true);
    expect(ClientMsgSchema.safeParse({ t: 'join', target: { type: 'code', code: 'ABC234' } }).success).toBe(true);
  });

  it('rejects unknown, out-of-range and mistyped messages', () => {
    const bad = [
      { t: 'give_coins', amount: 999 },
      { t: 'move', x: -1, y: 2 },
      { t: 'move', x: 1.5, y: 2 },
      { t: 'move', x: '1', y: 2 },
      { t: 'focus_start', minutes: 1 },
      { t: 'focus_start', minutes: 100000 },
      { t: 'focus_start', minutes: 25, label: 'x'.repeat(200) },
      { t: 'emote', kind: 'insult' },
      { t: 'join', target: { type: 'admin' } },
      { t: 'hello', token: 'short' },
      { x: 1 },
      null,
      'move',
    ];
    for (const m of bad) expect(ClientMsgSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
  });
});
