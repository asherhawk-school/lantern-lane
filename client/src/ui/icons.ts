import { ITEM_BY_ID, type Item, type Outfit } from '../../../shared/src/catalog.ts';
import { avatarSprite, outfitKey } from '../art/characters.ts';
import { toDataUrl, type Sprite } from '../art/pix.ts';
import { furnitureIcon } from '../art/roomArt.ts';
import { coinSprite, emoteSprite, flameSprite, type EmoteKind } from '../art/sprites.ts';

/** Pixel sprites as data URLs, for use in <img> tags in the panels. */

const cache = new Map<string, string>();

function memo(key: string, make: () => HTMLCanvasElement): string {
  let url = cache.get(key);
  if (!url) {
    url = toDataUrl(make());
    cache.set(key, url);
  }
  return url;
}

const of = (s: Sprite) => s.img;

export const coinUrl = () => memo('coin', () => of(coinSprite()));
export const flameUrl = () => memo('flame', () => of(flameSprite()));
export const emoteUrl = (kind: EmoteKind) => memo(`emote-${kind}`, () => of(emoteSprite(kind)));

export function avatarUrl(o: Outfit): string {
  return memo(`av-${outfitKey(o)}`, () => of(avatarSprite(o, 'down', 'stand', 0)));
}

const SLOT: Record<string, keyof Outfit> = { hair: 'hair', hairColor: 'hairColor', top: 'top', hat: 'hat' };

/** What an item looks like: furniture on its own, clothing tried on the given outfit. */
export function itemUrl(item: Item, outfit: Outfit): string {
  if (item.kind === 'furniture') return memo(`f-${item.id}`, () => furnitureIcon(item.id));
  return avatarUrl({ ...outfit, [SLOT[item.kind]]: item.id });
}

export function itemName(id: string): string {
  return ITEM_BY_ID.get(id)?.name ?? id;
}
