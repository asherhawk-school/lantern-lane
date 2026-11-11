import { STEP_MS } from '../../../shared/src/constants.ts';
import type { Outfit, Placed } from '../../../shared/src/catalog.ts';
import { findPath } from '../../../shared/src/pathfinding.ts';
import type { FocusState, PlayerPublic, RoomSnapshot, ServerMsg } from '../../../shared/src/protocol.ts';
import { buildGrid, isWalkable, seatAt, type Grid, type RoomDef, type Seat, type Tile } from '../../../shared/src/tilemap.ts';

export type Access = 'public' | 'private' | 'home';

export interface Member {
  id: string;
  name: string;
  bot: boolean;
  outfit: Outfit;
  /** Tiles from where the current walk began to where it ends. A lone tile means standing still. */
  path: Tile[];
  /** Server time at which the avatar is on path[0]. */
  pathStart: number;
  sitting: boolean;
  focus: FocusState | null;
  breakEndsAt: number | null;
  away: boolean;
  send: ((msg: ServerMsg) => void) | null;
}

export interface RoomInit {
  id: string;
  def: RoomDef;
  access: Access;
  name: string;
  code?: string | null;
  ownerId?: string | null;
  furniture?: Placed[];
  now: number;
}

export class Room {
  id: string;
  def: RoomDef;
  access: Access;
  name: string;
  code: string | null;
  ownerId: string | null;
  furniture: Placed[];
  grid: Grid;
  members = new Map<string, Member>();
  /** When the last human left; used to clean up idle rooms. */
  emptySince: number | null;

  constructor(init: RoomInit) {
    this.id = init.id;
    this.def = init.def;
    this.access = init.access;
    this.name = init.name;
    this.code = init.code ?? null;
    this.ownerId = init.ownerId ?? null;
    this.furniture = init.furniture ?? [];
    this.grid = buildGrid(this.def, this.furniture);
    this.emptySince = init.now;
  }

  rebuild(): void {
    this.grid = buildGrid(this.def, this.furniture);
  }

  humanCount(): number {
    let n = 0;
    for (const m of this.members.values()) if (!m.bot) n++;
    return n;
  }

  broadcast(msg: ServerMsg, exceptId?: string): void {
    for (const m of this.members.values()) {
      if (m.send && m.id !== exceptId) m.send(msg);
    }
  }

  posIndex(m: Member, now: number): number {
    const i = Math.floor((now - m.pathStart) / STEP_MS);
    return Math.max(0, Math.min(m.path.length - 1, i));
  }

  tileOf(m: Member, now: number): Tile {
    return m.path[this.posIndex(m, now)];
  }

  finalTile(m: Member): Tile {
    return m.path[m.path.length - 1];
  }

  arrived(m: Member, now: number): boolean {
    return this.posIndex(m, now) === m.path.length - 1;
  }

  toPublic(m: Member, now: number): PlayerPublic {
    const rest = m.path.slice(this.posIndex(m, now));
    return {
      id: m.id,
      name: m.name,
      bot: m.bot,
      x: rest[0].x,
      y: rest[0].y,
      path: rest.slice(1).map((t) => [t.x, t.y]),
      sitting: m.sitting,
      outfit: m.outfit,
      focus: m.focus,
      breakEndsAt: m.breakEndsAt,
      away: m.away,
    };
  }

  snapshot(now: number): RoomSnapshot {
    return {
      id: this.id,
      kind: this.def.kind,
      name: this.name,
      access: this.access,
      code: this.code,
      ownerId: this.ownerId,
      players: [...this.members.values()].map((m) => this.toPublic(m, now)),
      furniture: this.furniture,
    };
  }

  add(m: Member, now: number): void {
    this.members.set(m.id, m);
    if (!m.bot) this.emptySince = null;
    this.broadcast({ t: 'join', p: this.toPublic(m, now) }, m.id);
  }

  remove(id: string, now: number): void {
    if (!this.members.delete(id)) return;
    this.broadcast({ t: 'leave', id });
    if (this.humanCount() === 0 && this.emptySince === null) this.emptySince = now;
  }

  update(m: Member, patch: Partial<PlayerPublic>): void {
    this.broadcast({ t: 'upd', id: m.id, patch });
  }

  seatTaken(x: number, y: number, exceptId?: string): boolean {
    for (const m of this.members.values()) {
      if (m.id === exceptId || !m.sitting) continue;
      const t = this.finalTile(m);
      if (t.x === x && t.y === y) return true;
    }
    return false;
  }

  freeSeats(): Seat[] {
    return this.grid.seats.filter((s) => !this.seatTaken(s.x, s.y));
  }

  /** A walkable tile at or next to the door, so arrivals do not all stack on one spot. */
  spawnTile(): Tile {
    const { spawn } = this.grid;
    const options = [spawn, { x: spawn.x - 1, y: spawn.y }, { x: spawn.x + 1, y: spawn.y }, { x: spawn.x, y: spawn.y + 1 }].filter((t) =>
      isWalkable(this.grid, t.x, t.y),
    );
    return options.length ? options[Math.floor(Math.random() * options.length)] : spawn;
  }

  /** Re-route from wherever the avatar is (finishing the step it is mid-way through first). */
  private route(m: Member, to: Tile, now: number, seatGoal: boolean): boolean {
    const i = this.posIndex(m, now);
    const last = m.path.length - 1;
    const midStep = i < last;
    const start = midStep ? m.path[i + 1] : m.path[last];
    const startAt = midStep ? m.pathStart + (i + 1) * STEP_MS : now;
    const path = findPath(this.grid, start, to, seatGoal);
    if (!path) return false;
    m.path = path;
    m.pathStart = startAt;
    return true;
  }

  private announceMove(m: Member): void {
    this.broadcast({ t: 'moved', id: m.id, path: m.path.map((t) => [t.x, t.y]), sitting: m.sitting });
  }

  /** Put a remote player where their own browser says they are: walk there if a route exists, else jump. */
  place(m: Member, x: number, y: number, sitting: boolean, now: number): void {
    const seat = sitting && !!seatAt(this.grid, x, y);
    if (!this.route(m, { x, y }, now, seat)) {
      m.path = [{ x, y }];
      m.pathStart = now;
    }
    m.sitting = seat;
    this.announceMove(m);
  }

  move(m: Member, x: number, y: number, now: number): boolean {
    if (m.focus) return false;
    if (!this.route(m, { x, y }, now, false)) return false;
    m.sitting = false;
    this.announceMove(m);
    return true;
  }

  sit(m: Member, x: number, y: number, now: number): boolean {
    if (m.focus) return false;
    if (!seatAt(this.grid, x, y) || this.seatTaken(x, y, m.id)) return false;
    if (!this.route(m, { x, y }, now, true)) return false;
    m.sitting = true;
    this.announceMove(m);
    return true;
  }

  stand(m: Member, now: number): boolean {
    if (!m.sitting || m.focus) return false;
    const t = this.finalTile(m);
    const next = [
      { x: t.x, y: t.y + 1 },
      { x: t.x - 1, y: t.y },
      { x: t.x + 1, y: t.y },
      { x: t.x, y: t.y - 1 },
    ].find((n) => isWalkable(this.grid, n.x, n.y));
    if (!next) return false;
    return this.move(m, next.x, next.y, now);
  }
}
