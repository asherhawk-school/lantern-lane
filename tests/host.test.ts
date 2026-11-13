import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMsg, ServerMsg } from '../shared/src/protocol.ts';
import { Host, type Relay } from '../client/src/host/host.ts';
import { ROOT } from '../client/src/host/wire.ts';

type Of<T extends ServerMsg['t']> = Extract<ServerMsg, { t: T }>;

/** Stands in for the public relay: delivers each publish to every subscriber, and keeps retained messages. */
class Hub {
  private clients = new Set<{ filters: Set<string>; host: () => Host | null }>();
  private retained = new Map<string, string>();
  log: { topic: string; payload: string }[] = [];

  private matches(filter: string, topic: string): boolean {
    return filter.endsWith('/+') && topic.startsWith(filter.slice(0, -1)) && !topic.slice(filter.length - 1).includes('/');
  }

  publish(topic: string, payload: string, retain = false): void {
    this.log.push({ topic, payload });
    if (retain) this.retained.set(topic, payload);
    for (const c of [...this.clients]) {
      if ([...c.filters].some((f) => this.matches(f, topic))) c.host()?.relayMessage(topic, payload);
    }
  }

  relay(host: () => Host | null): Relay & { drop(): void } {
    const me = { filters: new Set<string>(), host };
    this.clients.add(me);
    return {
      publish: (topic, payload, retain) => this.publish(topic, payload, retain),
      subscribe: (filter) => {
        me.filters.add(filter);
        for (const [topic, payload] of this.retained) if (this.matches(filter, topic)) host()?.relayMessage(topic, payload);
      },
      unsubscribe: (filter) => void me.filters.delete(filter),
      drop: () => void this.clients.delete(me),
    };
  }
}

/** One player's browser: saved data, a host, and everything the host told the interface. */
function browser(hub: Hub, opts: { saved?: { value: string | null }; timeScale?: number; bots?: boolean } = {}) {
  const saved = opts.saved ?? { value: null };
  const out: ServerMsg[] = [];
  let host: Host | null = null;
  const relay = hub.relay(() => host);
  host = new Host({
    store: { get: () => saved.value, set: (v) => (saved.value = v) },
    relay,
    deliver: (m) => out.push(m),
    timeScale: opts.timeScale,
    bots: opts.bots ?? false,
  });
  host.start();
  const h = host;
  return {
    out,
    saved,
    host: h,
    send: (m: ClientMsg) => h.handle(m),
    all: <T extends ServerMsg['t']>(t: T) => out.filter((m) => m.t === t) as Of<T>[],
    last: <T extends ServerMsg['t']>(t: T) => out.filter((m) => m.t === t).at(-1) as Of<T> | undefined,
    clear: () => {
      out.length = 0;
    },
    /** Close the tab politely. */
    close: () => {
      h.stop();
      relay.drop();
    },
    /** Lose the connection without saying goodbye. */
    vanish: () => {
      relay.drop();
      clearInterval((h as unknown as { ticker: ReturnType<typeof setInterval> }).ticker);
    },
  };
}

const MIN = 60_000;
const SEAT = { x: 3, y: 5 };
const OTHER_SEAT = { x: 5, y: 5 };
const CAFE = { t: 'join', target: { type: 'public', kind: 'cafe' } } as const;

let hub: Hub;
let open: ReturnType<typeof browser>[];

function player(name: string, opts: Parameters<typeof browser>[1] = {}) {
  const b = browser(hub, opts);
  open.push(b);
  b.send({ t: 'hello', name });
  const id = b.last('welcome')!.self.id;
  return { ...b, id };
}

function seated(name: string, seat = SEAT) {
  const b = player(name);
  b.send(CAFE);
  b.send({ t: 'sit', x: seat.x, y: seat.y });
  return b;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-03-10T10:00:00Z'));
  hub = new Hub();
  open = [];
});

afterEach(() => {
  for (const b of open) b.host.stop();
  vi.useRealTimers();
});

describe('starting out', () => {
  it('asks for a name, rejects bad ones, and creates a player with starting coins', () => {
    const b = browser(hub);
    open.push(b);
    b.send({ t: 'hello' });
    expect(b.last('need_name')).toBeDefined();
    b.send({ t: 'hello', name: 'x' });
    expect(b.last('need_name')?.reason).toMatch(/at least 2/);
    b.send({ t: 'hello', name: '<script>' });
    expect(b.last('need_name')?.reason).toMatch(/letters/);
    b.send({ t: 'hello', name: 'Ada' });
    const self = b.last('welcome')!.self;
    expect(self).toMatchObject({ name: 'Ada', coins: 20, streak: 0 });
    expect(self.homeCode).toMatch(/^H[A-Z2-9]{5}$/);
  });

  it('remembers the player in browser storage', () => {
    const a = player('Ada');
    a.close();
    const again = browser(hub, { saved: a.saved });
    open.push(again);
    again.send({ t: 'hello' });
    expect(again.last('welcome')?.self).toMatchObject({ id: a.id, name: 'Ada' });
  });

  it('starts fresh if the saved data is corrupt', () => {
    const b = browser(hub, { saved: { value: '{not json' } });
    open.push(b);
    b.send({ t: 'hello' });
    expect(b.last('need_name')).toBeDefined();
  });
});

describe('seeing each other', () => {
  it('shows two players in the same room to each other, with name and outfit', () => {
    const a = player('Ada');
    a.send(CAFE);
    const b = player('Bo');
    b.send(CAFE);
    expect(a.last('join')?.p).toMatchObject({ id: b.id, name: 'Bo', bot: false });
    expect(b.last('join')?.p).toMatchObject({ id: a.id, name: 'Ada' });
    expect(a.last('join')?.p.outfit).toEqual(b.last('welcome')?.self.outfit);
  });

  it('keeps players in different rooms apart', () => {
    const a = player('Ada');
    a.send(CAFE);
    const b = player('Bo');
    b.send({ t: 'join', target: { type: 'public', kind: 'library' } });
    expect(a.all('join')).toHaveLength(0);
    expect(b.all('join')).toHaveLength(0);
  });

  it('mirrors walking, sitting, focusing, finishing and emotes', () => {
    const a = player('Ada');
    const b = player('Bo');
    a.send(CAFE);
    b.send(CAFE);
    b.clear();

    a.send({ t: 'move', x: 6, y: 8 });
    expect(b.last('moved')).toMatchObject({ id: a.id, sitting: false });
    expect(b.last('moved')?.path.at(-1)).toEqual([6, 8]);

    a.send({ t: 'sit', x: SEAT.x, y: SEAT.y });
    expect(b.last('moved')).toMatchObject({ id: a.id, sitting: true });
    expect(b.last('moved')?.path.at(-1)).toEqual([SEAT.x, SEAT.y]);

    a.send({ t: 'focus_start', minutes: 25 });
    const focus = b.last('upd')!.patch.focus!;
    expect(focus.endsAt - focus.startedAt).toBe(25 * MIN);

    a.send({ t: 'emote', kind: 'wave' });
    expect(b.last('emote')).toEqual({ t: 'emote', id: a.id, kind: 'wave' });

    vi.advanceTimersByTime(25 * MIN);
    expect(b.last('done')).toEqual({ t: 'done', id: a.id, minutes: 25 });
    expect(b.last('upd')).toMatchObject({ id: a.id, patch: { focus: null } });
    expect(b.last('result')).toBeUndefined();
  });

  it('shows outfit and name changes', () => {
    const a = player('Ada');
    const b = player('Bo');
    a.send(CAFE);
    b.send(CAFE);
    a.send({ t: 'rename', name: 'Ada L' });
    expect(b.last('upd')).toMatchObject({ id: a.id, patch: { name: 'Ada L' } });
    const skin = (a.last('self')!.self.outfit.skin + 1) % 4; // always a change, whatever the random starting skin
    a.send({ t: 'outfit', outfit: { ...a.last('self')!.self.outfit, skin } });
    expect(b.last('upd')).toMatchObject({ id: a.id, patch: { outfit: { skin } } });
  });

  it('removes a player who leaves, and one who silently disappears', () => {
    const a = player('Ada');
    const b = player('Bo');
    const c = player('Cy');
    a.send(CAFE);
    b.send(CAFE);
    c.send(CAFE);

    b.close();
    expect(a.last('leave')?.id).toBe(b.id);

    c.vanish();
    vi.advanceTimersByTime(10_000);
    expect(a.all('leave').some((l) => l.id === c.id)).toBe(false);
    vi.advanceTimersByTime(6000);
    expect(a.all('leave').some((l) => l.id === c.id)).toBe(true);
  });

  it('tells others when you switch rooms', () => {
    const a = player('Ada');
    const b = player('Bo');
    a.send(CAFE);
    b.send(CAFE);
    b.send({ t: 'join', target: { type: 'public', kind: 'library' } });
    expect(a.last('leave')?.id).toBe(b.id);
    expect(b.last('room')?.room.kind).toBe('library');
  });
});

describe('seats', () => {
  it('refuses a seat someone already has', () => {
    const a = seated('Ada');
    const b = seated('Bo');
    expect(b.last('error')?.code).toBe('seat');
    expect(a.last('error')).toBeUndefined();
  });

  it('settles a simultaneous grab in favour of whoever clicked first', () => {
    // Neither browser hears the other until both have already sat down.
    const a = player('Ada');
    const b = player('Bo');
    a.send(CAFE);
    b.send(CAFE);
    const quiet = vi.spyOn(hub, 'publish').mockImplementation(() => {});
    a.send({ t: 'sit', x: SEAT.x, y: SEAT.y });
    vi.advanceTimersByTime(50);
    b.send({ t: 'sit', x: SEAT.x, y: SEAT.y });
    quiet.mockRestore();

    vi.advanceTimersByTime(5000); // heartbeats carry the news
    expect(b.last('error')?.msg).toMatch(/got that seat first/);
    expect(a.last('error')).toBeUndefined();
    const boSeenByAda = a.all('moved').filter((m) => m.id === b.id).at(-1)!;
    expect(boSeenByAda.sitting).toBe(false);
    const adaSeenByBo = b.all('moved').filter((m) => m.id === a.id).at(-1)!;
    expect(adaSeenByBo).toMatchObject({ sitting: true });
    expect(adaSeenByBo.path.at(-1)).toEqual([SEAT.x, SEAT.y]);
  });

  it('frees the seat when its occupant stands up', () => {
    const a = seated('Ada');
    a.send({ t: 'stand' });
    const b = seated('Bo');
    expect(b.last('error')).toBeUndefined();
  });
});

describe('focus sessions', () => {
  it('will not start one for someone who is standing', () => {
    const a = player('Ada');
    a.send(CAFE);
    a.send({ t: 'focus_start', minutes: 25 });
    expect(a.last('error')?.code).toBe('seat');
  });

  it('pays coins only when the clock runs out', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 25, label: 'Essay draft' });
    vi.advanceTimersByTime(25 * MIN - 1000);
    expect(a.last('result')).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(a.last('result')?.result).toEqual({ minutes: 25, coins: 27, bonus: 2, streak: 1, label: 'Essay draft' });
    expect(a.last('self')?.self).toMatchObject({ coins: 47, streak: 1 });
  });

  it('gives the streak bonus once per day and grows it the next day', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 10 });
    vi.advanceTimersByTime(10 * MIN);
    a.send({ t: 'focus_start', minutes: 10 });
    vi.advanceTimersByTime(10 * MIN);
    expect(a.last('result')?.result).toMatchObject({ coins: 10, bonus: 0, streak: 1 });
    vi.advanceTimersByTime(24 * 60 * MIN);
    a.send({ t: 'focus_start', minutes: 10 });
    vi.advanceTimersByTime(10 * MIN);
    expect(a.last('result')?.result).toMatchObject({ coins: 14, bonus: 4, streak: 2 });
  });

  it('pays nothing for a session that is given up', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 25 });
    vi.advanceTimersByTime(20 * MIN);
    a.send({ t: 'focus_cancel' });
    vi.advanceTimersByTime(60 * MIN);
    expect(a.last('result')).toBeUndefined();
    a.send({ t: 'stats' });
    expect(a.last('stats')?.stats).toMatchObject({ sessions: 0, totalMinutes: 0 });
  });

  it('keeps a focusing player in their seat and room', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 25 });
    a.clear();
    a.send({ t: 'move', x: 6, y: 8 });
    a.send({ t: 'stand' });
    a.send({ t: 'join', target: { type: 'public', kind: 'library' } });
    expect(a.all('moved')).toHaveLength(0);
    expect(a.last('room')).toBeUndefined();
    expect(a.last('error')?.code).toBe('busy');
  });

  it('records finished sessions in stats', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 30, label: 'Reading' });
    vi.advanceTimersByTime(30 * MIN);
    a.send({ t: 'stats' });
    const s = a.last('stats')!.stats;
    expect(s).toMatchObject({ todayMinutes: 30, totalMinutes: 30, sessions: 1, streak: 1 });
    expect(s.week).toHaveLength(7);
    expect(s.week.at(-1)?.minutes).toBe(30);
    expect(s.recent[0]).toMatchObject({ minutes: 30, label: 'Reading', coins: 32 });
  });

  it('runs sessions faster when the clock is scaled, for testing', () => {
    const b = browser(hub, { timeScale: 60 });
    open.push(b);
    b.send({ t: 'hello', name: 'Ada' });
    b.send(CAFE);
    b.send({ t: 'sit', x: SEAT.x, y: SEAT.y });
    b.send({ t: 'focus_start', minutes: 25 });
    vi.advanceTimersByTime(24_000);
    expect(b.last('result')).toBeUndefined();
    vi.advanceTimersByTime(1000);
    expect(b.last('result')?.result.minutes).toBe(25);
  });

  it('runs a break timer and announces when it ends', () => {
    const a = seated('Ada');
    a.send({ t: 'break_start', minutes: 5 });
    expect(a.last('upd')?.patch.breakEndsAt).toBe(Date.now() + 5 * MIN);
    vi.advanceTimersByTime(5 * MIN);
    expect(a.last('break_done')).toBeDefined();
    expect(a.last('upd')?.patch.breakEndsAt).toBeNull();
  });
});

describe('closing and reopening the page', () => {
  it('puts you back in your session if it is still running', () => {
    const a = seated('Ada');
    const watcher = seated('Bo', OTHER_SEAT);
    a.send({ t: 'focus_start', minutes: 25 });
    vi.advanceTimersByTime(10 * MIN);
    a.close();

    vi.advanceTimersByTime(5 * MIN);
    const back = browser(hub, { saved: a.saved });
    open.push(back);
    back.send({ t: 'hello' });
    expect(back.last('welcome')?.resume).toBe(true);
    back.send({ t: 'join', target: { type: 'resume' } });
    const me = back.last('room')!.room.players.find((p) => p.id === a.id)!;
    expect(me.sitting).toBe(true);
    expect(me.focus).not.toBeNull();
    expect(watcher.last('join')?.p).toMatchObject({ id: a.id, sitting: true });

    vi.advanceTimersByTime(10 * MIN);
    expect(back.last('result')?.result.coins).toBe(27);
  });

  it('still pays a session that ran out while the page was closed, once', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 25 });
    a.close();
    vi.advanceTimersByTime(3 * 60 * MIN);

    const back = browser(hub, { saved: a.saved });
    open.push(back);
    back.send({ t: 'hello' });
    const w = back.last('welcome')!;
    expect(w.resume).toBe(false);
    expect(w.result).toMatchObject({ minutes: 25, coins: 27 });
    expect(w.self.coins).toBe(47);
    back.close();

    const third = browser(hub, { saved: back.saved });
    open.push(third);
    third.send({ t: 'hello' });
    expect(third.last('welcome')).toMatchObject({ result: null, self: { coins: 47 } });
  });

  it('keeps coins, outfit and furniture', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 50 });
    vi.advanceTimersByTime(50 * MIN);
    a.send({ t: 'buy', item: 'f_plant' });
    a.send({ t: 'outfit', outfit: { ...a.last('self')!.self.outfit, skin: 2 } });
    a.send({ t: 'join', target: { type: 'home' } });
    a.send({ t: 'place', item: 'f_plant', x: 2, y: 5 });
    a.close();

    const back = browser(hub, { saved: a.saved });
    open.push(back);
    back.send({ t: 'hello' });
    expect(back.last('welcome')?.self).toMatchObject({ coins: 20 + 52 - 30, inventory: { f_plant: 1 } });
    expect(back.last('welcome')?.self.outfit.skin).toBe(2);
    back.send({ t: 'join', target: { type: 'home' } });
    expect(back.last('room')?.room.furniture).toEqual([{ id: 1, item: 'f_plant', x: 2, y: 5 }]);
  });
});

describe('private rooms and homes', () => {
  it('creates private rooms that friends join by code', () => {
    const a = player('Ada');
    a.send({ t: 'join', target: { type: 'create', kind: 'library' } });
    const room = a.last('room')!.room;
    expect(room).toMatchObject({ kind: 'library', access: 'private' });
    expect(room.code).toMatch(/^L[A-Z2-9]{5}$/);

    const b = player('Bo');
    b.send({ t: 'join', target: { type: 'code', code: room.code!.toLowerCase() } });
    expect(b.last('room')?.room).toMatchObject({ id: room.id, kind: 'library' });
    expect(a.last('join')?.p.name).toBe('Bo');

    const c = player('Cy');
    c.send({ t: 'join', target: { type: 'code', code: 'ZZZZZZ' } });
    expect(c.last('error')?.code).toBe('join');
    expect(c.last('room')).toBeUndefined();
  });

  it('lets only the owner decorate, within what they own and where it fits', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 120 });
    vi.advanceTimersByTime(120 * MIN);
    a.send({ t: 'buy', item: 'f_plant' });
    a.send({ t: 'join', target: { type: 'home' } });
    expect(a.last('room')?.room).toMatchObject({ kind: 'home', ownerId: a.id });

    const b = player('Bo');
    b.send({ t: 'join', target: { type: 'code', code: a.last('self')!.self.homeCode } });
    expect(b.last('room')?.room).toMatchObject({ kind: 'home', access: 'home' });
    expect(b.last('room')?.room.ownerId).not.toBe(b.id);

    b.send({ t: 'place', item: 'f_plant', x: 2, y: 5 });
    expect(b.last('error')?.code).toBe('home');

    a.send({ t: 'place', item: 'f_plant', x: 10, y: 3 }); // on the desk
    expect(a.last('error')?.code).toBe('place');
    a.send({ t: 'place', item: 'f_plant', x: 2, y: 5 });
    expect(b.last('furniture')?.items).toEqual([{ id: 1, item: 'f_plant', x: 2, y: 5 }]);
    a.send({ t: 'place', item: 'f_plant', x: 4, y: 5 }); // only owns one
    expect(a.last('error')?.code).toBe('inv');

    a.send({ t: 'move_item', id: 1, x: 6, y: 6 });
    expect(b.last('furniture')?.items).toEqual([{ id: 1, item: 'f_plant', x: 6, y: 6 }]);
    a.send({ t: 'remove_item', id: 1 });
    expect(b.last('furniture')?.items).toEqual([]);
  });

  it('shows a home to visitors even when its owner is away', () => {
    const a = seated('Ada');
    a.send({ t: 'focus_start', minutes: 60 });
    vi.advanceTimersByTime(60 * MIN);
    a.send({ t: 'buy', item: 'f_plant' });
    a.send({ t: 'join', target: { type: 'home' } });
    a.send({ t: 'place', item: 'f_plant', x: 2, y: 5 });
    const code = a.last('self')!.self.homeCode;
    a.close();

    const b = player('Bo');
    b.send({ t: 'join', target: { type: 'code', code } });
    expect(b.last('furniture')?.items).toEqual([{ id: 1, item: 'f_plant', x: 2, y: 5 }]);
  });
});

describe('shop', () => {
  it('sells only what the player can afford, and clothes only once', () => {
    const a = player('Ada');
    a.send({ t: 'buy', item: 'f_bed' });
    expect(a.last('error')?.code).toBe('coins');
    a.send({ t: 'buy', item: 'top_teal' });
    expect(a.last('error')?.code).toBe('shop');

    const b = seated('Bo');
    b.send({ t: 'focus_start', minutes: 120 });
    vi.advanceTimersByTime(120 * MIN);
    b.send({ t: 'buy', item: 'hat_cap' });
    expect(b.last('self')?.self).toMatchObject({ coins: 20 + 122 - 50, inventory: { hat_cap: 1 } });
    b.send({ t: 'buy', item: 'hat_cap' });
    expect(b.last('error')?.msg).toMatch(/already own/);
    b.send({ t: 'outfit', outfit: { ...b.last('self')!.self.outfit, hat: 'hat_crown' } });
    expect(b.last('error')?.code).toBe('outfit');
  });
});

describe('untrusted messages from the relay', () => {
  function watcher() {
    const a = player('Ada');
    a.send(CAFE);
    a.clear();
    const topic = (id: string) => `${ROOT}/pub-cafe/${id}`;
    const state = (over: object = {}) =>
      JSON.stringify({ k: 's', n: 'Mallory', o: a.last('welcome')?.self.outfit ?? { skin: 0, hair: 'hair_short', hairColor: 'hc_brown', top: 'top_teal', hat: 'hat_none' }, x: 6, y: 8, sit: false, at: 0, f: null, b: null, ...over });
    return { a, topic, state };
  }
  const PEER = 'abcdef012345';

  it('ignores garbage, unknown message kinds and malformed senders', () => {
    const { a, topic, state } = watcher();
    hub.publish(topic(PEER), 'not json');
    hub.publish(topic(PEER), '{"k":"give_coins","amount":9999}');
    hub.publish(topic(PEER), JSON.stringify({ k: 's', n: 'Mallory' }));
    hub.publish(topic('../../etc'), state());
    hub.publish(topic('NOT-HEX-ID!!'), state());
    hub.publish(topic(PEER), 'x'.repeat(20_000));
    expect(a.out).toEqual([]);
  });

  it('refuses bad names and out-of-bounds positions, and tidies the rest', () => {
    const { a, topic, state } = watcher();
    hub.publish(topic(PEER), state({ n: '<img src=x>' }));
    hub.publish(topic(PEER), state({ x: 60, y: 60 }));
    expect(a.all('join')).toHaveLength(0);

    // Standing inside a table is moved to the door; an unknown outfit becomes the default one.
    hub.publish(topic(PEER), state({ x: 4, y: 5, o: { skin: 0, hair: 'nope', hairColor: 'hc_brown', top: 'top_teal', hat: 'hat_none' } }));
    const p = a.last('join')!.p;
    expect([p.x, p.y]).toEqual([10, 2]);
    expect(p.outfit.hair).toBe('hair_short');
  });

  it('drops impossible focus timers', () => {
    const { a, topic, state } = watcher();
    const now = Date.now();
    hub.publish(topic(PEER), state({ f: [now, now + 99 * 60 * MIN] }));
    expect(a.last('join')?.p.focus).toBeNull();
    hub.publish(topic(PEER), state({ f: [now, now + 25 * MIN] }));
    expect(a.last('upd')?.patch.focus).toEqual({ startedAt: now, endsAt: now + 25 * MIN });
  });

  it('never changes your own coins, seat or saved data', () => {
    const a = seated('Ada');
    const before = a.saved.value;
    hub.publish(`${ROOT}/pub-cafe/${a.id}`, JSON.stringify({ k: 'l' })); // pretending to be Ada
    hub.publish(`${ROOT}/pub-cafe/${PEER}`, JSON.stringify({ k: 'd', m: 180 }));
    hub.publish(`${ROOT}/pub-cafe/layout`, JSON.stringify({ items: [{ id: 1, item: 'f_bed', x: 3, y: 5 }] }));
    vi.advanceTimersByTime(MIN);
    expect(a.saved.value).toBe(before);
    expect(a.last('result')).toBeUndefined();
    expect(a.last('furniture')).toBeUndefined();
    expect(a.host.room?.members.get(a.id)?.sitting).toBe(true);
  });

  it('rate-limits a flooding peer and caps the room size', () => {
    const { a, topic, state } = watcher();
    for (let i = 0; i < 200; i++) hub.publish(topic(PEER), JSON.stringify({ k: 'e', e: 'wave' }));
    hub.publish(topic(PEER), state());
    expect(a.all('join')).toHaveLength(0); // its allowance was already spent

    for (let i = 0; i < 60; i++) hub.publish(topic(i.toString(16).padStart(12, '0')), state({ n: `P${i}` }));
    expect(a.all('join').length).toBeLessThanOrEqual(24);
  });

  it('puts the owner\'s furniture back when someone overwrites their room\'s layout', () => {
    const a = player('Ada');
    a.send({ t: 'join', target: { type: 'home' } });
    const id = a.host.room!.id;
    const mine = JSON.stringify({ items: a.host.room!.furniture });
    vi.advanceTimersByTime(6000);
    hub.publish(`${ROOT}/${id}/layout`, JSON.stringify({ items: [{ id: 1, item: 'f_plant', x: 2, y: 5 }] }), true);
    const last = hub.log.filter((l) => l.topic === `${ROOT}/${id}/layout`).at(-1);
    expect(last?.payload).toBe(mine);
    expect(a.last('furniture')).toBeUndefined();
  });

  it('rejects furniture layouts that break the room rules', () => {
    const a = player('Ada');
    a.send({ t: 'join', target: { type: 'code', code: 'HABCDE' } });
    hub.publish(
      `${ROOT}/c-HABCDE/layout`,
      JSON.stringify({
        items: [
          { id: 1, item: 'f_plant', x: 2, y: 5 },
          { id: 2, item: 'f_plant', x: 2, y: 5 }, // overlaps the first
          { id: 3, item: 'f_plant', x: 10, y: 3 }, // on the desk
          { id: 4, item: 'hat_crown', x: 3, y: 6 }, // not furniture
          { id: 5, item: 'f_lamp', x: 5, y: 2 }, // blocks the doorway
        ],
      }),
    );
    expect(a.last('furniture')?.items).toEqual([{ id: 1, item: 'f_plant', x: 2, y: 5 }]);
  });
});

describe('filler bots', () => {
  it('join quiet public rooms, are flagged as bots, give up their seat to real players, and skip private rooms', () => {
    const a = browser(hub, { bots: true });
    open.push(a);
    a.send({ t: 'hello', name: 'Ada' });
    a.send(CAFE);
    vi.advanceTimersByTime(5000);
    const bots = a.all('join').map((j) => j.p);
    expect(bots.length).toBeGreaterThanOrEqual(2);
    expect(bots.every((p) => p.bot)).toBe(true);

    // A real player arrives already sitting where a bot is.
    const spot = bots[0];
    hub.publish(`${ROOT}/pub-cafe/abcdef012345`, JSON.stringify({ k: 's', n: 'Bo', o: a.last('welcome')!.self.outfit, x: spot.x, y: spot.y, sit: true, at: 1, f: null, b: null }));
    expect(a.all('leave').some((l) => l.id === spot.id)).toBe(true);

    const b = browser(hub, { bots: true });
    open.push(b);
    b.send({ t: 'hello', name: 'Cy' });
    b.send({ t: 'join', target: { type: 'create', kind: 'cafe' } });
    vi.advanceTimersByTime(30_000);
    expect(b.all('join')).toHaveLength(0);
  });
});
