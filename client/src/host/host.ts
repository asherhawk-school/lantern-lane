import { DEFAULT_OUTFIT, ITEM_BY_ID, ITEMS, outfitValid, type Inventory, type Item, type Outfit, type Placed } from '../../../shared/src/catalog.ts';
import { MAX_BREAK, MAX_FOCUS, MAX_FURNITURE_EACH, START_COINS } from '../../../shared/src/constants.ts';
import { checkName } from '../../../shared/src/names.ts';
import type { ClientMsg, FocusResult, FocusState, JoinTarget, PlayerPublic, SelfState, ServerMsg, Stats } from '../../../shared/src/protocol.ts';
import { applySession, currentStreak, dayKey, sessionCoins } from '../../../shared/src/rewards.ts';
import { ROOMS } from '../../../shared/src/rooms.ts';
import { canPlace, footprint, inBounds, isWalkable, seatAt, type RoomKind } from '../../../shared/src/tilemap.ts';
import { evictBotAt, tickBots } from './bots.ts';
import { Room, type Access, type Member } from './room.ts';
import { LayoutSchema, PeerMsgSchema, ROOT, type PeerMsg } from './wire.ts';

/**
 * The game's rules, running inside each player's own browser.
 *
 * The panels and canvas talk to this exactly as they would to a server (ClientMsg in, ServerMsg out).
 * Your own progress is kept in browser storage; other players are mirrored from what their browsers
 * publish through the relay. Nothing here needs the DOM, so it also runs under the test runner.
 */

/** Publish/subscribe transport. In the app this is MQTT; tests use an in-memory hub. */
export interface Relay {
  publish(topic: string, payload: string, retain?: boolean): void;
  subscribe(filter: string): void;
  unsubscribe(filter: string): void;
}

/** One string of saved data (localStorage in the app). */
export interface Store {
  get(): string | null;
  set(value: string): void;
}

export interface HostOptions {
  store: Store;
  relay: Relay;
  deliver: (msg: ServerMsg) => void;
  /** Session clocks run this many times faster. 1 in real use. */
  timeScale?: number;
  bots?: boolean;
}

interface SessionRow {
  endedAt: number;
  minutes: number;
  label: string;
  coins: number;
  day: string;
}

interface Active {
  startedAt: number;
  endsAt: number;
  minutes: number;
  label: string;
  roomKey: string;
}

interface Saved {
  id: string;
  name: string;
  coins: number;
  outfit: Outfit;
  inventory: Inventory;
  homeCode: string;
  homeLayout: Placed[];
  streak: number;
  lastDay: string | null;
  sessions: SessionRow[];
  active: Active | null;
}

interface PeerInfo {
  last: number;
  tokens: number;
  refilledAt: number;
  lastEmote: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_KIND: Record<string, RoomKind> = { C: 'cafe', L: 'library', H: 'home' };
const PEER_TIMEOUT_MS = 13_000;
const HEARTBEAT_TICKS = 4;
const MAX_PEERS = 24;
const MAX_SESSIONS_KEPT = 400;
const EMOTE_GAP_MS = 700;

const err = (code: string, msg: string): ServerMsg => ({ t: 'error', code, msg });
const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Six characters; the first says what kind of room it opens (Cafe, Library, Home). */
function makeCode(prefix: 'C' | 'L' | 'H'): string {
  const buf = new Uint8Array(5);
  crypto.getRandomValues(buf);
  return prefix + [...buf].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function starterOutfit(): Outfit {
  const free = (kind: Item['kind']) => ITEMS.filter((i) => i.kind === kind && i.price === 0).map((i) => i.id);
  return {
    skin: Math.floor(Math.random() * 4),
    hair: pick(free('hair')),
    hairColor: pick(free('hairColor')),
    top: pick(free('top')),
    hat: DEFAULT_OUTFIT.hat,
  };
}

function cleanLabel(label: string | undefined): string {
  return (label ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Other players may wear anything in the catalog; we only check the pieces exist. */
function outfitKnown(o: Outfit): boolean {
  const is = (id: string, kind: Item['kind']) => ITEM_BY_ID.get(id)?.kind === kind;
  return is(o.hair, 'hair') && is(o.hairColor, 'hairColor') && is(o.top, 'top') && is(o.hat, 'hat');
}

function loadSaved(store: Store): Saved | null {
  try {
    const raw = store.get();
    if (!raw) return null;
    const s = JSON.parse(raw) as Saved;
    if (typeof s.id !== 'string' || typeof s.name !== 'string' || typeof s.coins !== 'number') return null;
    s.inventory ??= {};
    s.homeLayout ??= [];
    s.sessions ??= [];
    s.active ??= null;
    if (!outfitValid(s.outfit, s.inventory)) s.outfit = { ...DEFAULT_OUTFIT };
    return s;
  } catch {
    return null;
  }
}

export class Host {
  room: Room | null = null;
  private p: Saved | null;
  private me: Member | null = null;
  /** When I claimed my current seat. */
  private satAt = 0;
  private peers = new Map<string, PeerInfo>();
  private pending: FocusResult | null = null;
  private store: Store;
  private relay: Relay;
  private deliver: (msg: ServerMsg) => void;
  private timeScale: number;
  private bots: boolean;
  private focusTimer: ReturnType<typeof setTimeout> | undefined;
  private breakTimer: ReturnType<typeof setTimeout> | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private ticks = 0;
  private lastEmote = 0;
  private lastAnswer = 0;

  constructor(opts: HostOptions) {
    this.store = opts.store;
    this.relay = opts.relay;
    this.deliver = opts.deliver;
    this.timeScale = opts.timeScale && opts.timeScale > 0 ? opts.timeScale : 1;
    this.bots = opts.bots ?? true;
    this.p = loadSaved(opts.store);

    // A session that ran out while the page was closed still counts.
    const a = this.p?.active;
    if (this.p && a) {
      if (Date.now() >= a.endsAt) this.pending = this.finish(this.p, a);
      else this.armFocusTimer(a);
    }
  }

  start(): void {
    this.ticker = setInterval(() => this.tick(), 1000);
  }

  /** Leave the room and stop all timers (page closing, or another tab took over). */
  stop(): void {
    clearInterval(this.ticker);
    clearTimeout(this.focusTimer);
    clearTimeout(this.breakTimer);
    this.leaveRoom();
  }

  // ---- saved progress ----

  private save(): void {
    if (this.p) this.store.set(JSON.stringify(this.p));
  }

  private tz(): number {
    return new Date().getTimezoneOffset();
  }

  private selfState(p: Saved): SelfState {
    return {
      id: p.id,
      name: p.name,
      coins: p.coins,
      outfit: p.outfit,
      inventory: p.inventory,
      homeCode: p.homeCode,
      streak: currentStreak(p.streak, p.lastDay, dayKey(Date.now(), this.tz())),
    };
  }

  private sendSelf(): void {
    if (this.p) this.deliver({ t: 'self', self: this.selfState(this.p) });
  }

  private stats(p: Saved): Stats {
    const now = Date.now();
    const tz = this.tz();
    const byDay = new Map<string, number>();
    let total = 0;
    for (const s of p.sessions) {
      total += s.minutes;
      byDay.set(s.day, (byDay.get(s.day) ?? 0) + s.minutes);
    }
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const day = dayKey(now - i * 86_400_000, tz);
      week.push({ day, minutes: byDay.get(day) ?? 0 });
    }
    const today = dayKey(now, tz);
    return {
      todayMinutes: byDay.get(today) ?? 0,
      totalMinutes: total,
      sessions: p.sessions.length,
      streak: currentStreak(p.streak, p.lastDay, today),
      week,
      recent: p.sessions
        .slice(-10)
        .reverse()
        .map((s) => ({ endedAt: s.endedAt, minutes: s.minutes, label: s.label, coins: s.coins })),
    };
  }

  // ---- talking to other browsers ----

  private topic(key: string, leaf: string): string {
    return `${ROOT}/${key}/${leaf}`;
  }

  private say(msg: PeerMsg): void {
    if (this.room && this.p) this.relay.publish(this.topic(this.room.id, this.p.id), JSON.stringify(msg));
  }

  private publishState(): void {
    const { room, me, p } = this;
    if (!room || !me || !p) return;
    const t = room.finalTile(me);
    this.say({
      k: 's',
      n: p.name,
      o: p.outfit,
      x: t.x,
      y: t.y,
      sit: me.sitting,
      at: this.satAt,
      f: me.focus ? [me.focus.startedAt, me.focus.endsAt] : null,
      b: me.breakEndsAt,
    });
  }

  private publishLayout(): void {
    const { room, p } = this;
    if (room && p && room.access === 'home' && room.ownerId === p.id) {
      this.relay.publish(this.topic(room.id, 'layout'), JSON.stringify({ items: p.homeLayout }), true);
    }
  }

  /** Call when the relay (re)connects: announce ourselves and ask who is here. */
  relayOnline(): void {
    if (!this.room) return;
    this.say({ k: 'q' });
    this.publishState();
    this.publishLayout();
  }

  /** Call for every message arriving from the relay. All of it is untrusted. */
  relayMessage(topic: string, payload: string): void {
    const { room, p, me } = this;
    if (!room || !p || !me) return;
    const prefix = `${ROOT}/${room.id}/`;
    if (!topic.startsWith(prefix) || payload.length > 8192) return;
    const sender = topic.slice(prefix.length);
    if (sender === p.id) return;

    let data: unknown;
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    const now = Date.now();

    if (sender === 'layout') {
      if (room.access !== 'home' || room.ownerId === p.id) return;
      const parsed = LayoutSchema.safeParse(data);
      if (!parsed.success) return;
      // Re-check every piece against the room rules rather than trusting the list.
      const accepted: Placed[] = [];
      for (const f of parsed.data.items) {
        const item = ITEM_BY_ID.get(f.item);
        if (item?.kind === 'furniture' && !accepted.some((a) => a.id === f.id) && canPlace(room.def, accepted, item, f.x, f.y)) accepted.push(f);
      }
      room.furniture = accepted;
      room.rebuild();
      this.deliver({ t: 'furniture', items: accepted });
      return;
    }

    if (!/^[0-9a-f]{12}$/.test(sender)) return;
    const parsed = PeerMsgSchema.safeParse(data);
    if (!parsed.success) return;

    let info = this.peers.get(sender);
    if (!info) {
      if (this.peers.size >= MAX_PEERS) return;
      info = { last: now, tokens: 30, refilledAt: now, lastEmote: 0 };
      this.peers.set(sender, info);
    }
    info.tokens = Math.min(30, info.tokens + ((now - info.refilledAt) / 1000) * 10);
    info.refilledAt = now;
    if (info.tokens < 1) return;
    info.tokens -= 1;
    info.last = now;

    const m = parsed.data;
    const peer = room.members.get(sender);
    switch (m.k) {
      case 's':
        return this.peerState(room, sender, peer, m, now);
      case 'q':
        // Answer, but not in a burst if several people ask at once.
        if (now - this.lastAnswer > 400) {
          this.lastAnswer = now;
          this.publishState();
        }
        return;
      case 'l':
        this.peers.delete(sender);
        room.remove(sender, now);
        return;
      case 'e':
        if (!peer || now - info.lastEmote < EMOTE_GAP_MS) return;
        info.lastEmote = now;
        room.broadcast({ t: 'emote', id: sender, kind: m.e });
        return;
      case 'd':
        if (peer) room.broadcast({ t: 'done', id: sender, minutes: m.m });
        return;
    }
  }

  private peerState(room: Room, id: string, peer: Member | undefined, m: Extract<PeerMsg, { k: 's' }>, now: number): void {
    const name = checkName(m.n);
    if (!name.ok || !inBounds(room.grid, m.x, m.y)) return;
    const outfit = outfitKnown(m.o) ? m.o : DEFAULT_OUTFIT;

    let focus: FocusState | null = null;
    if (m.f) {
      const [startedAt, endsAt] = m.f;
      const length = endsAt - startedAt;
      if (length > 0 && length <= MAX_FOCUS * 60_000 + 1000 && endsAt > now - 5000) focus = { startedAt, endsAt };
    }
    const onBreak = m.b !== null && m.b > now && m.b - now <= MAX_BREAK * 60_000 + 1000 ? m.b : null;

    const seat = m.sit && !!seatAt(room.grid, m.x, m.y);
    const spot = seat || isWalkable(room.grid, m.x, m.y) ? { x: m.x, y: m.y } : room.grid.spawn;
    if (seat) evictBotAt(room, spot.x, spot.y, now);

    if (!peer) {
      peer = { id, name: name.name, bot: false, outfit, path: [spot], pathStart: now, sitting: seat, focus, breakEndsAt: onBreak, away: false, send: null };
      room.add(peer, now);
    } else {
      const patch: Partial<PlayerPublic> = {};
      if (peer.name !== name.name) patch.name = peer.name = name.name;
      if (JSON.stringify(peer.outfit) !== JSON.stringify(outfit)) patch.outfit = peer.outfit = outfit;
      if (peer.focus?.endsAt !== focus?.endsAt) patch.focus = peer.focus = focus;
      if (peer.breakEndsAt !== onBreak) patch.breakEndsAt = peer.breakEndsAt = onBreak;
      if (Object.keys(patch).length) room.update(peer, patch);
      const t = room.finalTile(peer);
      if (t.x !== spot.x || t.y !== spot.y || peer.sitting !== seat) room.place(peer, spot.x, spot.y, seat, now);
    }
    if (seat) this.settleSeat(room, peer, m.at, now);
  }

  /** Two people clicked the same chair before hearing about each other: the earlier claim keeps it. */
  private settleSeat(room: Room, peer: Member, peerAt: number, now: number): void {
    const { me, p } = this;
    if (!me || !p || !me.sitting) return;
    const mine = room.finalTile(me);
    const theirs = room.finalTile(peer);
    if (mine.x !== theirs.x || mine.y !== theirs.y) return;

    const theyWin = peerAt < this.satAt || (peerAt === this.satAt && peer.id < p.id);
    if (!theyWin) return this.publishState();

    if (me.focus) {
      // Keep the session going from another chair.
      const free = room.freeSeats()[0];
      if (free) {
        this.satAt = now;
        room.place(me, free.x, free.y, true, now);
      }
    } else {
      me.sitting = false;
      const next = [
        { x: mine.x, y: mine.y + 1 },
        { x: mine.x - 1, y: mine.y },
        { x: mine.x + 1, y: mine.y },
        { x: mine.x, y: mine.y - 1 },
      ].find((t) => isWalkable(room.grid, t.x, t.y));
      room.place(me, next?.x ?? room.grid.spawn.x, next?.y ?? room.grid.spawn.y, false, now);
    }
    this.deliver(err('seat', 'Someone else got that seat first'));
    this.publishState();
  }

  // ---- rooms ----

  private describe(key: string, p: Saved): { kind: RoomKind; access: Access; code: string | null; ownerId: string | null; name: string } | null {
    if (key === 'pub-cafe') return { kind: 'cafe', access: 'public', code: null, ownerId: null, name: 'Cafe' };
    if (key === 'pub-library') return { kind: 'library', access: 'public', code: null, ownerId: null, name: 'Library' };
    const code = key.startsWith('c-') ? key.slice(2) : '';
    const kind = CODE_KIND[code[0]];
    if (!kind || code.length !== 6 || ![...code.slice(1)].every((ch) => CODE_ALPHABET.includes(ch))) return null;
    if (kind === 'home') {
      const mine = code === p.homeCode;
      return { kind, access: 'home', code, ownerId: mine ? p.id : 'friend', name: mine ? `${p.name}'s room` : "A friend's room" };
    }
    return { kind, access: 'private', code, ownerId: null, name: `Private ${ROOMS[kind].name}` };
  }

  private keyFor(p: Saved, target: JoinTarget): string | null {
    switch (target.type) {
      case 'public':
        return `pub-${target.kind}`;
      case 'create':
        return `c-${makeCode(target.kind === 'cafe' ? 'C' : 'L')}`;
      case 'home':
        return `c-${p.homeCode}`;
      case 'resume':
        return 'pub-cafe';
      case 'code': {
        const key = `c-${target.code.trim().toUpperCase()}`;
        return this.describe(key, p) ? key : null;
      }
    }
  }

  private leaveRoom(): void {
    const { room, p } = this;
    if (!room || !p) return;
    this.say({ k: 'l' });
    this.relay.unsubscribe(this.topic(room.id, '+'));
    clearTimeout(this.breakTimer);
    this.room = null;
    this.me = null;
    this.peers.clear();
  }

  private join(p: Saved, target: JoinTarget): void {
    const now = Date.now();
    const active = p.active;
    let key: string | null;
    if (active) {
      // A running session pins you to its room.
      if (this.room) return this.deliver(err('busy', 'Finish or give up your session before changing rooms'));
      key = this.describe(active.roomKey, p) ? active.roomKey : 'pub-cafe';
    } else {
      key = this.keyFor(p, target);
      if (!key) return this.deliver(err('join', 'No room has that code'));
      if (this.room?.id === key) return this.deliver({ t: 'room', room: this.room.snapshot(now) });
    }

    this.leaveRoom();
    const info = this.describe(key, p)!;
    const mine = info.access === 'home' && info.ownerId === p.id;
    const room = new Room({ id: key, def: ROOMS[info.kind], access: info.access, name: info.name, code: info.code, ownerId: info.ownerId, furniture: mine ? p.homeLayout : [], now });
    const me: Member = {
      id: p.id,
      name: p.name,
      bot: false,
      outfit: p.outfit,
      path: [room.spawnTile()],
      pathStart: now,
      sitting: false,
      focus: null,
      breakEndsAt: null,
      away: false,
      send: this.deliver,
    };
    this.satAt = 0;
    if (active) {
      const seat = room.freeSeats()[0];
      if (seat) {
        me.path = [{ x: seat.x, y: seat.y }];
        me.sitting = true;
        this.satAt = now;
      }
      me.focus = { startedAt: active.startedAt, endsAt: active.endsAt };
      active.roomKey = key;
    }
    room.add(me, now);
    this.room = room;
    this.me = me;
    this.deliver({ t: 'room', room: room.snapshot(now) });

    this.relay.subscribe(this.topic(key, '+'));
    this.relayOnline();
  }

  // ---- focus sessions ----

  private armFocusTimer(a: Active): void {
    clearTimeout(this.focusTimer);
    this.focusTimer = setTimeout(() => this.completeFocus(), Math.max(0, a.endsAt - Date.now()));
  }

  /** Award a finished session. The only place coins are added. */
  private finish(p: Saved, a: Active): FocusResult {
    const now = Date.now();
    const day = dayKey(now, this.tz());
    const st = applySession({ streak: p.streak, lastDay: p.lastDay }, day);
    const coins = sessionCoins(a.minutes, st.streak, st.firstOfDay);
    p.coins += coins.total;
    p.streak = st.streak;
    p.lastDay = st.lastDay;
    p.sessions.push({ endedAt: now, minutes: a.minutes, label: a.label, coins: coins.total, day });
    if (p.sessions.length > MAX_SESSIONS_KEPT) p.sessions.splice(0, p.sessions.length - MAX_SESSIONS_KEPT);
    p.active = null;
    this.save();
    return { minutes: a.minutes, coins: coins.total, bonus: coins.bonus, streak: st.streak, label: a.label };
  }

  private completeFocus(): void {
    const p = this.p;
    const a = p?.active;
    if (!p || !a || Date.now() < a.endsAt) return;
    clearTimeout(this.focusTimer);
    const result = this.finish(p, a);
    const { room, me } = this;
    if (room && me) {
      me.focus = null;
      room.update(me, { focus: null });
      room.broadcast({ t: 'done', id: p.id, minutes: a.minutes });
      this.say({ k: 'd', m: a.minutes });
      this.publishState();
    }
    this.sendSelf();
    this.deliver({ t: 'result', result });
  }

  private endBreak(announce: boolean): void {
    clearTimeout(this.breakTimer);
    const { room, me } = this;
    if (!room || !me || me.breakEndsAt === null) return;
    me.breakEndsAt = null;
    room.update(me, { breakEndsAt: null });
    this.publishState();
    if (announce) this.deliver({ t: 'break_done' });
  }

  private tick(): void {
    const now = Date.now();
    const { room, me, p } = this;
    // Timers in background tabs can fire late, so the clock is also checked here.
    if (p?.active && now >= p.active.endsAt) this.completeFocus();
    if (me && me.breakEndsAt !== null && now >= me.breakEndsAt) this.endBreak(true);
    if (!room) return;

    for (const [id, info] of this.peers) {
      if (now - info.last > PEER_TIMEOUT_MS) {
        this.peers.delete(id);
        room.remove(id, now);
      }
    }
    if (this.bots) tickBots(room, now, this.timeScale);
    if (++this.ticks % HEARTBEAT_TICKS === 0) this.publishState();
  }

  // ---- furniture ----

  private playersBlock(room: Room, item: Item, x: number, y: number, now: number): boolean {
    if ((item.layer ?? 'object') !== 'object') return false;
    const r = footprint(item, x, y);
    const inside = (t: { x: number; y: number }) => t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h;
    for (const m of room.members.values()) {
      if (inside(room.tileOf(m, now)) || inside(room.finalTile(m))) return true;
    }
    return false;
  }

  private commitFurniture(room: Room, p: Saved): void {
    room.rebuild();
    p.homeLayout = room.furniture;
    this.save();
    room.broadcast({ t: 'furniture', items: room.furniture });
    this.publishLayout();
  }

  // ---- requests from this browser's own panels and canvas ----

  handle(m: ClientMsg): void {
    const now = Date.now();
    if (m.t === 'ping') return;

    if (m.t === 'hello') {
      if (!this.p) {
        if (m.name === undefined) return this.deliver({ t: 'need_name', reason: null });
        const check = checkName(m.name);
        if (!check.ok) return this.deliver({ t: 'need_name', reason: check.reason });
        this.p = {
          id: randomHex(6),
          name: check.name,
          coins: START_COINS,
          outfit: starterOutfit(),
          inventory: {},
          homeCode: makeCode('H'),
          homeLayout: [],
          streak: 0,
          lastDay: null,
          sessions: [],
          active: null,
        };
        this.save();
      }
      const result = this.pending;
      this.pending = null;
      return this.deliver({ t: 'welcome', token: null, self: this.selfState(this.p), now, timeScale: this.timeScale, resume: !!this.p.active, result });
    }

    const p = this.p;
    if (!p) return this.deliver(err('auth', 'Pick a name first'));

    switch (m.t) {
      case 'join':
        return this.join(p, m.target);
      case 'stats':
        return this.deliver({ t: 'stats', stats: this.stats(p) });
      case 'buy': {
        const item = ITEM_BY_ID.get(m.item);
        if (!item || item.price <= 0) return this.deliver(err('shop', 'That is not for sale'));
        const have = p.inventory[item.id] ?? 0;
        if (item.kind !== 'furniture' && have > 0) return this.deliver(err('shop', 'You already own that'));
        if (item.kind === 'furniture' && have >= MAX_FURNITURE_EACH) return this.deliver(err('shop', `You can own at most ${MAX_FURNITURE_EACH} of those`));
        if (p.coins < item.price) return this.deliver(err('coins', 'Not enough coins yet'));
        p.coins -= item.price;
        p.inventory[item.id] = have + 1;
        this.save();
        return this.sendSelf();
      }
      case 'outfit': {
        if (!outfitValid(m.outfit, p.inventory)) return this.deliver(err('outfit', 'You do not own all of that'));
        p.outfit = m.outfit;
        this.save();
        if (this.room && this.me) {
          this.me.outfit = p.outfit;
          this.room.update(this.me, { outfit: p.outfit });
          this.publishState();
        }
        return this.sendSelf();
      }
      case 'rename': {
        const check = checkName(m.name);
        if (!check.ok) return this.deliver(err('name', check.reason));
        p.name = check.name;
        this.save();
        if (this.room && this.me) {
          this.me.name = p.name;
          this.room.update(this.me, { name: p.name });
          this.publishState();
        }
        return this.sendSelf();
      }
    }

    const { room, me } = this;
    if (!room || !me) return this.deliver(err('no_room', 'Join a room first'));

    switch (m.t) {
      case 'move':
        if (room.move(me, m.x, m.y, now)) this.publishState();
        return;
      case 'sit':
        if (room.sit(me, m.x, m.y, now)) {
          this.satAt = now;
          this.publishState();
        } else if (!me.focus) {
          this.deliver(err('seat', 'That seat is not free'));
        }
        return;
      case 'stand':
        if (room.stand(me, now)) this.publishState();
        return;
      case 'focus_start': {
        if (p.active) return;
        if (!me.sitting) return this.deliver(err('seat', 'Sit down first'));
        this.endBreak(false);
        const duration = Math.round((m.minutes * 60_000) / this.timeScale);
        p.active = { startedAt: now, endsAt: now + duration, minutes: m.minutes, label: cleanLabel(m.label), roomKey: room.id };
        this.save();
        this.armFocusTimer(p.active);
        me.focus = { startedAt: now, endsAt: now + duration };
        room.update(me, { focus: me.focus, breakEndsAt: null });
        this.publishState();
        return;
      }
      case 'focus_cancel':
        if (!p.active) return;
        clearTimeout(this.focusTimer);
        p.active = null;
        this.save();
        me.focus = null;
        room.update(me, { focus: null });
        this.publishState();
        return;
      case 'break_start': {
        if (me.focus) return;
        const duration = Math.round((m.minutes * 60_000) / this.timeScale);
        clearTimeout(this.breakTimer);
        me.breakEndsAt = now + duration;
        room.update(me, { breakEndsAt: me.breakEndsAt });
        this.breakTimer = setTimeout(() => this.endBreak(true), duration);
        this.publishState();
        return;
      }
      case 'break_cancel':
        this.endBreak(false);
        return;
      case 'emote':
        if (now - this.lastEmote < EMOTE_GAP_MS) return;
        this.lastEmote = now;
        room.broadcast({ t: 'emote', id: p.id, kind: m.kind });
        this.say({ k: 'e', e: m.kind });
        return;
    }

    // Everything below edits furniture, which only a room's owner may do.
    if (room.access !== 'home' || room.ownerId !== p.id) return this.deliver(err('home', 'Only the owner can decorate this room'));

    switch (m.t) {
      case 'place': {
        const item = ITEM_BY_ID.get(m.item);
        if (!item || item.kind !== 'furniture') return;
        const placed = room.furniture.filter((f) => f.item === item.id).length;
        if ((p.inventory[item.id] ?? 0) <= placed) return this.deliver(err('inv', 'You have none of those left to place'));
        if (!canPlace(room.def, room.furniture, item, m.x, m.y) || this.playersBlock(room, item, m.x, m.y, now)) {
          return this.deliver(err('place', 'That does not fit there'));
        }
        const id = room.furniture.reduce((max, f) => Math.max(max, f.id), 0) + 1;
        room.furniture.push({ id, item: item.id, x: m.x, y: m.y });
        return this.commitFurniture(room, p);
      }
      case 'move_item':
      case 'remove_item': {
        const index = room.furniture.findIndex((f) => f.id === m.id);
        const f = room.furniture[index];
        const item = f && ITEM_BY_ID.get(f.item);
        if (!f || !item) return;
        if (item.seat && room.seatTaken(f.x, f.y)) return this.deliver(err('place', 'Someone is sitting there'));
        if (m.t === 'remove_item') {
          room.furniture.splice(index, 1);
        } else {
          if (!canPlace(room.def, room.furniture, item, m.x, m.y, f.id) || this.playersBlock(room, item, m.x, m.y, now)) {
            return this.deliver(err('place', 'That does not fit there'));
          }
          f.x = m.x;
          f.y = m.y;
        }
        return this.commitFurniture(room, p);
      }
    }
  }
}
