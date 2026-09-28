import { analyze } from "../src/game/analysis.ts";
import { createGame, DIRS, type Dir, type GameState, type Point } from "../src/game/engine.ts";
import { buildRequest, PRESETS, type RelativeMove } from "../src/jev/prompt.ts";

const rotateDir = (dir: Dir): Dir => DIRS[(DIRS.indexOf(dir) + 1) % 4];
const rotatePoint = (p: Point): Point => ({ r: p.c, c: 6 - p.r });

// Answers are hand-labelled, not supplied by a search/planning policy.
// All boards are open 7x7 grids with a three-cell snake.
export function makeCases() {
  const base = createGame({ cols: 7, rows: 7, seed: 1 });
  const fixtures: { family: string; food: Point; expectedDir: Dir; rationale: string; wall?: boolean }[] = [
    { family: "eat-straight", food: { r: 3, c: 4 }, expectedDir: "right", rationale: "Food is directly ahead; eating leaves ample room." },
    { family: "eat-left", food: { r: 2, c: 3 }, expectedDir: "up", rationale: "Food is immediately to the left of the heading; turn to eat." },
    { family: "closer-straight", food: { r: 3, c: 6 }, expectedDir: "right", rationale: "Food lies ahead on an unobstructed row; other moves increase distance." },
    { family: "closer-right", food: { r: 6, c: 3 }, expectedDir: "down", rationale: "Food lies below on an unobstructed column; turn right to approach it." },
    { family: "leave-wall", food: { r: 3, c: 3 }, expectedDir: "down", wall: true, rationale: "Leave the top wall toward food; continuing along the wall increases distance." },
  ];
  return fixtures.flatMap(({ family, food, expectedDir, rationale, wall }) => {
    let game: GameState = { ...base, food, snake: base.snake.map((p) => ({ ...p, r: wall ? 0 : p.r })) };
    let answer = expectedDir;
    return [0, 90, 180, 270].map((rotation) => {
      const result = { id: `${family}-${rotation}`, family, rotation, game, expectedDir: answer, rationale };
      game = { ...game, snake: game.snake.map(rotatePoint), food: rotatePoint(game.food!), heading: rotateDir(game.heading) };
      answer = rotateDir(answer);
      return result;
    });
  });
}

function permutations<T>(items: T[]): T[][] {
  if (!items.length) return [[]];
  return items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map((rest) => [item, ...rest]));
}

export function buildTrials(repeats = 1) {
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 10) throw new Error("repeat must be an integer from 1 to 10");
  return Array.from({ length: repeats }, (_, repeat) => makeCases().flatMap((c) => {
    const request = buildRequest(c.game, analyze(c.game), PRESETS.greedy);
    const keys = Object.keys(request.criteria) as RelativeMove[];
    const expectedChoice = keys.find((key) => request.relativeToDir[key] === c.expectedDir)!;
    return permutations(keys).map((order, index) => ({
      id: `${c.id}/order-${index}/repeat-${repeat + 1}`,
      caseId: c.id, family: c.family, rotation: c.rotation, repeat: repeat + 1,
      rationale: c.rationale, expectedDir: c.expectedDir, expectedChoice, order,
      relativeToDir: request.relativeToDir,
      // Only payload is sent to Laya. Labels and rationale stay in the report.
      payload: {
        model: "english",
        state: request.state,
        questions: { move: {
          type: "choice", instructions: request.instructions,
          criteria: Object.fromEntries(order.map((key) => [key, request.criteria[key]])),
        } },
      },
    }));
  })).flat();
}

export type Trial = ReturnType<typeof buildTrials>[number];
export interface Result extends Trial {
  status: "correct" | "wrong" | "error";
  latencyMs: number;
  choice?: RelativeMove;
  chosenDir?: Dir;
  probabilities?: Partial<Record<RelativeMove, number>>;
  response?: unknown;
  httpStatus?: number;
  errorKind?: "http" | "network" | "invalid-response";
  error?: string;
}

export interface EvaluateOptions {
  neutralKeys?: boolean;
}

export interface EnsembleCaseResult {
  caseId: string;
  family: string;
  rotation: number;
  repeat: number;
  expectedChoice: RelativeMove;
  expectedDir: Dir;
  choice: RelativeMove;
  chosenDir: Dir;
  status: "correct" | "wrong";
  probabilities: Partial<Record<RelativeMove, number>>;
}

export interface EnsembleSummary {
  total: number;
  valid: number;
  correct: number;
  wrong: number;
  accuracy: number | null;
  byFamily: Record<string, { total: number; valid: number; correct: number; wrong: number; accuracy: number | null }>;
  cases: EnsembleCaseResult[];
}

/** No game proxy, heuristic, retries, or fallback: score exactly what Laya returns. */
export async function evaluateTrial(
  trial: Trial, endpoint: string, apiKey: string, fetcher: typeof fetch = fetch,
  options?: EvaluateOptions,
): Promise<Result> {
  const start = performance.now();
  const result: Result = { ...trial, status: "error", latencyMs: 0 };
  const labels = ["option_1", "option_2", "option_3", "option_4"];
  const keyMap = Object.fromEntries(trial.order.map((key, idx) => [key, labels[idx]]));
  const reverseMap = Object.fromEntries(trial.order.map((key, idx) => [labels[idx], key])) as Record<string, RelativeMove>;
  const payload = options?.neutralKeys ? {
    ...trial.payload,
    questions: {
      move: {
        ...trial.payload.questions.move,
        criteria: Object.fromEntries(trial.order.map((key) => [keyMap[key], trial.payload.questions.move.criteria[key]])),
      },
    },
  } : trial.payload;

  try {
    const response = await fetcher(endpoint, {
      method: "POST", headers: { "Content-Type": "application/json", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(10_000),
    });
    result.httpStatus = response.status;
    const raw = await response.text();
    try { result.response = JSON.parse(raw); } catch { result.response = raw; }
    if (!response.ok) {
      result.errorKind = "http";
      result.error = `HTTP ${response.status}`;
    } else {
      const answer = (result.response as { answers?: { move?: { type?: unknown; choice?: unknown; probabilities?: Record<string, number> } } } | null)?.answers?.move;
      const rawChoice = typeof answer?.choice === "string" ? answer.choice : undefined;
      const choice = (options?.neutralKeys && rawChoice ? reverseMap[rawChoice] : rawChoice) as RelativeMove | undefined;
      if (answer?.type !== "choice" || !choice || !trial.order.includes(choice)) {
        result.errorKind = "invalid-response";
        result.error = "Expected answers.move with type=choice and an offered option";
      } else {
        result.choice = choice;
        result.chosenDir = trial.relativeToDir[result.choice];
        result.status = result.choice === trial.expectedChoice ? "correct" : "wrong";
        if (answer.probabilities && typeof answer.probabilities === "object") {
          result.probabilities = Object.fromEntries(
            Object.entries(answer.probabilities).map(([k, p]) => [options?.neutralKeys ? reverseMap[k] ?? k : k, p]),
          ) as Partial<Record<RelativeMove, number>>;
        }
      }
    }
  } catch (error) {
    result.errorKind = "network";
    result.error = error instanceof Error ? error.message : String(error);
  }
  result.latencyMs = Math.round(performance.now() - start);
  return result;
}

function counts(results: Result[]) {
  const correct = results.filter((r) => r.status === "correct").length;
  const errors = results.filter((r) => r.status === "error").length;
  const valid = results.length - errors;
  return {
    total: results.length, valid, correct, wrong: valid - correct, errors,
    accuracyAmongValid: valid ? correct / valid : null,
    endToEndAccuracy: results.length ? correct / results.length : null,
  };
}

function groupBy(results: Result[], key: (r: Result) => string) {
  const groups = new Map<string, Result[]>();
  for (const result of results) {
    const label = key(result);
    groups.set(label, [...(groups.get(label) ?? []), result]);
  }
  return groups;
}

export function summarize(results: Result[]) {
  const breakdown = (key: (r: Result) => string) => Object.fromEntries(
    [...groupBy(results, key)].map(([label, group]) => [label, counts(group)]),
  );
  let comparableGroups = 0;
  let changedGroups = 0;
  for (const group of groupBy(results, (r) => `${r.caseId}/${r.repeat}`).values()) {
    const expectedCount = permutations(group[0].order).length;
    if (group.length !== expectedCount || group.some((r) => r.status === "error")) continue;
    comparableGroups++;
    if (new Set(group.map((r) => r.choice)).size > 1) changedGroups++;
  }

  const ensembleCases: EnsembleCaseResult[] = [];
  for (const group of groupBy(results, (r) => `${r.caseId}/${r.repeat}`).values()) {
    const expectedCount = permutations(group[0].order).length;
    if (group.length !== expectedCount || group.some((r) => r.status === "error")) continue;
    const avgProbs: Record<string, number> = {};
    for (const r of group) {
      if (r.probabilities) {
        for (const [k, p] of Object.entries(r.probabilities)) {
          if (typeof p === "number") avgProbs[k] = (avgProbs[k] ?? 0) + (p / group.length);
        }
      }
    }
    let choice: RelativeMove | undefined;
    if (Object.keys(avgProbs).length > 0) {
      choice = (Object.entries(avgProbs).sort((a, b) => b[1] - a[1])[0][0] as RelativeMove);
    } else {
      const votes: Record<string, number> = {};
      for (const r of group) {
        if (r.choice) votes[r.choice] = (votes[r.choice] ?? 0) + 1;
      }
      choice = (Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] as RelativeMove);
    }
    if (choice) {
      const first = group[0];
      ensembleCases.push({
        caseId: first.caseId, family: first.family, rotation: first.rotation, repeat: first.repeat,
        expectedChoice: first.expectedChoice, expectedDir: first.expectedDir,
        choice, chosenDir: first.relativeToDir[choice],
        status: choice === first.expectedChoice ? "correct" : "wrong",
        probabilities: avgProbs,
      });
    }
  }

  const ensembleSummary: EnsembleSummary = {
    total: ensembleCases.length,
    valid: ensembleCases.length,
    correct: ensembleCases.filter((c) => c.status === "correct").length,
    wrong: ensembleCases.filter((c) => c.status === "wrong").length,
    accuracy: ensembleCases.length ? ensembleCases.filter((c) => c.status === "correct").length / ensembleCases.length : null,
    byFamily: Object.fromEntries(
      [...groupBy(ensembleCases as unknown as Result[], (c) => (c as unknown as EnsembleCaseResult).family)].map(([fam, grp]) => {
        const cGrp = grp as unknown as EnsembleCaseResult[];
        const cCorrect = cGrp.filter((c) => c.status === "correct").length;
        return [fam, {
          total: cGrp.length, valid: cGrp.length, correct: cCorrect, wrong: cGrp.length - cCorrect,
          accuracy: cGrp.length ? cCorrect / cGrp.length : null,
        }];
      }),
    ),
    cases: ensembleCases,
  };

  return {
    ...counts(results),
    uniformRandomExpectedAccuracy: results.length ? results.reduce((sum, r) => sum + 1 / r.order.length, 0) / results.length : null,
    orderSensitivity: { comparableGroups, changedGroups },
    ensemble: ensembleSummary,
    byFamily: breakdown((r) => r.family),
    byRotation: breakdown((r) => String(r.rotation)),
    byExpectedPosition: breakdown((r) => String(r.order.indexOf(r.expectedChoice) + 1)),
    selectedOptions: Object.fromEntries([...groupBy(results.filter((r) => r.choice), (r) => r.choice!)].map(([key, group]) => [key, group.length])),
    selectedPositions: Object.fromEntries([...groupBy(results.filter((r) => r.choice), (r) => String(r.order.indexOf(r.choice!) + 1))].map(([key, group]) => [key, group.length])),
  };
}
