import { ITEM_BY_ID } from '../../../shared/src/catalog.ts';
import { TILE, VIEW_H, VIEW_W } from '../../../shared/src/constants.ts';
import { isWalkable, seatAt, type Tile } from '../../../shared/src/tilemap.ts';
import { play, unlock } from '../audio/sound.ts';
import { send } from '../net/client.ts';
import { decorate, formatClock, meView, now, panel, remainingMs, serverNow, showToast } from '../state.ts';
import { destination, furnitureAt, me, step, world } from '../world/world.ts';
import { render } from './renderer.ts';

/** Owns the canvas: sizing, the frame loop, and turning clicks and keys into requests to the server. */

const KEY_DIRS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  KeyW: [0, -1],
  ArrowDown: [0, 1],
  KeyS: [0, 1],
  ArrowLeft: [-1, 0],
  KeyA: [-1, 0],
  ArrowRight: [1, 0],
  KeyD: [1, 0],
};

function decorateClick(t: Tile): void {
  const d = decorate.value;
  if (d.item) {
    const wall = ITEM_BY_ID.get(d.item)?.layer === 'wall';
    send({ t: 'place', item: d.item, x: t.x, y: wall ? 1 : t.y });
    play('click');
  } else if (d.moving !== null) {
    const f = world.furniture.find((p) => p.id === d.moving);
    const wall = f && ITEM_BY_ID.get(f.item)?.layer === 'wall';
    send({ t: 'move_item', id: d.moving, x: t.x, y: wall ? 1 : t.y });
    decorate.value = { ...d, moving: null };
    play('click');
  } else {
    const f = furnitureAt(t);
    if (f) decorate.value = { ...d, moving: f.id };
  }
}

function clickTile(t: Tile): void {
  const grid = world.grid;
  const mine = me();
  if (!grid || !mine) return;
  if (decorate.value.on) return decorateClick(t);

  if (t.y < 2) {
    if (t.x === grid.door.x) panel.value = 'rooms';
    return;
  }
  const seat = seatAt(grid, t.x, t.y);
  const dest = destination(mine);
  if (seat && mine.sitting && dest.x === t.x && dest.y === t.y) return;
  if (mine.focus) {
    showToast('Give up your session first if you want to move');
    return;
  }
  if (seat) {
    const taken = [...world.avatars.values()].some((a) => {
      if (a.id === mine.id || !a.sitting) return false;
      const d = destination(a);
      return d.x === t.x && d.y === t.y;
    });
    if (taken) showToast('Someone is sitting there');
    else {
      send({ t: 'sit', x: t.x, y: t.y });
      play('sit');
    }
  } else if (isWalkable(grid, t.x, t.y)) {
    send({ t: 'move', x: t.x, y: t.y });
  }
}

export function startGame(canvas: HTMLCanvasElement, stage: HTMLElement): void {
  canvas.width = VIEW_W;
  canvas.height = VIEW_H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Scale by a whole number of device pixels so every game pixel stays a crisp square.
  const fit = () => {
    const dpr = window.devicePixelRatio || 1;
    const k = Math.max(1, Math.floor(Math.min((stage.clientWidth * dpr) / VIEW_W, (stage.clientHeight * dpr) / VIEW_H)));
    canvas.style.width = `${(VIEW_W * k) / dpr}px`;
    canvas.style.height = `${(VIEW_H * k) / dpr}px`;
  };
  new ResizeObserver(fit).observe(stage);
  window.addEventListener('resize', fit);
  fit();

  const tileAt = (ev: PointerEvent): Tile | null => {
    const b = world.baked;
    if (!b || !world.grid) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((((ev.clientX - rect.left) / rect.width) * VIEW_W - b.ox) / TILE);
    const y = Math.floor((((ev.clientY - rect.top) / rect.height) * VIEW_H - b.oy) / TILE);
    if (x < 0 || y < 0 || x >= world.grid.w || y >= world.grid.h) return null;
    return { x, y };
  };

  canvas.addEventListener('pointermove', (ev) => {
    world.hover = tileAt(ev);
  });
  canvas.addEventListener('pointerleave', () => {
    world.hover = null;
  });
  canvas.addEventListener('pointerdown', (ev) => {
    unlock();
    const t = tileAt(ev);
    world.hover = t;
    if (t) clickTile(t);
  });

  const held = new Set<string>();
  let nextKeyMove = 0;
  window.addEventListener('keydown', (ev) => {
    const el = ev.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) return;
    if (ev.code === 'Escape') {
      if (panel.value) panel.value = null;
      else if (decorate.value.on) decorate.value = { on: false, item: null, moving: null };
      return;
    }
    if (KEY_DIRS[ev.code] && !ev.metaKey && !ev.ctrlKey && !ev.altKey) {
      held.add(ev.code);
      unlock();
      ev.preventDefault();
    }
  });
  window.addEventListener('keyup', (ev) => held.delete(ev.code));
  window.addEventListener('blur', () => held.clear());

  const keyMove = (t: number) => {
    if (!held.size || t < nextKeyMove || panel.value || decorate.value.on) return;
    const mine = me();
    const grid = world.grid;
    if (!mine || !grid || mine.focus) return;
    if (mine.sitting) {
      send({ t: 'stand' });
      nextKeyMove = t + 350;
      return;
    }
    if (mine.waypoints.length > 1) return;
    const [dx, dy] = KEY_DIRS[[...held][held.size - 1]];
    const from = destination(mine);
    const to = { x: from.x + dx, y: from.y + dy };
    if (isWalkable(grid, to.x, to.y)) {
      send({ t: 'move', x: to.x, y: to.y });
      nextKeyMove = t + 120;
    }
  };

  let last = performance.now();
  const frame = (t: number) => {
    const elapsed = (t - last) / 1000;
    last = t;
    if (elapsed > 1) {
      // The tab was in the background: jump everyone to where they should be by now.
      for (const a of world.avatars.values()) {
        const d = destination(a);
        a.px = d.x * TILE;
        a.py = d.y * TILE;
        a.waypoints = [];
      }
    }
    keyMove(t);
    step(Math.min(0.1, elapsed));
    render(ctx, t);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  setInterval(() => {
    const at = now();
    serverNow.value = at;
    const v = meView.value;
    if (v.focus) document.title = `${formatClock(remainingMs(v.focus.endsAt, at))} · Lantern Lane`;
    else if (v.breakEndsAt !== null) document.title = `Break ${formatClock(remainingMs(v.breakEndsAt, at))} · Lantern Lane`;
    else document.title = 'Lantern Lane';
  }, 250);
}
