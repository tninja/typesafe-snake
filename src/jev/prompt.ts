import type { MoveFacts, Turn } from "../game/analysis.ts";
import type { Dir, GameState } from "../game/engine.ts";

export type RelativeMove = "straight" | "turn_left" | "turn_right";

export function turnToRelative(turn: Turn): RelativeMove {
  switch (turn) {
    case "straight":
      return "straight";
    case "left turn":
      return "turn_left";
    case "right turn":
      return "turn_right";
  }
}

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
  const foodPart = f.eats
    ? "EATS THE FOOD now"
    : f.foodDelta === "closer"
      ? `moves CLOSER to food (${f.foodDistance} steps away)`
      : f.foodDelta === "farther"
        ? `moves AWAY from food (${f.foodDistance} steps away)`
        : f.foodDistance !== null
          ? `food is ${f.foodDistance} steps away`
          : "no food";

  const parts = [
    `${f.turn}, head moves to row ${f.target.r} col ${f.target.c}`,
    foodPart,
    `${f.reachable} of ${f.freeTotal} empty cells stay reachable`,
  ];
  if (f.deadEnd) parts.push("DEAD END: less room than the snake is long and no way to follow the tail out");
  else if (f.canReachTail) parts.push("can still follow its own tail out");
  if (f.cycleRisk) parts.push("CYCLE RISK: repeats loop");
  return parts.join("; ");
}

const RULES =
  "Choose Snake's next move. Listed moves are legal now; avoid DEAD END traps and CYCLE loops. " +
  "Prefer moves that move closer to food. Facts describe the position after moving.";

// Laya shares 192 tokens between instructions and options, with 48 per option.
// Keep model input compact; describeMove remains the fuller explanation for the UI.
function moveCriterion(f: MoveFacts): string {
  const foodDesc = f.eats
    ? "eats food now"
    : f.foodDelta === "closer"
      ? `closer to food (${f.foodDistance} steps)`
      : f.foodDelta === "farther"
        ? `away from food (${f.foodDistance} steps)`
        : f.foodDistance === null
          ? "no food"
          : `food distance ${f.foodDistance}`;

  return [
    foodDesc,
    f.deadEnd ? "DEAD END" : "no dead end",
    f.cycleRisk ? "CYCLE RISK" : "no cycle",
    `reachable space ${f.reachable}/${f.freeTotal}`,
    `tail escape ${f.canReachTail ? "yes" : "no"}`,
  ].join("; ");
}

export interface JevRequest {
  state: Record<string, unknown>;
  instructions: string;
  criteria: Partial<Record<RelativeMove, string>>;
  relativeToDir: Record<RelativeMove, Dir>;
}

export function buildRequest(game: GameState, facts: MoveFacts[], strategy: string): JevRequest {
  const head = game.snake[0];
  const criteria: Partial<Record<RelativeMove, string>> = {};
  const relativeToDir: Partial<Record<RelativeMove, Dir>> = {};

  for (const f of facts) {
    const rel = turnToRelative(f.turn);
    criteria[rel] = moveCriterion(f);
    relativeToDir[rel] = f.dir;
  }

  return {
    state: {
      board: renderBoard(game),
      legend: LEGEND,
      head: { row: head.r, col: head.c },
      food: game.food ? { row: game.food.r, col: game.food.c } : null,
      snakeLength: game.snake.length,
      gridSize: { rows: game.rows, cols: game.cols },
      foodIsAdjacent: facts.some((f) => f.eats),
    },
    // Strategy must survive providers that truncate the end of the question.
    instructions: `Player strategy: ${strategy.trim() || "Stay alive and eat food."} ${RULES}`,
    criteria,
    relativeToDir: relativeToDir as Record<RelativeMove, Dir>,
  };
}

export const PRESETS: Record<string, string> = {
  safe:
    "Stay alive above all. Prefer moves closer to food and moves that keep the most empty cells reachable. " +
    "Never enter a dead end, and only go for the food when that does not shrink your room. Make no mistakes.",
  greedy:
    "Get to the food as fast as possible. Always choose moves closer to food unless that move is a dead end.",
  chaos:
    "Be unpredictable. Wander, take strange detours and hug the walls. Ignore the food most of the time, but do not die.",
};
