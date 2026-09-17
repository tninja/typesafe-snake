export type Dir = "up" | "down" | "left" | "right";

export interface Point {
  r: number;
  c: number;
}

export type DeathReason = "wall" | "body";

export interface GameState {
  cols: number;
  rows: number;
  /** Head first, tail last. */
  snake: Point[];
  heading: Dir;
  /** null once the board is full. */
  food: Point | null;
  score: number;
  steps: number;
  alive: boolean;
  won: boolean;
  deathReason: DeathReason | null;
  rngState: number;
}

export const DIRS: readonly Dir[] = ["up", "right", "down", "left"];

export const DELTA: Record<Dir, Point> = {
  up: { r: -1, c: 0 },
  down: { r: 1, c: 0 },
  left: { r: 0, c: -1 },
  right: { r: 0, c: 1 },
};

export const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

export const samePoint = (a: Point, b: Point) => a.r === b.r && a.c === b.c;

export const inBounds = (p: Point, cols: number, rows: number) =>
  p.r >= 0 && p.r < rows && p.c >= 0 && p.c < cols;

export const move = (p: Point, dir: Dir): Point => ({
  r: p.r + DELTA[dir].r,
  c: p.c + DELTA[dir].c,
});

/** mulberry32: returns [value in [0,1), next state]. */
export function nextRandom(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

function placeFood(
  snake: Point[],
  cols: number,
  rows: number,
  rngState: number,
): [Point | null, number] {
  const taken = new Set(snake.map((p) => p.r * cols + p.c));
  const free: Point[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!taken.has(r * cols + c)) free.push({ r, c });
    }
  }
  if (free.length === 0) return [null, rngState];
  const [value, next] = nextRandom(rngState);
  return [free[Math.floor(value * free.length)], next];
}

export interface GameOptions {
  cols?: number;
  rows?: number;
  seed?: number;
  length?: number;
}

export function createGame(options: GameOptions = {}): GameState {
  const cols = options.cols ?? 16;
  const rows = options.rows ?? 16;
  const length = options.length ?? 3;
  const r = Math.floor(rows / 2);
  const headCol = Math.floor(cols / 2);
  const snake: Point[] = [];
  for (let i = 0; i < length; i++) snake.push({ r, c: headCol - i });
  const [food, rngState] = placeFood(snake, cols, rows, options.seed ?? 1);
  return {
    cols,
    rows,
    snake,
    heading: "right",
    food,
    score: 0,
    steps: 0,
    alive: true,
    won: false,
    deathReason: null,
    rngState,
  };
}

/** Would moving the head in `dir` kill the snake on this step? */
export function isFatal(state: GameState, dir: Dir): DeathReason | null {
  const target = move(state.snake[0], dir);
  if (!inBounds(target, state.cols, state.rows)) return "wall";
  const eats = state.food !== null && samePoint(target, state.food);
  // The tail cell is vacated this step unless the snake grows.
  const body = eats ? state.snake : state.snake.slice(0, -1);
  return body.some((p) => samePoint(p, target)) ? "body" : null;
}

/**
 * Advance one step. A 180° turn is ignored (the snake keeps its heading).
 * Pure: returns a new state.
 */
export function step(state: GameState, requested: Dir): GameState {
  if (!state.alive || state.won) return state;
  const dir = requested === OPPOSITE[state.heading] ? state.heading : requested;
  const fatal = isFatal(state, dir);
  if (fatal) {
    return { ...state, heading: dir, steps: state.steps + 1, alive: false, deathReason: fatal };
  }
  const head = move(state.snake[0], dir);
  const eats = state.food !== null && samePoint(head, state.food);
  const snake = [head, ...(eats ? state.snake : state.snake.slice(0, -1))];
  if (!eats) {
    return { ...state, snake, heading: dir, steps: state.steps + 1 };
  }
  const [food, rngState] = placeFood(snake, state.cols, state.rows, state.rngState);
  return {
    ...state,
    snake,
    heading: dir,
    food,
    rngState,
    score: state.score + 1,
    steps: state.steps + 1,
    won: food === null,
  };
}
