import { PAL, shade } from '../../../shared/src/palette.ts';
import type { Dir } from '../../../shared/src/tilemap.ts';
import { gridSprite, hash, sprite, type Painter, type Sprite } from './pix.ts';

/** Furniture and icon sprites. All are positioned relative to the top-left of the tile they stand on. */

const memo = new Map<string, unknown>();
function once<T>(key: string, make: () => T): T {
  if (!memo.has(key)) memo.set(key, make());
  return memo.get(key) as T;
}

const mirrored = (r: Painter): Painter => (c, x, y, w = 1, h = 1) => r(c, 16 - x - w, y, w, h);

export interface SeatSprites {
  /** Drawn behind whoever is sitting. */
  base: Sprite;
  /** Drawn in front of them (a chair back seen from behind, a sofa arm). */
  front: Sprite | null;
}

export function chairSprites(dir: Dir): SeatSprites {
  return once(`chair-${dir}`, () => {
    if (dir === 'down') {
      const base = sprite(16, 16, 0, 0, (r) => {
        r(PAL.brown, 3, 0, 10, 8);
        r(PAL.wood, 5, 1, 2, 6);
        r(PAL.wood, 9, 1, 2, 6);
        r(PAL.wood, 3, 8, 10, 4);
        r(PAL.tan, 3, 8, 10, 1);
        r(PAL.brownD, 3, 12, 2, 3);
        r(PAL.brownD, 11, 12, 2, 3);
      });
      return { base, front: null };
    }
    if (dir === 'up') {
      const base = sprite(16, 16, 0, 0, (r) => {
        r(PAL.wood, 3, 6, 10, 4);
        r(PAL.brownD, 3, 10, 2, 5);
        r(PAL.brownD, 11, 10, 2, 5);
      });
      const front = sprite(16, 16, 0, 0, (r) => {
        r(PAL.brown, 3, 3, 10, 8);
        r(PAL.wood, 5, 4, 2, 6);
        r(PAL.wood, 9, 4, 2, 6);
      });
      return { base, front };
    }
    const base = sprite(16, 16, 0, 0, (r0) => {
      const r = dir === 'left' ? mirrored(r0) : r0;
      r(PAL.brown, 2, 1, 2, 11);
      r(PAL.wood, 4, 8, 9, 4);
      r(PAL.tan, 4, 8, 9, 1);
      r(PAL.brownD, 4, 12, 2, 3);
      r(PAL.brownD, 11, 12, 2, 3);
    });
    return { base, front: null };
  });
}

export function sofaSprites(dir: Dir, color: string): SeatSprites {
  return once(`sofa-${dir}-${color}`, () => {
    const d = shade(color, 0.72);
    const hi = shade(color, 1.15);
    if (dir === 'down') {
      const base = sprite(16, 16, 0, 0, (r) => {
        r(d, 1, 0, 14, 9);
        r(color, 2, 1, 12, 6);
        r(color, 2, 9, 12, 5);
        r(hi, 3, 9, 10, 1);
        r(d, 0, 6, 3, 9);
        r(d, 13, 6, 3, 9);
        r(PAL.brownD, 1, 15, 2, 1);
        r(PAL.brownD, 13, 15, 2, 1);
      });
      return { base, front: null };
    }
    if (dir === 'up') {
      const base = sprite(16, 16, 0, 0, (r) => {
        r(color, 2, 3, 12, 8);
        r(d, 0, 4, 3, 11);
        r(d, 13, 4, 3, 11);
      });
      const front = sprite(16, 16, 0, 0, (r) => {
        r(d, 1, 6, 14, 9);
        r(color, 2, 7, 12, 6);
        r(PAL.brownD, 1, 15, 2, 1);
        r(PAL.brownD, 13, 15, 2, 1);
      });
      return { base, front };
    }
    const flip = dir === 'left';
    const base = sprite(16, 16, 0, 0, (r0) => {
      const r = flip ? mirrored(r0) : r0;
      r(d, 0, 0, 5, 15);
      r(color, 1, 1, 3, 10);
      r(color, 5, 7, 10, 7);
      r(hi, 5, 7, 10, 1);
      r(PAL.brownD, 1, 15, 2, 1);
      r(PAL.brownD, 12, 15, 2, 1);
    });
    const front = sprite(16, 16, 0, 0, (r0) => {
      const r = flip ? mirrored(r0) : r0;
      r(d, 3, 11, 12, 4);
      r(shade(color, 0.85), 4, 11, 10, 1);
    });
    return { base, front };
  });
}

export function plantSprite(): Sprite {
  return once('plant', () =>
    gridSprite(
      [
        '......gg........',
        '.....gGg...gg...',
        '.....gGg..gGg...',
        '..g...gg.gGg....',
        '.gGg..gg.gg.....',
        '.gGGg.gggg..gg..',
        '..gGg.ggg..gGg..',
        '...gggggg.gGGg..',
        '....ggdggggGg...',
        '.....gdgdggg....',
        '......ddd.......',
        '....pppppppp....',
        '....pPPPPPPp....',
        '.....pPPPPp.....',
        '.....pppppp.....',
      ],
      { g: PAL.green, G: PAL.lime, d: PAL.greenD, p: PAL.redD, P: PAL.red },
      0,
      0,
    ),
  );
}

export function lampSprite(): Sprite {
  return once('lamp', () =>
    sprite(12, 30, -2, 15, (r) => {
      r(PAL.cream, 3, 0, 6, 2);
      r(PAL.yellow, 2, 2, 8, 3);
      r(PAL.orange, 1, 5, 10, 2);
      r(PAL.grey, 5, 7, 2, 20);
      r(PAL.brownD, 3, 27, 6, 2);
    }),
  );
}

const BOOKS = [PAL.red, PAL.teal, PAL.yellow, PAL.purple, PAL.green, PAL.blue, PAL.orange, PAL.cream, PAL.pink];

/** A bookcase filling a w x h box; `seed` varies the books. */
export function paintShelf(r: Painter, x: number, y: number, w: number, h: number, seed: number): void {
  r(PAL.brownD, x, y, w, h);
  r(shade(PAL.brownD, 0.62), x + 1, y + 1, w - 2, h - 2);
  let row = 0;
  for (let sy = y + 1; sy + 7 < y + h; sy += 8, row++) {
    r(PAL.brown, x + 1, sy + 6, w - 2, 1);
    let cx = x + 1;
    let i = 0;
    while (cx < x + w - 2) {
      const n = hash(cx, row, seed + i++);
      const bw = n % 5 === 0 ? 3 : 2;
      if (n % 9 === 0) {
        cx += 2;
        continue;
      }
      const bh = 4 + ((n >> 3) % 3);
      const width = Math.min(bw, x + w - 1 - cx);
      r(BOOKS[(n >> 6) % BOOKS.length], cx, sy + 6 - bh, width, bh);
      if (bw === 3) r(PAL.white, cx + 1, sy + 7 - bh, 1, 1);
      cx += bw;
    }
  }
}

export function shelfSprite(seed: number): Sprite {
  return once(`shelf-${seed}`, () => sprite(16, 28, 0, 12, (r) => paintShelf(r, 0, 0, 16, 28, seed), { outline: false, pad: 0 }));
}

export function sideTableSprite(): Sprite {
  return once('sidetable', () =>
    sprite(12, 15, -2, 0, (r) => {
      r(PAL.pink, 4, 0, 4, 2);
      r(PAL.yellow, 5, 0, 2, 1);
      r(PAL.green, 5, 2, 2, 2);
      r(PAL.white, 4, 4, 4, 3);
      r(PAL.tan, 0, 7, 12, 3);
      r(PAL.cream, 0, 7, 12, 1);
      r(PAL.brown, 5, 10, 2, 4);
      r(PAL.brownD, 3, 14, 6, 1);
    }),
  );
}

export function fishTankSprite(): Sprite {
  return once('fishtank', () =>
    sprite(16, 15, 0, 0, (r) => {
      r(PAL.sky, 1, 0, 14, 10);
      r(PAL.white, 2, 1, 3, 1);
      r(PAL.tan, 1, 8, 14, 2);
      r(PAL.green, 3, 4, 1, 4);
      r(PAL.green, 4, 6, 1, 2);
      r(PAL.greenD, 11, 5, 1, 3);
      r(PAL.brown, 1, 10, 14, 5);
      r(PAL.wood, 1, 10, 14, 1);
      r(PAL.brownD, 7, 12, 2, 3);
    }),
  );
}

export function bedSprite(): Sprite {
  return once('bed', () =>
    sprite(16, 30, 0, -1, (r) => {
      r(PAL.brownD, 0, 0, 16, 5);
      r(PAL.brown, 1, 1, 14, 3);
      r(PAL.white, 1, 5, 14, 22);
      r(PAL.cream, 3, 6, 10, 4);
      r(PAL.greyL, 3, 10, 10, 1);
      r(PAL.blue, 1, 12, 14, 15);
      r(PAL.sky, 1, 12, 14, 2);
      for (const [x, y] of [
        [4, 17],
        [10, 16],
        [7, 20],
        [3, 23],
        [11, 23],
      ]) {
        r(PAL.sky, x, y, 1, 1);
      }
      r(PAL.brownD, 0, 27, 16, 3);
    }),
  );
}

export function catSprite(): Sprite {
  return once('cat', () =>
    gridSprite(
      [
        '....o.o.........',
        '...ooooo..oo....',
        '...oOoOoooooo...',
        '...ooooooooooo..',
        '..pooooooooooop.',
        '.pppowwooooooppp',
        '.pppppppppppppp.',
        '..pppppppppppp..',
      ],
      { o: PAL.orange, O: PAL.brownD, w: PAL.white, p: PAL.purple },
      0,
      -7,
    ),
  );
}

export type EmoteKind = 'wave' | 'thumbs' | 'coffee' | 'heart';

const EMOTE_ART: Record<EmoteKind, { rows: string[]; colors: Record<string, string> }> = {
  heart: {
    rows: ['.rr.rr.', 'rrrrrrr', 'rrrrrrr', '.rrrrr.', '..rrr..', '...r...'],
    colors: { r: PAL.red },
  },
  coffee: {
    rows: ['..g.g..', '.g.g...', 'wwwww..', 'wbbbwww', 'wbbbw.w', 'wwwwww.', '.www...'],
    colors: { w: PAL.shadow, b: PAL.brown, g: PAL.grey },
  },
  wave: {
    rows: ['.y.y.y.', '.y.y.y.', 'yyyyyy.', '.yyyyyy', '.yyyyy.', '..yyy..'],
    colors: { y: PAL.orange },
  },
  thumbs: {
    rows: ['...yy..', '...yy..', '..yyy..', 'byyyyyy', 'byyyyyy', 'byyyyy.', 'byyyy..'],
    colors: { y: PAL.orange, b: PAL.blue },
  },
};

export function emoteSprite(kind: EmoteKind): Sprite {
  return once(`emote-${kind}`, () => gridSprite(EMOTE_ART[kind].rows, EMOTE_ART[kind].colors, 0, 0, false));
}

export function coinSprite(): Sprite {
  return once('coin', () =>
    gridSprite(
      ['..yyyy..', '.yYYYYy.', 'yYYoYYYy', 'yYYoYYYy', 'yYYoYYYy', 'yYYoYYYy', '.yYYYYy.', '..yyyy..'],
      { y: PAL.orange, Y: PAL.yellow, o: PAL.orange },
      0,
      0,
    ),
  );
}

export function flameSprite(): Sprite {
  return once('flame', () =>
    gridSprite(
      ['...r....', '..rr....', '..ror.r.', '.rroorr.', '.rooyor.', '.royyor.', '.royyor.', '..rooo..'],
      { r: PAL.red, o: PAL.orange, y: PAL.yellow },
      0,
      0,
    ),
  );
}
