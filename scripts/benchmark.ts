import { TypeSafeClient, choice } from "@typesafe-ai/sdk";
import { analyze, heuristicMove, type MoveFacts } from "../src/game/analysis.ts";
import { createGame, step, type Dir, type GameState } from "../src/game/engine.ts";
import { buildRequest, renderBoard, LEGEND, PRESETS, type RelativeMove } from "../src/jev/prompt.ts";

const baseURL = process.env.TYPESAFE_BASE_URL || "http://127.0.0.1:8000";
const apiKey = process.env.TYPESAFE_API_KEY || "local";
const client = new TypeSafeClient({ apiKey, baseURL });

function buildOldRequest(game: GameState, facts: MoveFacts[], strategy: string) {
  const head = game.snake[0];
  const criteria: Partial<Record<Dir, string>> = {};
  for (const f of facts) {
    criteria[f.dir] = [
      f.eats ? "eats food now" : f.foodDistance === null ? "no food" : `food distance ${f.foodDistance}`,
      f.deadEnd ? "DEAD END" : "no dead end",
      `reachable space ${f.reachable}/${f.freeTotal}`,
      `tail escape ${f.canReachTail ? "yes" : "no"}`,
      f.turn,
    ].join("; ");
  }
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
    instructions: `Player strategy: ${strategy.trim() || "Stay alive and eat food."} Choose Snake's next move. Listed moves are legal now; avoid DEAD END traps. Facts describe the position after moving.`,
    criteria,
  };
}

interface GameRunSummary {
  seed: number;
  steps: number;
  score: number;
  straightRatio: number;
  deathReason: string | null;
  avgLatencyMs: number;
}

async function runGame(mode: "old" | "new" | "hybrid", seed: number, maxSteps = 40): Promise<GameRunSummary> {
  let game = createGame({ cols: 8, rows: 8, seed });
  let straightCount = 0;
  let decideCount = 0;
  let totalLatency = 0;

  for (let s = 0; s < maxSteps; s++) {
    if (!game.alive || game.won) break;

    const facts = analyze(game);
    if (facts.length === 0) {
      game = step(game, game.heading);
      break;
    }

    let chosenDir: Dir;

    if (facts.length === 1) {
      chosenDir = facts[0].dir;
    } else {
      const prevHeading = game.heading;
      const t0 = performance.now();

      const heuristic = mode === "hybrid" ? heuristicMove(facts) : null;
      if (heuristic) {
        chosenDir = heuristic;
      } else if (mode === "old") {
        const req = buildOldRequest(game, facts, PRESETS.safe);
        const res = await client.systemOne({
          state: req.state as never,
          questions: { move: choice(req.instructions, req.criteria as Record<string, string>) },
        });
        chosenDir = res.answers.move.choice as Dir;
      } else {
        const req = buildRequest(game, facts, PRESETS.safe);
        const res = await client.systemOne({
          state: req.state as never,
          questions: { move: choice(req.instructions, req.criteria as Record<string, string>) },
        });
        const choiceRel = res.answers.move.choice as RelativeMove;
        chosenDir = req.relativeToDir[choiceRel] ?? (res.answers.move.choice as Dir);
      }
      totalLatency += performance.now() - t0;
      decideCount++;
      if (chosenDir === prevHeading) {
        straightCount++;
      }
    }

    game = step(game, chosenDir);
  }

  return {
    seed,
    steps: game.steps,
    score: game.score,
    straightRatio: decideCount > 0 ? Math.round((straightCount / decideCount) * 100) : 0,
    deathReason: game.deathReason,
    avgLatencyMs: decideCount > 0 ? Math.round(totalLatency / decideCount) : 0,
  };
}

async function main() {
  console.log(`Connecting to local Laya at ${baseURL}...`);
  const seeds = [42, 101, 2024];

  console.log("\n=======================================================");
  console.log("1. BENCHMARKING OLD PROMPT (Absolute moves + heading in state)");
  console.log("=======================================================");
  const oldResults: GameRunSummary[] = [];
  for (const seed of seeds) {
    process.stdout.write(`  Running seed ${seed}... `);
    const res = await runGame("old", seed, 35);
    oldResults.push(res);
    console.log(`Steps: ${res.steps}, Score: ${res.score}, Straight %: ${res.straightRatio}%, Death: ${res.deathReason ?? "survived"}`);
  }

  console.log("\n=======================================================");
  console.log("2. BENCHMARKING NEW PROMPT (Relative moves, no heading in state)");
  console.log("=======================================================");
  const newResults: GameRunSummary[] = [];
  for (const seed of seeds) {
    process.stdout.write(`  Running seed ${seed}... `);
    const res = await runGame("new", seed, 35);
    newResults.push(res);
    console.log(`Steps: ${res.steps}, Score: ${res.score}, Straight %: ${res.straightRatio}%, Death: ${res.deathReason ?? "survived"}`);
  }

  console.log("\n=======================================================");
  console.log("3. BENCHMARKING HYBRID (New Prompt + Heuristic Safe-Eat / Trap Avoid)");
  console.log("=======================================================");
  const hybridResults: GameRunSummary[] = [];
  for (const seed of seeds) {
    process.stdout.write(`  Running seed ${seed}... `);
    const res = await runGame("hybrid", seed, 35);
    hybridResults.push(res);
    console.log(`Steps: ${res.steps}, Score: ${res.score}, Straight %: ${res.straightRatio}%, Death: ${res.deathReason ?? "survived"}`);
  }

  const avgOldScore = oldResults.reduce((a, b) => a + b.score, 0) / oldResults.length;
  const avgOldStraight = oldResults.reduce((a, b) => a + b.straightRatio, 0) / oldResults.length;
  const avgNewScore = newResults.reduce((a, b) => a + b.score, 0) / newResults.length;
  const avgNewStraight = newResults.reduce((a, b) => a + b.straightRatio, 0) / newResults.length;
  const avgHybridScore = hybridResults.reduce((a, b) => a + b.score, 0) / hybridResults.length;
  const avgHybridStraight = hybridResults.reduce((a, b) => a + b.straightRatio, 0) / hybridResults.length;

  console.log("\n=======================================================");
  console.log("SUMMARY COMPARISON:");
  console.log(`  1. Old Prompt         -> Avg Score: ${avgOldScore.toFixed(1)}, Avg Straight: ${avgOldStraight.toFixed(1)}%`);
  console.log(`  2. New Prompt         -> Avg Score: ${avgNewScore.toFixed(1)}, Avg Straight: ${avgNewStraight.toFixed(1)}%`);
  console.log(`  3. New + Heuristics   -> Avg Score: ${avgHybridScore.toFixed(1)}, Avg Straight: ${avgHybridStraight.toFixed(1)}%`);
  console.log("=======================================================\n");
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
