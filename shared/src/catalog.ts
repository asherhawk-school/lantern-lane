import { PAL } from './palette.ts';

export type ItemKind = 'hair' | 'hairColor' | 'top' | 'hat' | 'furniture';
export type FurnitureLayer = 'floor' | 'object' | 'wall';

export interface Item {
  id: string;
  kind: ItemKind;
  name: string;
  /** 0 means everyone has it. */
  price: number;
  color?: string;
  style?: string;
  /** Furniture footprint in tiles. */
  w?: number;
  h?: number;
  layer?: FurnitureLayer;
  seat?: boolean;
  /** Counts as a table for deciding which way a neighbouring seat faces. */
  table?: boolean;
}

export interface Outfit {
  skin: number;
  hair: string;
  hairColor: string;
  top: string;
  hat: string;
}

/** A piece of furniture placed in someone's room. */
export interface Placed {
  id: number;
  item: string;
  x: number;
  y: number;
}

export const ITEMS: Item[] = [
  { id: 'hair_short', kind: 'hair', name: 'Short', price: 0 },
  { id: 'hair_bob', kind: 'hair', name: 'Bob', price: 0 },
  { id: 'hair_none', kind: 'hair', name: 'Shaved', price: 0 },
  { id: 'hair_long', kind: 'hair', name: 'Long', price: 40 },
  { id: 'hair_spiky', kind: 'hair', name: 'Spiky', price: 40 },
  { id: 'hair_bun', kind: 'hair', name: 'Top bun', price: 60 },

  { id: 'hc_brown', kind: 'hairColor', name: 'Chestnut', price: 0, color: PAL.brownD },
  { id: 'hc_black', kind: 'hairColor', name: 'Ink', price: 0, color: '#3a3040' },
  { id: 'hc_blonde', kind: 'hairColor', name: 'Honey', price: 0, color: PAL.yellow },
  { id: 'hc_red', kind: 'hairColor', name: 'Copper', price: 30, color: '#c9603a' },
  { id: 'hc_pink', kind: 'hairColor', name: 'Blossom', price: 50, color: PAL.pink },
  { id: 'hc_blue', kind: 'hairColor', name: 'Lagoon', price: 50, color: PAL.blue },
  { id: 'hc_white', kind: 'hairColor', name: 'Frost', price: 50, color: PAL.greyL },

  { id: 'top_teal', kind: 'top', name: 'Teal tee', price: 0, color: PAL.teal, style: 'plain' },
  { id: 'top_red', kind: 'top', name: 'Red tee', price: 0, color: PAL.red, style: 'plain' },
  { id: 'top_navy', kind: 'top', name: 'Navy tee', price: 0, color: PAL.blue, style: 'plain' },
  { id: 'top_yellow', kind: 'top', name: 'Sunny tee', price: 25, color: PAL.yellow, style: 'plain' },
  { id: 'top_purple', kind: 'top', name: 'Plum tee', price: 25, color: PAL.purple, style: 'plain' },
  { id: 'top_stripe', kind: 'top', name: 'Striped tee', price: 45, color: PAL.navy, style: 'stripe' },
  { id: 'top_hoodie', kind: 'top', name: 'Moss hoodie', price: 60, color: PAL.green, style: 'hoodie' },
  { id: 'top_overalls', kind: 'top', name: 'Overalls', price: 70, color: PAL.blue, style: 'overalls' },

  { id: 'hat_none', kind: 'hat', name: 'No hat', price: 0 },
  { id: 'hat_cap', kind: 'hat', name: 'Cap', price: 50, color: PAL.red },
  { id: 'hat_beanie', kind: 'hat', name: 'Beanie', price: 50, color: PAL.teal },
  { id: 'hat_headphones', kind: 'hat', name: 'Headphones', price: 80, color: PAL.orange },
  { id: 'hat_crown', kind: 'hat', name: 'Crown', price: 300, color: PAL.yellow },

  { id: 'f_plant', kind: 'furniture', name: 'Potted plant', price: 30, w: 1, h: 1, layer: 'object' },
  { id: 'f_sidetable', kind: 'furniture', name: 'Side table', price: 35, w: 1, h: 1, layer: 'object', table: true },
  { id: 'f_lamp', kind: 'furniture', name: 'Floor lamp', price: 40, w: 1, h: 1, layer: 'object' },
  { id: 'f_painting', kind: 'furniture', name: 'Painting', price: 45, w: 1, h: 1, layer: 'wall' },
  { id: 'f_rug', kind: 'furniture', name: 'Woven rug', price: 60, w: 2, h: 2, layer: 'floor' },
  { id: 'f_bookshelf', kind: 'furniture', name: 'Bookshelf', price: 80, w: 1, h: 1, layer: 'object' },
  { id: 'f_armchair', kind: 'furniture', name: 'Armchair', price: 90, w: 1, h: 1, layer: 'object', seat: true },
  { id: 'f_fishtank', kind: 'furniture', name: 'Fish tank', price: 110, w: 1, h: 1, layer: 'object', table: true },
  { id: 'f_bed', kind: 'furniture', name: 'Bed', price: 120, w: 1, h: 2, layer: 'object' },
  { id: 'f_cat', kind: 'furniture', name: 'Sleepy cat', price: 150, w: 1, h: 1, layer: 'object' },
];

export const ITEM_BY_ID: ReadonlyMap<string, Item> = new Map(ITEMS.map((i) => [i.id, i]));

export const DEFAULT_OUTFIT: Outfit = {
  skin: 0,
  hair: 'hair_short',
  hairColor: 'hc_brown',
  top: 'top_teal',
  hat: 'hat_none',
};

export type Inventory = Record<string, number>;

export function owns(inv: Inventory, id: string): boolean {
  const item = ITEM_BY_ID.get(id);
  if (!item) return false;
  return item.price === 0 || (inv[id] ?? 0) > 0;
}

function pieceOk(inv: Inventory, id: string, kind: ItemKind): boolean {
  return ITEM_BY_ID.get(id)?.kind === kind && owns(inv, id);
}

/** True when every piece exists, is the right kind, and is owned (or free). */
export function outfitValid(o: Outfit, inv: Inventory): boolean {
  return (
    Number.isInteger(o.skin) &&
    o.skin >= 0 &&
    o.skin <= 3 &&
    pieceOk(inv, o.hair, 'hair') &&
    pieceOk(inv, o.hairColor, 'hairColor') &&
    pieceOk(inv, o.top, 'top') &&
    pieceOk(inv, o.hat, 'hat')
  );
}
