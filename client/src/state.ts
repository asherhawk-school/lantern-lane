import { signal } from '@preact/signals';
import type { Placed } from '../../shared/src/catalog.ts';
import type { FocusResult, FocusState, RoomSnapshot, SelfState, Stats } from '../../shared/src/protocol.ts';

/** UI state shared between the canvas game and the Preact panels. */

export type Panel = null | 'rooms' | 'shop' | 'wardrobe' | 'stats' | 'settings';

export interface PersonRow {
  id: string;
  name: string;
  bot: boolean;
  me: boolean;
  away: boolean;
  focusEndsAt: number | null;
  onBreak: boolean;
}

export interface MeView {
  seated: boolean;
  focus: FocusState | null;
  breakEndsAt: number | null;
}

export interface Settings {
  volume: number;
  ambience: 'rain' | 'room' | 'off';
  notify: boolean;
  minutes: number;
}

export type RoomInfo = Pick<RoomSnapshot, 'id' | 'kind' | 'name' | 'access' | 'code' | 'ownerId'>;

const SETTINGS_KEY = 'lanternlane.settings';
const DEFAULT_SETTINGS: Settings = { volume: 0.5, ambience: 'rain', notify: true, minutes: 25 };

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // Storage can be unavailable (private windows); defaults are fine.
  }
  return DEFAULT_SETTINGS;
}

export const connState = signal<'connecting' | 'online' | 'offline' | 'kicked'>('connecting');
export const kickReason = signal('');
export const needName = signal<{ reason: string | null } | null>(null);
export const self = signal<SelfState | null>(null);
export const roomInfo = signal<RoomInfo | null>(null);
export const people = signal<PersonRow[]>([]);
export const panel = signal<Panel>(null);
export const toast = signal<{ text: string; id: number } | null>(null);
export const meView = signal<MeView>({ seated: false, focus: null, breakEndsAt: null });
export const result = signal<FocusResult | null>(null);
export const focusLabel = signal('');
export const stats = signal<Stats | null>(null);
export const settings = signal<Settings>(loadSettings());
/** Server clock, refreshed a few times a second so countdowns re-render. */
export const serverNow = signal(Date.now());
/** Furniture currently placed in the room, mirrored here so panels can count it. */
export const placed = signal<Placed[]>([]);
export const decorate = signal<{ on: boolean; item: string | null; moving: number | null }>({ on: false, item: null, moving: null });

/** Clock offset to the server and how fast session clocks run (1 outside testing). */
export const net = { offset: 0, timeScale: 1 };

export function now(): number {
  return Date.now() + net.offset;
}

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings.value));
  } catch {
    // Not saved; the setting still applies for this visit.
  }
}

let toastId = 0;
let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function showToast(text: string): void {
  toast.value = { text, id: ++toastId };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 2600);
}

/** Session time left, in the session's own (possibly sped-up) clock. */
export function remainingMs(endsAt: number, at: number): number {
  return Math.max(0, endsAt - at) * net.timeScale;
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
