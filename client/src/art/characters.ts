import { ITEM_BY_ID, type Outfit } from '../../../shared/src/catalog.ts';
import { PAL, shade, SKIN } from '../../../shared/src/palette.ts';
import type { Dir } from '../../../shared/src/tilemap.ts';
import { ctxOf, makeCanvas, outline, type Painter, type Sprite } from './pix.ts';

/**
 * Avatars are painted from code on a 16-wide grid: head rows 2-10, body 11-17, legs 18-22.
 * Each (outfit, direction, pose, frame) is painted once and cached.
 */

export type Pose = 'stand' | 'sit';

const CW = 20;
const CH = 30;
const OX = 2;
const OY = 5;

interface Look {
  skin: string;
  blush: string;
  hair: string;
  hairHi: string;
  top: string;
  topS: string;
  style: string;
  accent: string;
  pants: string;
  shoe: string;
  hatId: string;
  hat: string;
  hatS: string;
  hairId: string;
}

function lookFor(o: Outfit): Look {
  const skin = SKIN[o.skin] ?? SKIN[0];
  const hair = ITEM_BY_ID.get(o.hairColor)?.color ?? PAL.brownD;
  const topItem = ITEM_BY_ID.get(o.top);
  const style = topItem?.style ?? 'plain';
  const accent = topItem?.color ?? PAL.teal;
  const top = style === 'overalls' ? PAL.cream : accent;
  const hat = ITEM_BY_ID.get(o.hat)?.color ?? PAL.red;
  return {
    skin,
    blush: shade(skin, 0.86),
    hair,
    hairHi: shade(hair, 1.25),
    top,
    topS: shade(top, 0.8),
    style,
    accent,
    pants: style === 'overalls' ? accent : PAL.shadow,
    shoe: PAL.brownD,
    hatId: o.hat,
    hat,
    hatS: shade(hat, 0.75),
    hairId: o.hair,
  };
}

type View = 'front' | 'back' | 'side';

function paintHair(r: Painter, k: Look, view: View, h: number): void {
  const H = k.hair;
  const covered = k.hatId === 'hat_cap' || k.hatId === 'hat_beanie' || k.hatId === 'hat_crown';
  const id = k.hairId;

  if (view === 'side') {
    if (id === 'hair_none') {
      r(H, 5, h, 7, 1);
      r(H, 4, h + 1, 3, 2);
      return;
    }
    r(H, 5, h, 7, 1);
    r(H, 4, h + 1, 9, 2);
    r(H, 4, h + 3, 3, 4);
    r(H, 7, h + 3, 2, 1);
    r(k.hairHi, 7, h + 1, 3, 1);
    if (id === 'hair_bob' || id === 'hair_long') r(H, 4, h + 3, 4, 6);
    if (id === 'hair_long') r(H, 3, h + 4, 4, 10);
    if (covered) return;
    if (id === 'hair_spiky') {
      r(H, 5, h - 1, 2, 1);
      r(H, 8, h - 1, 2, 1);
      r(H, 11, h - 1, 1, 1);
    }
    if (id === 'hair_bun') r(H, 4, h - 2, 3, 2);
    return;
  }

  if (id === 'hair_none') {
    r(H, 4, h, 8, 1);
    r(H, 3, h + 1, 10, view === 'back' ? 2 : 1);
    return;
  }

  if (view === 'front') {
    r(H, 4, h, 8, 1);
    r(H, 3, h + 1, 10, 2);
    r(H, 3, h + 3, 2, 1);
    r(H, 11, h + 3, 2, 1);
    r(H, 3, h + 4, 1, 1);
    r(H, 12, h + 4, 1, 1);
    r(k.hairHi, 5, h + 1, 3, 1);
    if (id === 'hair_bob' || id === 'hair_long') {
      r(H, 3, h + 3, 1, 6);
      r(H, 12, h + 3, 1, 6);
    }
    if (id === 'hair_long') {
      r(H, 2, h + 4, 1, 9);
      r(H, 13, h + 4, 1, 9);
      r(H, 3, h + 9, 1, 3);
      r(H, 12, h + 9, 1, 3);
    }
  } else {
    r(H, 4, h, 8, 1);
    r(H, 3, h + 1, 10, 6);
    r(H, 4, h + 7, 8, 1);
    r(k.hairHi, 5, h + 1, 3, 1);
    if (id === 'hair_bob' || id === 'hair_long') r(H, 3, h + 1, 10, 8);
    if (id === 'hair_long') r(H, 2, h + 4, 12, 9);
  }
  if (covered) return;
  if (id === 'hair_spiky') {
    for (const x of [4, 7, 10]) {
      r(H, x, h - 1, 2, 1);
      r(H, x + 1, h - 2, 1, 1);
    }
  }
  if (id === 'hair_bun') {
    r(H, 6, h - 2, 4, 2);
    r(k.hairHi, 7, h - 2, 1, 1);
  }
}

function paintHat(r: Painter, k: Look, view: View, h: number): void {
  const c = k.hat;
  const s = k.hatS;
  const side = view === 'side';
  switch (k.hatId) {
    case 'hat_cap':
      if (side) {
        r(c, 5, h - 1, 7, 1);
        r(c, 4, h, 9, 2);
        r(s, 8, h + 2, 6, 1);
      } else {
        r(c, 4, h - 1, 8, 1);
        r(c, 3, h, 10, view === 'back' ? 3 : 2);
        if (view === 'front') r(s, 3, h + 2, 10, 1);
      }
      return;
    case 'hat_beanie':
      if (side) {
        r(c, 5, h - 1, 7, 1);
        r(c, 4, h, 9, 2);
        r(s, 4, h + 2, 9, 1);
      } else {
        r(c, 4, h - 1, 8, 1);
        r(c, 3, h, 10, 2);
        r(s, 3, h + 2, 10, 1);
      }
      r(PAL.white, 7, h - 3, 2, 2);
      return;
    case 'hat_headphones':
      if (side) {
        r(PAL.grey, 7, h - 1, 3, 1);
        r(PAL.grey, 8, h, 1, 2);
        r(c, 6, h + 2, 4, 4);
        r(s, 7, h + 3, 2, 2);
      } else {
        r(PAL.grey, 4, h - 1, 8, 1);
        r(PAL.grey, 3, h, 1, 2);
        r(PAL.grey, 12, h, 1, 2);
        r(c, 2, h + 2, 2, 4);
        r(c, 12, h + 2, 2, 4);
      }
      return;
    case 'hat_crown':
      if (side) {
        r(c, 5, h - 1, 7, 2);
        for (const x of [5, 8, 11]) r(c, x, h - 2, 1, 1);
      } else {
        r(c, 4, h - 1, 8, 2);
        r(c, 4, h - 2, 1, 1);
        r(c, 7, h - 2, 2, 1);
        r(c, 11, h - 2, 1, 1);
        if (view === 'front') r(PAL.red, 7, h - 1, 2, 1);
      }
      return;
  }
}

function paintFrontBack(r: Painter, k: Look, pose: Pose, frame: number, back: boolean): void {
  const sit = pose === 'sit';
  const h = 2 + (sit && frame === 1 ? 1 : 0);

  r(k.pants, 5, 18, 6, 1);
  if (sit) {
    r(k.pants, 5, 19, 2, 1);
    r(k.pants, 9, 19, 2, 1);
    r(k.shoe, 5, 20, 2, 1);
    r(k.shoe, 9, 20, 2, 1);
  } else {
    const left = frame === 1 ? 2 : 3;
    const right = frame === 2 ? 2 : 3;
    r(k.pants, 5, 19, 2, left);
    r(k.shoe, 5, 19 + left, 2, 1);
    r(k.pants, 9, 19, 2, right);
    r(k.shoe, 9, 19 + right, 2, 1);
  }

  r(k.top, 4, 11, 8, 7);
  r(k.topS, 4, 17, 8, 1);
  const la = !sit && frame === 1 ? -1 : 0;
  const ra = !sit && frame === 2 ? -1 : 0;
  r(k.top, 3, 11, 1, 5 + la);
  r(k.skin, 3, 16 + la, 1, 1);
  r(k.top, 12, 11, 1, 5 + ra);
  r(k.skin, 12, 16 + ra, 1, 1);

  if (k.style === 'stripe') {
    for (const y of [12, 14, 16]) r(PAL.white, 4, y, 8, 1);
  } else if (k.style === 'hoodie') {
    if (back) {
      r(k.topS, 5, 11, 6, 3);
    } else {
      r(k.topS, 5, 11, 6, 1);
      r(PAL.white, 6, 12, 1, 2);
      r(PAL.white, 9, 12, 1, 2);
      r(k.topS, 6, 15, 4, 2);
    }
  } else if (k.style === 'overalls') {
    r(k.accent, 5, 11, 1, 3);
    r(k.accent, 10, 11, 1, 3);
    r(k.accent, 5, back ? 14 : 13, 6, back ? 4 : 5);
    if (!back) r(PAL.yellow, 7, 14, 2, 1);
  }

  r(k.skin, 4, h, 8, 1);
  r(k.skin, 3, h + 1, 10, 7);
  r(k.skin, 4, h + 8, 8, 1);
  if (!back) {
    r(PAL.ink, 5, h + 4, 1, 2);
    r(PAL.ink, 10, h + 4, 1, 2);
    r(k.blush, 4, h + 6, 1, 1);
    r(k.blush, 11, h + 6, 1, 1);
  }
  paintHair(r, k, back ? 'back' : 'front', h);
  paintHat(r, k, back ? 'back' : 'front', h);
}

function paintSide(r: Painter, k: Look, pose: Pose, frame: number): void {
  const sit = pose === 'sit';
  const h = 2 + (sit && frame === 1 ? 1 : 0);

  if (sit) {
    r(k.pants, 6, 18, 6, 2);
    r(k.pants, 10, 20, 2, 2);
    r(k.shoe, 10, 22, 3, 1);
  } else if (frame === 1) {
    r(k.pants, 6, 18, 4, 1);
    r(k.pants, 5, 19, 2, 2);
    r(k.shoe, 4, 21, 3, 1);
    r(k.pants, 8, 19, 2, 3);
    r(k.shoe, 8, 22, 3, 1);
  } else if (frame === 2) {
    r(k.pants, 6, 18, 4, 1);
    r(k.pants, 6, 19, 2, 3);
    r(k.shoe, 6, 22, 3, 1);
    r(k.pants, 9, 19, 2, 2);
    r(k.shoe, 9, 21, 3, 1);
  } else {
    r(k.pants, 6, 18, 4, 4);
    r(k.shoe, 6, 22, 5, 1);
  }

  r(k.top, 5, 11, 6, 7);
  r(k.topS, 5, 17, 6, 1);
  if (k.style === 'stripe') {
    for (const y of [12, 14, 16]) r(PAL.white, 5, y, 6, 1);
  } else if (k.style === 'hoodie') {
    r(k.topS, 4, 11, 3, 3);
  } else if (k.style === 'overalls') {
    r(k.accent, 6, 13, 5, 5);
    r(k.accent, 7, 11, 1, 2);
  }

  if (sit) {
    r(k.topS, 8, 13, 4, 2);
    r(k.skin, 12, 13, 1, 2);
  } else {
    const ax = frame === 1 ? 6 : frame === 2 ? 8 : 7;
    r(k.topS, ax, 12, 2, 4);
    r(k.skin, ax, 16, 2, 1);
  }

  r(k.skin, 5, h, 7, 1);
  r(k.skin, 4, h + 1, 9, 7);
  r(k.skin, 5, h + 8, 7, 1);
  r(PAL.ink, 10, h + 4, 1, 2);
  r(k.blush, 11, h + 6, 1, 1);
  paintHair(r, k, 'side', h);
  paintHat(r, k, 'side', h);
}

const cache = new Map<string, Sprite>();

export function outfitKey(o: Outfit): string {
  return `${o.skin}|${o.hair}|${o.hairColor}|${o.top}|${o.hat}`;
}

/** frame: stand 0 = idle, 1-2 = walk cycle; sit 0 = upright, 1 = head down (working). */
export function avatarSprite(o: Outfit, dir: Dir, pose: Pose, frame: number): Sprite {
  const key = `${outfitKey(o)}|${dir}|${pose}|${frame}`;
  let s = cache.get(key);
  if (s) return s;

  const canvas = makeCanvas(CW, CH);
  const ctx = ctxOf(canvas);
  const flip = dir === 'left';
  const r: Painter = (color, x, y, w = 1, h = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(OX + (flip ? 16 - x - w : x), OY + y, w, h);
  };
  const look = lookFor(o);
  if (dir === 'down') paintFrontBack(r, look, pose, frame, false);
  else if (dir === 'up') paintFrontBack(r, look, pose, frame, true);
  else paintSide(r, look, pose, frame);
  outline(canvas);

  s = { img: canvas, ax: OX + 8, ay: OY + 23 };
  cache.set(key, s);
  return s;
}
