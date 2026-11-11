import { ITEM_BY_ID } from '../../../shared/src/catalog.ts';
import { TILE, VIEW_H, VIEW_W } from '../../../shared/src/constants.ts';
import { PAL } from '../../../shared/src/palette.ts';
import { canPlace, isWalkable, seatAt } from '../../../shared/src/tilemap.ts';
import { avatarSprite } from '../art/characters.ts';

/** Set from the browser console (window.__hour = 22) to preview another time of day. */
function localHour(): number {
  const forced = (window as { __hour?: number }).__hour;
  if (typeof forced === 'number') return forced;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}
import { drawLabel, textWidth } from '../art/font.ts';
import { drawSprite, type Ctx } from '../art/pix.ts';
import { bakeRoom, type Baked, type Drawable } from '../art/roomArt.ts';
import { emoteSprite } from '../art/sprites.ts';
import { decorate, formatClock, now, remainingMs } from '../state.ts';
import { furnitureAt, world, type Avatar } from '../world/world.ts';

function corners(ctx: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  ctx.fillStyle = color;
  const n = 4;
  for (const [cx, cy, sx, sy] of [
    [x, y, 1, 1],
    [x + w - 1, y, -1, 1],
    [x, y + h - 1, 1, -1],
    [x + w - 1, y + h - 1, -1, -1],
  ]) {
    ctx.fillRect(sx > 0 ? cx : cx - n + 1, cy, n, 1);
    ctx.fillRect(cx, sy > 0 ? cy : cy - n + 1, 1, n);
  }
}

function drawAvatar(ctx: Ctx, a: Avatar, b: Baked, t: number): void {
  const seated = a.sitting && !a.moving;
  let frame = 0;
  if (a.moving) frame = 1 + (Math.floor(t / 140 + a.phase) % 2);
  else if (seated && a.focus) frame = Math.floor(t / 600 + a.phase) % 5 === 0 ? 1 : 0;
  const s = avatarSprite(a.outfit, a.dir, seated ? 'sit' : 'stand', frame);
  const x = b.ox + Math.round(a.px) + 8;
  const y = b.oy + Math.round(a.py) + 14 - (seated ? 3 : 0);
  if (!seated) {
    ctx.fillStyle = 'rgba(43,34,51,0.28)';
    ctx.fillRect(x - 5, y - 1, 10, 2);
    ctx.fillRect(x - 4, y + 1, 8, 1);
  }
  if (a.away) ctx.globalAlpha = 0.55;
  drawSprite(ctx, s, x, y);
  ctx.globalAlpha = 1;
}

function drawHover(ctx: Ctx, b: Baked): void {
  const grid = world.grid!;
  const h = world.hover;
  if (!h) return;
  const d = decorate.value;

  if (d.on) {
    const moving = d.moving !== null ? world.furniture.find((f) => f.id === d.moving) : undefined;
    const itemId = d.item ?? moving?.item;
    const item = itemId ? ITEM_BY_ID.get(itemId) : undefined;
    if (item) {
      const wall = item.layer === 'wall';
      const ty = wall ? 1 : h.y;
      const ok = canPlace(grid.def, world.furniture, item, h.x, ty, moving?.id);
      ctx.fillStyle = ok ? 'rgba(163,207,106,0.55)' : 'rgba(217,90,78,0.55)';
      ctx.fillRect(b.ox + h.x * TILE, b.oy + (wall ? 0 : ty * TILE), (item.w ?? 1) * TILE, wall ? TILE * 2 : (item.h ?? 1) * TILE);
    } else {
      const f = furnitureAt(h);
      const fi = f && ITEM_BY_ID.get(f.item);
      if (f && fi) {
        const wall = fi.layer === 'wall';
        corners(ctx, b.ox + f.x * TILE, b.oy + (wall ? 0 : f.y * TILE), (fi.w ?? 1) * TILE, wall ? TILE * 2 : (fi.h ?? 1) * TILE, PAL.white);
      }
    }
    return;
  }

  if (h.y < 2) {
    if (h.x === grid.door.x) corners(ctx, b.ox + h.x * TILE, b.oy + 4, TILE, 28, PAL.yellow);
    return;
  }
  const seat = seatAt(grid, h.x, h.y);
  if (seat) corners(ctx, b.ox + h.x * TILE, b.oy + h.y * TILE, TILE, TILE, PAL.yellow);
  else if (isWalkable(grid, h.x, h.y)) corners(ctx, b.ox + h.x * TILE, b.oy + h.y * TILE, TILE, TILE, 'rgba(251,245,230,0.75)');
}

function drawOverhead(ctx: Ctx, a: Avatar, b: Baked, t: number, at: number): void {
  const seated = a.sitting && !a.moving;
  const clampX = (text: string, cx: number) => {
    const half = textWidth(text) / 2 + 3;
    return Math.max(half, Math.min(VIEW_W - half, cx));
  };
  const cx = b.ox + Math.round(a.px) + 8;
  let y = Math.max(3, b.oy + Math.round(a.py) + 14 - (seated ? 3 : 0) - 32);

  const name = a.bot ? `${a.name} [BOT]` : a.name;
  const color = a.id === world.meId ? PAL.yellow : a.bot ? PAL.greyL : PAL.white;
  drawLabel(ctx, name, clampX(name, cx), y, color);

  let status: string | null = null;
  let statusColor: string = PAL.ink;
  let plate: string = PAL.white;
  if (a.focus) status = a.away ? 'ZZZ' : formatClock(remainingMs(a.focus.endsAt, at));
  else if (a.breakEndsAt !== null) {
    status = 'BREAK';
    statusColor = PAL.white;
    plate = PAL.tealD;
  }
  if (status && y > 12) {
    y -= 10;
    drawLabel(ctx, status, clampX(status, cx), y, statusColor, plate);
  }

  if (a.emote && a.emote.until > t && y > 14) {
    y -= 12;
    if (a.emote.kind === 'brb') {
      drawLabel(ctx, 'BRB', clampX('BRB', cx), y + 3, PAL.ink, PAL.white);
    } else {
      const bx = Math.max(6, Math.min(VIEW_W - 6, cx));
      ctx.fillStyle = PAL.white;
      ctx.fillRect(bx - 5, y - 1, 11, 11);
      ctx.fillRect(bx - 6, y, 13, 9);
      ctx.fillRect(bx - 1, y + 10, 2, 2);
      drawSprite(ctx, emoteSprite(a.emote.kind), bx - 3, y + 1);
    }
  }
}

export function render(ctx: Ctx, t: number): void {
  const grid = world.grid;
  if (!grid) {
    ctx.fillStyle = PAL.ink;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    return;
  }

  // Re-bake the static layer when the room changes, and every half hour for the window light.
  const hour = localHour();
  const bucket = Math.floor(hour * 2);
  if (world.dirty || !world.baked || world.bakedHour !== bucket) {
    world.baked = bakeRoom(grid, world.furniture, hour);
    world.bakedHour = bucket;
    world.dirty = false;
  }
  const b = world.baked;
  ctx.drawImage(b.base, 0, 0);
  drawHover(ctx, b);

  const list: Drawable[] = b.objects.slice();
  for (const a of world.avatars.values()) {
    list.push({ sort: a.py + TILE, draw: (c, time) => drawAvatar(c, a, b, time) });
  }
  list.sort((p, q) => p.sort - q.sort);
  for (const item of list) item.draw(ctx, t);

  if (b.night) {
    ctx.fillStyle = 'rgba(28,30,74,0.3)';
    ctx.fillRect(b.ox, b.oy, grid.w * TILE, grid.h * TILE);
  }
  if (b.glows.length) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const g of b.glows) {
      for (const [radius, alpha] of [
        [30, 0.05],
        [20, 0.07],
        [11, 0.1],
      ]) {
        ctx.fillStyle = `rgba(246,207,91,${alpha})`;
        ctx.beginPath();
        ctx.arc(g.x, g.y + 6, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  for (const p of world.particles) {
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(b.ox + p.x), Math.round(b.oy + p.y), p.life > 0.4 ? 2 : 1, p.life > 0.4 ? 2 : 1);
  }

  const at = now();
  for (const a of world.avatars.values()) drawOverhead(ctx, a, b, t, at);
}
