import { describe, expect, it } from 'vitest';
import type { Relay } from '../client/src/host/host.ts';
import { AccountSync, checkUsername, type SyncStatus } from '../client/src/host/sync.ts';

/** A stand-in relay with exact-topic subscriptions and retained messages. */
class Hub {
  retained = new Map<string, string>();
  private subs = new Set<{ topics: Set<string>; deliver: (topic: string, payload: string) => void }>();

  publish(topic: string, payload: string, retain = false): void {
    if (retain) this.retained.set(topic, payload);
    for (const s of this.subs) if (s.topics.has(topic)) s.deliver(topic, payload);
  }

  relay(deliver: (topic: string, payload: string) => void): Relay {
    const me = { topics: new Set<string>(), deliver };
    this.subs.add(me);
    return {
      publish: (t, p, r) => this.publish(t, p, r),
      subscribe: (t) => {
        me.topics.add(t);
        const kept = this.retained.get(t);
        if (kept !== undefined) queueMicrotask(() => deliver(t, kept));
      },
      unsubscribe: (t) => void me.topics.delete(t),
    };
  }
}

/** One device: its own storage, its own copy of the progress, and an account sync. */
function device(hub: Hub, save: string | null = null) {
  const kv = new Map<string, string>();
  const d = {
    save,
    busy: false,
    adopted: [] as string[],
    cleared: 0,
    status: 'off' as SyncStatus,
    sync: null as unknown as AccountSync,
    /** The player did something: progress changed on this device. */
    change(next: string) {
      d.save = next;
      d.sync.localChanged();
    },
    /** Reopen the page: same storage, fresh sync. */
    reopen() {
      d.sync.stop();
      start();
    },
  };
  const start = () => {
    const relay = hub.relay((topic, payload) => d.sync.message(topic, payload));
    d.sync = new AccountSync(
      { get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v), remove: (k) => void kv.delete(k) },
      relay,
      {
        current: () => d.save,
        adopt: (s) => {
          d.save = s;
          d.adopted.push(s);
        },
        cleared: () => {
          d.save = null;
          d.cleared++;
        },
        status: (s) => (d.status = s),
        busy: () => d.busy,
      },
    );
    d.sync.online();
  };
  start();
  return d;
}

async function until(check: () => boolean, ms = 6000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const PASS = 'correct horse battery';

describe('accounts', () => {
  it('checks usernames', () => {
    expect(checkUsername(' Ada_L ')).toEqual({ ok: true, user: 'ada_l' });
    expect(checkUsername('ab').ok).toBe(false);
    expect(checkUsername('has space').ok).toBe(false);
    expect(checkUsername('x'.repeat(21)).ok).toBe(false);
  });

  it('carries progress from one device to another', async () => {
    const hub = new Hub();
    const laptop = device(hub, '{"coins":47}');
    expect(await laptop.sync.signUp('Ada', PASS)).toBeNull();
    expect(laptop.sync.user()).toBe('ada');
    await until(() => laptop.status === 'synced');

    const phone = device(hub, '{"coins":20}');
    expect(await phone.sync.signIn('ada', PASS)).toBeNull();
    expect(phone.save).toBe('{"coins":47}');
    expect(phone.sync.user()).toBe('ada');
  });

  it('refuses wrong passwords, unknown and taken usernames, and weak passwords', async () => {
    const hub = new Hub();
    const laptop = device(hub, '{"coins":47}');
    expect(await laptop.sync.signUp('ada', 'short')).toMatch(/at least 8/);
    expect(await laptop.sync.signUp('a!', PASS)).toMatch(/Usernames/);
    expect(await laptop.sync.signUp('ada', PASS)).toBeNull();
    await until(() => laptop.status === 'synced');

    const phone = device(hub, '{"coins":20}');
    expect(await phone.sync.signIn('ada', 'not the password')).toBe('Wrong password');
    expect(await phone.sync.signUp('ADA', PASS)).toBe('That username is taken');
    expect(phone.save).toBe('{"coins":20}');
    expect(phone.sync.user()).toBeNull();
    expect(await phone.sync.signIn('nobody', PASS)).toMatch(/No account/);
  }, 20_000);

  it('will not create an account with nothing to save, or while offline', async () => {
    const hub = new Hub();
    const empty = device(hub, null);
    expect(await empty.sync.signUp('ada', PASS)).toMatch(/Play a little/);
    const cut = device(hub, '{"coins":1}');
    cut.sync.offline();
    expect(await cut.sync.signUp('ada', PASS)).toMatch(/offline/);
    expect(await cut.sync.signIn('ada', PASS)).toMatch(/offline/);
  });

  it('never puts the password or readable progress on the relay', async () => {
    const hub = new Hub();
    const laptop = device(hub, '{"coins":47,"name":"SecretName"}');
    await laptop.sync.signUp('ada', PASS);
    await until(() => hub.retained.size === 1);
    const [topic, blob] = [...hub.retained.entries()][0];
    expect(topic).not.toContain('ada');
    expect(blob).not.toContain('SecretName');
    expect(blob).not.toContain('coins');
    expect(blob).not.toContain(PASS);
  });

  it('pushes later changes to the other device, in both directions', async () => {
    const hub = new Hub();
    const laptop = device(hub, '{"coins":47}');
    await laptop.sync.signUp('ada', PASS);
    await until(() => laptop.status === 'synced');
    const phone = device(hub, null);
    await phone.sync.signIn('ada', PASS);

    laptop.change('{"coins":72}');
    await until(() => phone.save === '{"coins":72}');
    phone.change('{"coins":12}');
    await until(() => laptop.save === '{"coins":12}');
    await until(() => laptop.status === 'synced' && phone.status === 'synced');
    expect(laptop.adopted).toEqual(['{"coins":12}']);
  }, 20_000);

  it('picks up changes made elsewhere when the page is reopened', async () => {
    const hub = new Hub();
    const laptop = device(hub, '{"coins":47}');
    await laptop.sync.signUp('ada', PASS);
    await until(() => laptop.status === 'synced');
    const phone = device(hub, null);
    await phone.sync.signIn('ada', PASS);
    phone.sync.stop(); // phone closed

    laptop.change('{"coins":99}');
    await until(() => laptop.status === 'synced');
    phone.reopen();
    await until(() => phone.save === '{"coins":99}');
    expect(phone.sync.user()).toBe('ada');
  }, 20_000);

  it('does not swap progress underneath a running focus session', async () => {
    const hub = new Hub();
    const laptop = device(hub, '{"coins":47}');
    await laptop.sync.signUp('ada', PASS);
    await until(() => laptop.status === 'synced');
    const phone = device(hub, null);
    await phone.sync.signIn('ada', PASS);

    phone.busy = true;
    laptop.change('{"coins":72}');
    await until(() => laptop.status === 'synced');
    await new Promise((r) => setTimeout(r, 200));
    expect(phone.save).toBe('{"coins":47}');
  }, 20_000);

  it('restores the account if the relay copy is vandalised or lost', async () => {
    const hub = new Hub();
    const laptop = device(hub, '{"coins":47}');
    await laptop.sync.signUp('ada', PASS);
    await until(() => laptop.status === 'synced');
    const topic = [...hub.retained.keys()][0];
    const good = hub.retained.get(topic)!;

    hub.publish(topic, '{"v":1,"s":"AAAA","i":"AAAA","c":"AAAA"}', true);
    await until(() => hub.retained.get(topic) !== '{"v":1,"s":"AAAA","i":"AAAA","c":"AAAA"}');
    expect(laptop.save).toBe('{"coins":47}');

    // A forged blob with a huge revision cannot be decrypted, so it is not adopted either.
    hub.publish(topic, good.replace(/"c":"./, '"c":"A'), true);
    await new Promise((r) => setTimeout(r, 300));
    expect(laptop.save).toBe('{"coins":47}');

    hub.retained.clear();
    laptop.reopen();
    await until(() => hub.retained.has(topic), 8000);
    const phone = device(hub, null);
    expect(await phone.sync.signIn('ada', PASS)).toBeNull();
    expect(phone.save).toBe('{"coins":47}');
  }, 30_000);

  it('signing out saves pending changes, then forgets the account and progress on that device', async () => {
    const hub = new Hub();
    const laptop = device(hub, '{"coins":47}');
    await laptop.sync.signUp('ada', PASS);
    await until(() => laptop.status === 'synced');
    laptop.change('{"coins":60}');
    await laptop.sync.signOut();
    expect(laptop.sync.user()).toBeNull();
    expect(laptop.save).toBeNull();
    expect(laptop.cleared).toBe(1);
    expect(laptop.status).toBe('off');

    laptop.reopen();
    expect(laptop.sync.user()).toBeNull();
    const phone = device(hub, null);
    expect(await phone.sync.signIn('ada', PASS)).toBeNull();
    expect(phone.save).toBe('{"coins":60}');
  }, 20_000);
});
