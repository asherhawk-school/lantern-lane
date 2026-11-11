import { seatAt, type Grid, type Tile } from './tilemap.ts';

const NEIGHBOURS = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
] as const;

/**
 * Shortest 4-way path from `from` to `to`, both ends included.
 * Seats are never walked through; with `seatGoal` a seat may be the final tile.
 * Returns null when there is no route.
 */
export function findPath(grid: Grid, from: Tile, to: Tile, seatGoal = false): Tile[] | null {
  const { w, h } = grid;
  if (to.x < 0 || to.y < 0 || to.x >= w || to.y >= h) return null;
  if (from.x < 0 || from.y < 0 || from.x >= w || from.y >= h) return null;

  const start = from.y * w + from.x;
  const goal = to.y * w + to.x;
  const goalOk = grid.walk[goal] || (seatGoal && !!seatAt(grid, to.x, to.y));
  if (!goalOk) return null;
  if (start === goal) return [{ x: from.x, y: from.y }];

  const prev = new Int32Array(w * h).fill(-1);
  prev[start] = start;
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    if (cur === goal) break;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (prev[n] !== -1) continue;
      if (!grid.walk[n] && n !== goal) continue;
      prev[n] = cur;
      queue.push(n);
    }
  }
  if (prev[goal] === -1) return null;

  const path: Tile[] = [];
  for (let cur = goal; ; cur = prev[cur]) {
    path.push({ x: cur % w, y: Math.floor(cur / w) });
    if (cur === start) break;
  }
  return path.reverse();
}
