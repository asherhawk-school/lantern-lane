import { ITEMS, type Outfit } from '../../../shared/src/catalog.ts';
import type { Member, Room } from './room.ts';

/**
 * Filler characters for quiet public rooms. They are plain room members flagged `bot: true`
 * (the client labels them), they earn nothing, and they step aside as real people arrive.
 * Each browser runs its own, so different players see different bots.
 */

const NAMES = ['Mochi', 'Pip', 'Juno', 'Tofu', 'Wren', 'Olive', 'Biscuit', 'Sol', 'Nori', 'Fig', 'Miso', 'Clover'];

interface Bot {
  m: Member;
  phase: 'walk' | 'focus' | 'rest' | 'leave';
  until: number;
}

interface BotState {
  bots: Bot[];
  nextSpawn: number;
  seq: number;
}

const states = new WeakMap<Room, BotState>();
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
const between = (a: number, b: number) => a + Math.random() * (b - a);

function randomOutfit(): Outfit {
  const ids = (kind: string) => ITEMS.filter((i) => i.kind === kind).map((i) => i.id);
  return {
    skin: Math.floor(Math.random() * 4),
    hair: pick(ids('hair')),
    hairColor: pick(ids('hairColor')),
    top: pick(ids('top')),
    hat: Math.random() < 0.3 ? pick(ids('hat')) : 'hat_none',
  };
}

function wanted(humans: number): number {
  if (humans === 0 || humans >= 6) return 0;
  return humans >= 3 ? 1 : 3;
}

function focusLength(timeScale: number): number {
  return (between(15, 45) * 60_000) / timeScale;
}

function spawn(room: Room, s: BotState, now: number, timeScale: number): void {
  const seat = pick(room.freeSeats());
  if (!seat) return;
  const used = new Set([...room.members.values()].map((m) => m.name));
  const name = pick(NAMES.filter((n) => !used.has(n)));
  if (!name) return;

  // The first couple appear already mid-session so a new arrival does not walk into an empty room.
  const settled = s.seq < 2;
  const m: Member = {
    id: `bot-${room.id}-${++s.seq}`,
    name,
    bot: true,
    outfit: randomOutfit(),
    path: [settled ? { x: seat.x, y: seat.y } : room.grid.spawn],
    pathStart: now,
    sitting: settled,
    focus: null,
    breakEndsAt: null,
    away: false,
    send: null,
  };
  const bot: Bot = { m, phase: 'walk', until: 0 };
  if (settled) {
    const length = focusLength(timeScale);
    const elapsed = between(0.1, 0.7) * length;
    m.focus = { startedAt: now - elapsed, endsAt: now - elapsed + length };
    bot.phase = 'focus';
  }
  room.add(m, now);
  if (!settled && !room.sit(m, seat.x, seat.y, now)) {
    room.remove(m.id, now);
    return;
  }
  s.bots.push(bot);
}

function step(room: Room, s: BotState, b: Bot, now: number, timeScale: number, surplus: boolean): void {
  const m = b.m;
  switch (b.phase) {
    case 'walk':
      if (!room.arrived(m, now)) return;
      m.focus = { startedAt: now, endsAt: now + focusLength(timeScale) };
      room.update(m, { focus: m.focus });
      b.phase = 'focus';
      return;
    case 'focus':
      if (!m.focus || now < m.focus.endsAt) return;
      room.broadcast({ t: 'done', id: m.id, minutes: Math.round(((m.focus.endsAt - m.focus.startedAt) * timeScale) / 60_000) });
      m.focus = null;
      room.update(m, { focus: null });
      b.phase = 'rest';
      b.until = now + between(4000, 12_000);
      return;
    case 'rest':
      if (now < b.until) return;
      if (!surplus && Math.random() < 0.5) {
        m.focus = { startedAt: now, endsAt: now + focusLength(timeScale) };
        room.update(m, { focus: m.focus });
        b.phase = 'focus';
      } else if (room.move(m, room.grid.spawn.x, room.grid.spawn.y, now)) {
        b.phase = 'leave';
      }
      return;
    case 'leave':
      if (!room.arrived(m, now)) return;
      room.remove(m.id, now);
      s.bots.splice(s.bots.indexOf(b), 1);
      return;
  }
}

/** Remove whichever bot is on (or heading for) this seat, because a real player took it. */
export function evictBotAt(room: Room, x: number, y: number, now: number): void {
  const s = states.get(room);
  if (!s) return;
  for (const b of [...s.bots]) {
    const t = room.finalTile(b.m);
    if (b.m.sitting && t.x === x && t.y === y) {
      room.remove(b.m.id, now);
      s.bots.splice(s.bots.indexOf(b), 1);
    }
  }
}

export function tickBots(room: Room, now: number, timeScale: number): void {
  if (room.access !== 'public') return;
  let s = states.get(room);
  if (!s) {
    s = { bots: [], nextSpawn: 0, seq: 0 };
    states.set(room, s);
  }
  const humans = room.humanCount();
  if (humans === 0) {
    for (const b of s.bots) room.members.delete(b.m.id);
    s.bots = [];
    s.seq = 0;
    return;
  }
  const want = wanted(humans);
  if (s.bots.length < want && now >= s.nextSpawn) {
    spawn(room, s, now, timeScale);
    s.nextSpawn = s.seq < 2 ? now : now + between(5000, 15_000);
  }
  const surplus = s.bots.length > want;
  for (const b of [...s.bots]) step(room, s, b, now, timeScale, surplus);
}
