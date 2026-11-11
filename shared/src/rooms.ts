import type { RoomDef, RoomKind } from './tilemap.ts';

const CAFE: RoomDef = {
  kind: 'cafe',
  name: 'Cafe',
  rows: [
    '####################',
    '#W#W#M####D###W#W#W#',
    'KKEKK.........TTTTTT',
    '..............cccc.P',
    '....................',
    '.P.cTc...cc...cTc...',
    '.........TT.........',
    '...cTc...cc...cTc...',
    '....................',
    '.L...........sTs..P.',
    '....................',
  ],
  rugs: [{ x: 8, y: 5, w: 4, h: 3 }],
};

const LIBRARY: RoomDef = {
  kind: 'library',
  name: 'Library',
  rows: [
    '####################',
    'BBB#W#BBB#D#BBB#W#BB',
    '....................',
    '.ccc..........ccc..P',
    '.TTT....bb....TTT...',
    '.ccc....bb....ccc...',
    '....................',
    '.ccc....sTs...ccc...',
    '.TTT..........TTT...',
    '.ccc..........ccc..L',
    '....................',
  ],
  rugs: [{ x: 7, y: 6, w: 5, h: 3 }],
};

const HOME: RoomDef = {
  kind: 'home',
  name: 'My Room',
  rows: [
    '############',
    '##W##D###W##',
    '............',
    '.........cT.',
    '............',
    '............',
    '............',
    '............',
    '............',
  ],
  rugs: [],
};

export const ROOMS: Record<RoomKind, RoomDef> = { cafe: CAFE, library: LIBRARY, home: HOME };
