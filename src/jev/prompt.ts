import type { MoveFacts } from "../game/analysis.ts";
import type { Dir, GameState } from "../game/engine.ts";

export const LEGEND =
  "H = snake head, o = snake body, T = snake tail, F = food, . = empty. " +
  "Row 0 is the top row, column 0 is the leftmost column. Leaving the grid hits a wall.";

export function renderBoard(state: GameState): string[] {
  const grid = Array.from({ length: state.rows }, () => Array<string>(state.cols).fill("."));
  if (state.food) grid[state.food.r][state.food.c] = "F";
  state.snake.forEach((p, i) => {
    grid[p.r][p.c] = i === 0 ? "H" : i === state.snake.length - 1 ? "T" : "o";
  });
  return grid.map((row) => row.join(""));
}

export function describeMove(f: MoveFacts): string {
  const parts = [
    `${f.turn}, head moves to row ${f.target.r} col ${f.target.c}`,
    f.eats ? "EATS THE FOOD now" : `food is ${f.foodDistance ?? "?"} steps away after this move`,
    `${f.reachable} of ${f.freeTotal} empty cells stay reachable`,
  ];
  if (f.deadEnd) parts.push("DEAD END: less room than the snake is long and no way to follow the tail out");
  else if (f.canReachTail) parts.push("can still follow its own tail out");
  return parts.join("; ");
}

const RULES =
  "Choose Snake's next move. Listed moves are legal now; avoid DEAD END traps. " +
  "Facts describe the position after moving.";

// Laya shares 192 tokens between instructions and options, with 48 per option.
// Keep model input compact; describeMove remains the fuller explanation for the UI.
function moveCriterion(f: MoveFacts): string {
  return [
    f.eats ? "eats food now" : f.foodDistance === null ? "no food" : `food distance ${f.foodDistance}`,
    f.deadEnd ? "DEAD END" : "no dead end",
    `reachable space ${f.reachable}/${f.freeTotal}`,
    `tail escape ${f.canReachTail ? "yes" : "no"}`,
    f.turn,
  ].join("; ");
}

export interface JevRequest {
  state: Record<string, unknown>;
  instructions: string;
  criteria: Partial<Record<Dir, string>>;
}

export function buildRequest(game: GameState, facts: MoveFacts[], strategy: string): JevRequest {
  const head = game.snake[0];
  const criteria: Partial<Record<Dir, string>> = {};
  for (const f of facts) criteria[f.dir] = moveCriterion(f);
  return {
    state: {
      board: renderBoard(game),
      legend: LEGEND,
      head: { row: head.r, col: head.c },
      food: game.food ? { row: game.food.r, col: game.food.c } : null,
      heading: game.heading,
      snakeLength: game.snake.length,
      gridSize: { rows: game.rows, cols: game.cols },
      foodIsAdjacent: facts.some((f) => f.eats),
    },
    // Strategy must survive providers that truncate the end of the question.
    instructions: `Player strategy: ${strategy.trim() || "Stay alive and eat food."} ${RULES}`,
    criteria,
  };
}

export const PRESETS: Record<string, string> = {
  safe:
    "Stay alive above all. Prefer the move that keeps the most empty cells reachable, never enter a dead end, " +
    "and only go for the food when that does not shrink your room. Make no mistakes.",
  greedy:
    "Get to the food as fast as possible. Always shorten the distance to the food unless that move is a dead end.",
  chaos:
    "Be unpredictable. Wander, take strange detours and hug the walls. Ignore the food most of the time, but do not die.",
};
