export const TILE = 16;
export const VIEW_W = 320;
export const VIEW_H = 176;

/** Milliseconds an avatar takes to cross one tile. */
export const STEP_MS = 200;

export const MIN_FOCUS = 5;
export const MAX_FOCUS = 180;
export const MAX_BREAK = 30;

/** Human players per public or private room. */
export const ROOM_CAP = 16;
export const HOME_CAP = 8;

export const START_COINS = 20;
export const MAX_FURNITURE_EACH = 6;

export const EMOTES = ['wave', 'thumbs', 'coffee', 'heart', 'brb'] as const;
export type Emote = (typeof EMOTES)[number];
