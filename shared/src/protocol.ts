import { z } from 'zod';
import { EMOTES, MAX_BREAK, MAX_FOCUS, MIN_FOCUS, type Emote } from './constants.ts';
import type { Inventory, Outfit, Placed } from './catalog.ts';
import type { RoomKind } from './tilemap.ts';

const coord = z.number().int().min(0).max(63);
const itemId = z.string().min(1).max(24);

export const OutfitSchema = z.object({
  skin: z.number().int().min(0).max(3),
  hair: itemId,
  hairColor: itemId,
  top: itemId,
  hat: itemId,
});

export const JoinTargetSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('public'), kind: z.enum(['cafe', 'library']) }),
  z.object({ type: z.literal('create'), kind: z.enum(['cafe', 'library']) }),
  z.object({ type: z.literal('code'), code: z.string().min(4).max(8) }),
  z.object({ type: z.literal('home') }),
  z.object({ type: z.literal('resume') }),
]);
export type JoinTarget = z.infer<typeof JoinTargetSchema>;

/** Everything a browser is allowed to send. Anything else is rejected. */
export const ClientMsgSchema = z.discriminatedUnion('t', [
  z.object({
    t: z.literal('hello'),
    token: z.string().length(64).optional(),
    name: z.string().max(24).optional(),
    tz: z.number().int().min(-900).max(900).optional(),
  }),
  z.object({ t: z.literal('ping'), c: z.number() }),
  z.object({ t: z.literal('join'), target: JoinTargetSchema }),
  z.object({ t: z.literal('move'), x: coord, y: coord }),
  z.object({ t: z.literal('sit'), x: coord, y: coord }),
  z.object({ t: z.literal('stand') }),
  z.object({
    t: z.literal('focus_start'),
    minutes: z.number().int().min(MIN_FOCUS).max(MAX_FOCUS),
    label: z.string().max(60).optional(),
  }),
  z.object({ t: z.literal('focus_cancel') }),
  z.object({ t: z.literal('break_start'), minutes: z.number().int().min(1).max(MAX_BREAK) }),
  z.object({ t: z.literal('break_cancel') }),
  z.object({ t: z.literal('emote'), kind: z.enum(EMOTES) }),
  z.object({ t: z.literal('buy'), item: itemId }),
  z.object({ t: z.literal('outfit'), outfit: OutfitSchema }),
  z.object({ t: z.literal('rename'), name: z.string().max(24) }),
  z.object({ t: z.literal('place'), item: itemId, x: coord, y: coord }),
  z.object({ t: z.literal('move_item'), id: z.number().int().min(1), x: coord, y: coord }),
  z.object({ t: z.literal('remove_item'), id: z.number().int().min(1) }),
  z.object({ t: z.literal('stats') }),
]);
export type ClientMsg = z.infer<typeof ClientMsgSchema>;

export interface FocusState {
  startedAt: number;
  endsAt: number;
}

export interface PlayerPublic {
  id: string;
  name: string;
  bot: boolean;
  /** Tile the avatar is on right now. */
  x: number;
  y: number;
  /** Tiles still to walk, in order. */
  path: [number, number][];
  /** True when the avatar is on (or walking to) a seat. */
  sitting: boolean;
  outfit: Outfit;
  focus: FocusState | null;
  breakEndsAt: number | null;
  /** Disconnected, but their session is still running. */
  away: boolean;
}

export interface SelfState {
  id: string;
  name: string;
  coins: number;
  outfit: Outfit;
  inventory: Inventory;
  homeCode: string;
  streak: number;
}

export interface RoomSnapshot {
  id: string;
  kind: RoomKind;
  name: string;
  access: 'public' | 'private' | 'home';
  code: string | null;
  ownerId: string | null;
  players: PlayerPublic[];
  furniture: Placed[];
}

export interface FocusResult {
  minutes: number;
  coins: number;
  bonus: number;
  streak: number;
  label: string;
}

export interface Stats {
  todayMinutes: number;
  totalMinutes: number;
  sessions: number;
  streak: number;
  week: { day: string; minutes: number }[];
  recent: { endedAt: number; minutes: number; label: string; coins: number }[];
}

export type ServerMsg =
  | { t: 'welcome'; token: string | null; self: SelfState; now: number; timeScale: number; resume: boolean; result: FocusResult | null }
  | { t: 'need_name'; reason: string | null }
  | { t: 'error'; code: string; msg: string }
  | { t: 'kicked'; reason: string }
  | { t: 'pong'; c: number; now: number }
  | { t: 'room'; room: RoomSnapshot }
  | { t: 'join'; p: PlayerPublic }
  | { t: 'leave'; id: string }
  | { t: 'moved'; id: string; path: [number, number][]; sitting: boolean }
  | { t: 'upd'; id: string; patch: Partial<PlayerPublic> }
  | { t: 'emote'; id: string; kind: Emote }
  | { t: 'done'; id: string; minutes: number }
  | { t: 'self'; self: SelfState }
  | { t: 'result'; result: FocusResult }
  | { t: 'break_done' }
  | { t: 'furniture'; items: Placed[] }
  | { t: 'stats'; stats: Stats };
