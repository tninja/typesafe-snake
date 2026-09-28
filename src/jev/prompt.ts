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

function permutations<T>(items: T[]): T[][] {
  if (!items.length) return [[]];
  return items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map((rest) => [item, ...rest]));
}

export const NEUTRAL_KEYS = ["option_1", "option_2", "option_3", "option_4"] as const;

export interface EnsembleQuestionDef {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
}

export interface EnsembleQuestionsResult {
  questions: Record<string, EnsembleQuestionDef>;
  mappings: Record<string, Record<string, RelativeMove>>;
}

/**
 * Builds balanced permutation questions with neutral option labels.
 * Averaging probabilities across these questions completely eliminates token prior bias and positional bias.
 */
export function buildEnsembleQuestions(req: JevRequest, neutralKeys = true): EnsembleQuestionsResult {
  const relKeys = Object.keys(req.criteria) as RelativeMove[];
  const perms = permutations(relKeys);

  const questions: Record<string, EnsembleQuestionDef> = {};
  const mappings: Record<string, Record<string, RelativeMove>> = {};

  perms.forEach((order, idx) => {
    const qid = `move_perm_${idx}`;
    const keyToRelative: Record<string, RelativeMove> = {};
    const criteria: Record<string, string> = {};

    order.forEach((rel, pos) => {
      const key = neutralKeys ? (NEUTRAL_KEYS[pos] ?? `option_${pos + 1}`) : rel;
      keyToRelative[key] = rel;
      criteria[key] = req.criteria[rel]!;
    });

    questions[qid] = {
      type: "choice",
      instructions: req.instructions,
      criteria,
    };
    mappings[qid] = keyToRelative;
  });

  return { questions, mappings };
}

export interface SingleQuestionResult {
  question: EnsembleQuestionDef;
  mapping: Record<string, RelativeMove>;
}

/**
 * Builds a single choice question with neutral option keys (option_1, option_2, ...)
 * to eliminate lexical bias while minimizing inference latency for real-time play.
 */
export function buildSingleQuestion(req: JevRequest, neutralKeys = true): SingleQuestionResult {
  const relKeys = Object.keys(req.criteria) as RelativeMove[];
  const mapping: Record<string, RelativeMove> = {};
  const criteria: Record<string, string> = {};

  relKeys.forEach((rel, pos) => {
    const key = neutralKeys ? (NEUTRAL_KEYS[pos] ?? `option_${pos + 1}`) : rel;
    mapping[key] = rel;
    criteria[key] = req.criteria[rel]!;
  });

  return {
    question: {
      type: "choice",
      instructions: req.instructions,
      criteria,
    },
    mapping,
  };
}

export interface EnsembleResolution {
  choiceDir: Dir;
  choiceRel: RelativeMove;
  probabilities: Partial<Record<Dir, number>>;
  confidence: number;
}

/**
 * Aggregates answers across multiple permutation questions by averaging probabilities.
 */
export function resolveEnsembleChoice(
  answers: Record<string, unknown>,
  mappings: Record<string, Record<string, RelativeMove>>,
  relativeToDir: Record<RelativeMove, Dir>,
): EnsembleResolution {
  const dirProbSums: Partial<Record<Dir, number>> = {};
  const relProbSums: Partial<Record<RelativeMove, number>> = {};
  let count = 0;
  let confSum = 0;

  for (const [qid, ansRaw] of Object.entries(answers)) {
    if (!ansRaw || typeof ansRaw !== "object") continue;
    const ans = ansRaw as { choice?: string; probabilities?: Record<string, number>; confidence?: number };
    const keyMap = mappings[qid];
    if (ans.probabilities && keyMap) {
      count++;
      if (typeof ans.confidence === "number") confSum += ans.confidence;
      for (const [key, prob] of Object.entries(ans.probabilities)) {
        const rel = keyMap[key];
        const dir = rel ? relativeToDir[rel] : undefined;
        if (rel && dir && typeof prob === "number") {
          dirProbSums[dir] = (dirProbSums[dir] ?? 0) + prob;
          relProbSums[rel] = (relProbSums[rel] ?? 0) + prob;
        }
      }
    } else if (ans.choice && keyMap) {
      count++;
      const rel = keyMap[ans.choice];
      const dir = rel ? relativeToDir[rel] : undefined;
      if (rel && dir) {
        dirProbSums[dir] = (dirProbSums[dir] ?? 0) + 1;
        relProbSums[rel] = (relProbSums[rel] ?? 0) + 1;
      }
    }
  }

  // Fallback if single non-permutation answer was passed (e.g. { move: { choice: ... } })
  if (count === 0 && answers.move && typeof answers.move === "object") {
    const singleAns = answers.move as { choice?: string; probabilities?: Record<string, number>; confidence?: number };
    const rel = singleAns.choice as RelativeMove;
    const dir = relativeToDir[rel] ?? (singleAns.choice as Dir);
    const probs: Partial<Record<Dir, number>> = {};
    if (singleAns.probabilities) {
      for (const [k, p] of Object.entries(singleAns.probabilities)) {
        const d = relativeToDir[k as RelativeMove] ?? (k as Dir);
        if (typeof p === "number") probs[d] = p;
      }
    }
    return {
      choiceDir: dir,
      choiceRel: rel,
      probabilities: probs,
      confidence: singleAns.confidence ?? 0,
    };
  }

  const probabilities: Partial<Record<Dir, number>> = {};
  for (const [d, sum] of Object.entries(dirProbSums)) {
    probabilities[d as Dir] = count > 0 ? sum / count : 0;
  }

  const sortedDirs = (Object.entries(probabilities) as [Dir, number][]).sort((a, b) => b[1] - a[1]);
  const choiceDir = sortedDirs[0]?.[0] ?? Object.values(relativeToDir)[0];
  const sortedRels = (Object.entries(relProbSums) as [RelativeMove, number][]).sort((a, b) => b[1] - a[1]);
  const choiceRel = sortedRels[0]?.[0] ?? (Object.keys(relativeToDir)[0] as RelativeMove);

  return {
    choiceDir,
    choiceRel,
    probabilities,
    confidence: count > 0 ? confSum / count : 0,
  };
}
