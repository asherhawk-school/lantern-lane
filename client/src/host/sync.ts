import type { Relay } from './host.ts';
import { ROOT } from './wire.ts';

/**
 * Accounts without a server.
 *
 * Your saved progress is encrypted in the browser with a key derived from your password, and the
 * encrypted copy is kept on the relay as a retained message under a topic derived from your
 * username. Another device that knows both can fetch and decrypt it. The password itself is never
 * sent or stored; only the derived key is kept on a signed-in device.
 *
 * The relay is public, so the copy there can be overwritten or lost. Every signed-in device also
 * keeps its own copy and puts it back if the relay's goes missing or is damaged.
 */

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export type SyncStatus = 'off' | 'saving' | 'synced' | 'offline';

export interface SyncHooks {
  /** This device's saved progress right now, or null if there is none. */
  current(): string | null;
  /** Replace this device's progress with a newer copy from the account. */
  adopt(save: string): void;
  /** Signed out: forget this device's copy. */
  cleared(): void;
  status(s: SyncStatus): void;
  /** True while a focus session is running here, when swapping progress underneath it would lose it. */
  busy(): boolean;
}

interface Session {
  user: string;
  topic: string;
  salt: string;
  key: string;
}

const PBKDF2_ROUNDS = 310_000;
const FETCH_TIMEOUT_MS = 3500;
const UPLOAD_DELAY_MS = 1200;
export const MIN_PASSWORD = 8;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function checkUsername(raw: string): { ok: true; user: string } | { ok: false; reason: string } {
  const user = raw.trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,20}$/.test(user)) return { ok: false, reason: 'Usernames are 3-20 letters, numbers, - or _' };
  return { ok: true, user };
}

async function topicFor(user: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`lanternlane:${user}`)));
  return `${ROOT}/acct/${[...hash.subarray(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<string> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ROUNDS }, material, 256);
  return toB64(new Uint8Array(bits));
}

async function aesKey(key: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromB64(key), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypt text into the blob stored on the relay. The salt rides along so other devices can derive the key. */
async function seal(key: string, salt: string, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(key), enc.encode(text));
  return JSON.stringify({ v: 1, s: salt, i: toB64(iv), c: toB64(new Uint8Array(ct)) });
}

function parseBlob(payload: string): { s: string; i: string; c: string } | null {
  try {
    const b = JSON.parse(payload);
    if (b && b.v === 1 && typeof b.s === 'string' && typeof b.i === 'string' && typeof b.c === 'string') return b;
  } catch {
    // not a blob
  }
  return null;
}

/** Decrypt a blob; null if the key is wrong or the blob was tampered with. */
async function unseal(key: string, blob: { i: string; c: string }): Promise<string | null> {
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(blob.i) }, await aesKey(key), fromB64(blob.c));
    return dec.decode(pt);
  } catch {
    return null;
  }
}

export class AccountSync {
  private kv: KV;
  private relay: Relay;
  private hooks: SyncHooks;
  private session: Session | null = null;
  private waiters = new Map<string, (payload: string | null) => void>();
  private uploadTimer: ReturnType<typeof setTimeout> | undefined;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private heard = false;
  private connected = false;

  constructor(kv: KV, relay: Relay, hooks: SyncHooks) {
    this.kv = kv;
    this.relay = relay;
    this.hooks = hooks;
    try {
      const raw = kv.get('session');
      const s = raw ? (JSON.parse(raw) as Session) : null;
      if (s && typeof s.user === 'string' && typeof s.topic === 'string' && typeof s.key === 'string' && typeof s.salt === 'string') this.session = s;
    } catch {
      this.session = null;
    }
    if (this.session) this.relay.subscribe(this.session.topic);
  }

  user(): string | null {
    return this.session?.user ?? null;
  }

  private rev(): number {
    return Number(this.kv.get('rev')) || 0;
  }

  private report(): void {
    this.hooks.status(!this.session ? 'off' : !this.connected ? 'offline' : this.dirty ? 'saving' : 'synced');
  }

  /** The relay connected (or reconnected). */
  online(): void {
    this.connected = true;
    this.report();
    if (!this.session) return;
    // If the relay has no copy for us (it lost it), put ours back.
    this.heard = false;
    clearTimeout(this.graceTimer);
    this.graceTimer = setTimeout(() => {
      if (!this.heard) this.schedule(0);
    }, FETCH_TIMEOUT_MS);
  }

  offline(): void {
    this.connected = false;
    this.report();
  }

  /** Feed every relay message here first; returns true if it was account data. */
  message(topic: string, payload: string): boolean {
    const waiter = this.waiters.get(topic);
    if (waiter) {
      waiter(payload);
      return true;
    }
    if (!this.session || topic !== this.session.topic) return false;
    this.heard = true;
    void this.incoming(payload);
    return true;
  }

  private async incoming(payload: string): Promise<void> {
    const s = this.session;
    if (!s) return;
    const blob = parseBlob(payload);
    const text = blob ? await unseal(s.key, blob) : null;
    if (this.session !== s) return;
    let doc: { rev: number; save: string } | null = null;
    try {
      const d = text ? JSON.parse(text) : null;
      if (d && typeof d.rev === 'number' && typeof d.save === 'string') doc = d;
    } catch {
      doc = null;
    }
    // Missing, damaged or overwritten by someone without the password: restore ours.
    if (!doc) return this.schedule(0);

    const mine = this.rev();
    if (doc.rev > mine) {
      if (this.hooks.busy()) return; // our next save will carry on from here
      this.kv.set('rev', String(doc.rev));
      this.dirty = false;
      clearTimeout(this.uploadTimer);
      this.hooks.adopt(doc.save);
    } else if (doc.rev < mine) {
      return this.schedule(0);
    } else {
      this.dirty = false;
    }
    this.report();
  }

  /** This device's progress changed: note it and upload shortly. */
  localChanged(): void {
    if (!this.session) return;
    this.kv.set('rev', String(this.rev() + 1));
    this.schedule(UPLOAD_DELAY_MS);
  }

  private schedule(delay: number): void {
    this.dirty = true;
    this.report();
    clearTimeout(this.uploadTimer);
    this.uploadTimer = setTimeout(() => void this.upload(), delay);
  }

  private async upload(): Promise<void> {
    const s = this.session;
    const save = this.hooks.current();
    if (!s || !save || !this.connected) return;
    const blob = await seal(s.key, s.salt, JSON.stringify({ rev: this.rev(), at: Date.now(), save }));
    if (this.session !== s) return;
    this.relay.publish(s.topic, blob, true);
    // Our own copy comes back from the relay and confirms it in incoming().
  }

  /** Read whatever the relay holds on a topic, or null if nothing arrives in time. */
  private fetch(topic: string): Promise<string | null> {
    return new Promise((resolve) => {
      const done = (payload: string | null) => {
        clearTimeout(timer);
        this.waiters.delete(topic);
        if (topic !== this.session?.topic) this.relay.unsubscribe(topic);
        resolve(payload && payload.length ? payload : null);
      };
      const timer = setTimeout(() => done(null), FETCH_TIMEOUT_MS);
      this.waiters.set(topic, done);
      this.relay.subscribe(topic);
    });
  }

  private begin(session: Session, rev: number): void {
    this.session = session;
    this.kv.set('session', JSON.stringify(session));
    this.kv.set('rev', String(rev));
    this.relay.subscribe(session.topic);
    this.heard = true;
  }

  /** Create an account holding this device's current progress. Returns an error message, or null on success. */
  async signUp(username: string, password: string): Promise<string | null> {
    const name = checkUsername(username);
    if (!name.ok) return name.reason;
    if (password.length < MIN_PASSWORD) return `Passwords need at least ${MIN_PASSWORD} characters`;
    if (!this.connected) return 'You are offline. Try again when the connection is back.';
    if (!this.hooks.current()) return 'Play a little first, so there is progress to save.';

    const topic = await topicFor(name.user);
    if (await this.fetch(topic)) return 'That username is taken';
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKey(password, salt);
    this.begin({ user: name.user, topic, salt: toB64(salt), key }, 1);
    this.schedule(0);
    return null;
  }

  /** Sign in and replace this device's progress with the account's. Returns an error message, or null. */
  async signIn(username: string, password: string): Promise<string | null> {
    const name = checkUsername(username);
    if (!name.ok) return name.reason;
    if (!this.connected) return 'You are offline. Try again when the connection is back.';

    const topic = await topicFor(name.user);
    const blob = parseBlob((await this.fetch(topic)) ?? '');
    if (!blob) return 'No account with that username was found';
    const key = await deriveKey(password, fromB64(blob.s));
    const text = await unseal(key, blob);
    let doc: { rev: number; save: string } | null = null;
    try {
      const d = text ? JSON.parse(text) : null;
      if (d && typeof d.rev === 'number' && typeof d.save === 'string') doc = d;
    } catch {
      doc = null;
    }
    if (!doc) return 'Wrong password';

    this.begin({ user: name.user, topic, salt: blob.s, key }, doc.rev);
    this.dirty = false;
    this.hooks.adopt(doc.save);
    this.report();
    return null;
  }

  /** Upload anything pending, then forget the account and this device's copy of the progress. */
  async signOut(): Promise<void> {
    const s = this.session;
    if (!s) return;
    clearTimeout(this.uploadTimer);
    clearTimeout(this.graceTimer);
    if (this.dirty) await this.upload();
    this.session = null;
    this.dirty = false;
    this.kv.remove('session');
    this.kv.remove('rev');
    this.relay.unsubscribe(s.topic);
    this.hooks.cleared();
    this.report();
  }

  stop(): void {
    clearTimeout(this.uploadTimer);
    clearTimeout(this.graceTimer);
  }
}
