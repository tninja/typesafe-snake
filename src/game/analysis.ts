import {
  DIRS,
  type Dir,
  type GameState,
  OPPOSITE,
  type Point,
  inBounds,
  isFatal,
  move,
  samePoint,
} from "./engine.ts";

export type Turn = "straight" | "left turn" | "right turn";

export interface MoveFacts {
  dir: Dir;
  turn: Turn;
  target: Point;
  eats: boolean;
  /** Manhattan distance from the new head to the food, null when there is no food. */
  foodDistance: number | null;
  /** Empty cells reachable from the new head after the move (new head excluded). */
  reachable: number;
  /** All empty cells on the board after the move. */
  freeTotal: number;
  /** Reachable space is smaller than the snake: it will very likely get trapped. */
  deadEnd: boolean;
  /** The tail is adjacent to the reachable region, so the snake can follow it out. */
  canReachTail: boolean;
}

const CLOCKWISE: Record<Dir, Dir> = { up: "right", right: "down", down: "left", left: "up" };

export function turnOf(heading: Dir, dir: Dir): Turn {
  if (dir === heading) return "straight";
  return CLOCKWISE[heading] === dir ? "right turn" : "left turn";
}

/** Directions that do not kill the snake on this step (no 180° turns). */
export function legalMoves(state: GameState): Dir[] {
  return DIRS.filter((dir) => dir !== OPPOSITE[state.heading] && isFatal(state, dir) === null);
}

/** Flood fill over empty cells from `start`; `blocked` holds r*cols+c keys. */
export function floodFill(
  start: Point,
  blocked: ReadonlySet<number>,
  cols: number,
  rows: number,
): Set<number> {
  const seen = new Set<number>();
  const stack: Point[] = [start];
  while (stack.length > 0) {
    const p = stack.pop()!;
    for (const dir of DIRS) {
      const n = move(p, dir);
      if (!inBounds(n, cols, rows)) continue;
      const key = n.r * cols + n.c;
      if (blocked.has(key) || seen.has(key)) continue;
      seen.add(key);
      stack.push(n);
    }
  }
  return seen;
}

export function analyzeMove(state: GameState, dir: Dir): MoveFacts {
  const { cols, rows, food } = state;
  const target = move(state.snake[0], dir);
  const eats = food !== null && samePoint(target, food);
  const after = [target, ...(eats ? state.snake : state.snake.slice(0, -1))];
  const blocked = new Set(after.map((p) => p.r * cols + p.c));
  const region = floodFill(target, blocked, cols, rows);
  const tail = after[after.length - 1];
  const canReachTail = DIRS.some((d) => {
    const n = move(tail, d);
    return samePoint(n, target) || region.has(n.r * cols + n.c);
  });
  return {
    dir,
    turn: turnOf(state.heading, dir),
    target,
    eats,
    foodDistance: food ? Math.abs(food.r - target.r) + Math.abs(food.c - target.c) : null,
    reachable: region.size,
    freeTotal: cols * rows - after.length,
    deadEnd: region.size < after.length && !canReachTail,
    canReachTail,
  };
}

export function analyze(state: GameState): MoveFacts[] {
  return legalMoves(state).map((dir) => analyzeMove(state, dir));
}

/** Used when Jev misses the deadline: keep going straight if that is legal. */
export function fallbackMove(state: GameState): Dir {
  const legal = legalMoves(state);
  if (legal.length === 0 || legal.includes(state.heading)) return state.heading;
  return legal[0];
}
